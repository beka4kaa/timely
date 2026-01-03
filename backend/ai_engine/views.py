from rest_framework import viewsets, status, mixins
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import LearningProgram, WeekPlan, TopicPlan, ScheduledTest
from .serializers import LearningProgramSerializer
from mind.models import Subject, Topic
from .services import (
    generate_learning_program_content, 
    generate_fast_topics, 
    analyze_progress, 
    modify_program
)
from datetime import timedelta
from django.utils import timezone

class GenerateProgramView(APIView):
    def post(self, request):
        data = request.data
        
        # Handle both parameter formats for compatibility
        # New format from frontend: totalWeeks, hoursPerWeek, name, subjectDeadlines
        # Old format: goal, timeframe, hoursPerDay, currentLevel, subjectIds
        
        total_weeks = data.get('totalWeeks', data.get('total_weeks', 4))
        hours_per_week = data.get('hoursPerWeek', data.get('hours_per_week', 20))
        hours_per_day = data.get('hoursPerDay', hours_per_week / 7)
        program_name = data.get('name', 'Моя программа обучения')
        
        # Get subject deadlines - this contains subjectId and deadline info
        subject_deadlines = data.get('subjectDeadlines', data.get('subject_deadlines', []))
        
        # Extract subject IDs from deadlines or from direct parameter
        subject_ids = data.get('subjectIds', data.get('subject_ids', []))
        if not subject_ids and subject_deadlines:
            subject_ids = [sd.get('subjectId') or sd.get('subject_id') for sd in subject_deadlines if sd.get('subjectId') or sd.get('subject_id')]
        
        goal = data.get('goal', f'Complete program in {total_weeks} weeks')
        timeframe = data.get('timeframe', f'{total_weeks} weeks')
        current_level = data.get('currentLevel', data.get('current_level', 'Intermediate'))
        
        # Get subjects with their topics for AI context
        subjects = Subject.objects.filter(id__in=subject_ids).prefetch_related('topics') if subject_ids else Subject.objects.all().prefetch_related('topics')
        
        subject_data = []
        for s in subjects:
            # Sort topics by order_index - this represents difficulty progression (easier to harder)
            sorted_topics = s.topics.all().order_by('order_index', 'created_at')[:20]
            subject_info = {
                'name': s.name, 
                'id': str(s.id),
                'topics': [{
                    'name': t.name, 
                    'status': t.status, 
                    'id': str(t.id),
                    'order': t.order_index  # Include order for AI context
                } for t in sorted_topics]
            }
            # Find deadline for this subject
            for sd in subject_deadlines:
                if str(sd.get('subjectId') or sd.get('subject_id')) == str(s.id):
                    subject_info['deadline'] = sd.get('deadline')
                    break
            subject_data.append(subject_info)
        
        try:
            # Call AI Service with enriched context (61-school style)
            ai_result = generate_learning_program_content(
                goal, timeframe, hours_per_day, current_level, subject_data,
                context={
                    'totalWeeks': total_weeks, 
                    'hoursPerWeek': hours_per_week,
                    'subjectDeadlines': subject_deadlines
                }
            )
            
            if not ai_result:
                return Response({'error': 'AI failed to generate program'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # Create Database Objects
            program = LearningProgram.objects.create(
                name=ai_result.get('programTitle', program_name),
                total_weeks=ai_result.get('totalWeeks', total_weeks),
                hours_per_week=hours_per_week,
                description=ai_result.get('description', ''),
                strategy=ai_result.get('strategy', '')
            )
            
            # Debug log
            print(f"AI Result keys: {ai_result.keys()}")
            print(f"dayPlans count: {len(ai_result.get('dayPlans', []))}")
            print(f"weekPlans count: {len(ai_result.get('weekPlans', []))}")
            print(f"weekSummaries count: {len(ai_result.get('weekSummaries', []))}")
            print(f"topicPlans count: {len(ai_result.get('topicPlans', []))}")

            # Create Week Plans from multiple sources
            created_week_numbers = set()
            
            # Source 1: weekSummaries (new format)
            for ws in ai_result.get('weekSummaries', []):
                week_num = ws.get('weekNumber', 1)
                if week_num in created_week_numbers:
                    continue
                created_week_numbers.add(week_num)
                WeekPlan.objects.create(
                    program=program,
                    week_number=week_num,
                    start_date=timezone.now() + timedelta(days=(week_num - 1) * 7),
                    end_date=timezone.now() + timedelta(days=week_num * 7),
                    subject_hours=str({'total': ws.get('totalHours', 20)}),
                    focus=', '.join(ws.get('mainTopics', [])),
                    notes=ws.get('goals', '')
                )
            
            # Source 2: weekPlans (standard format)
            for wp in ai_result.get('weekPlans', []):
                week_num = wp.get('weekNumber', 1)
                if week_num in created_week_numbers:
                    continue
                created_week_numbers.add(week_num)
                WeekPlan.objects.create(
                    program=program,
                    week_number=week_num,
                    start_date=timezone.now() + timedelta(days=wp.get('startOffset', (week_num - 1) * 7)),
                    end_date=timezone.now() + timedelta(days=wp.get('endOffset', week_num * 7)),
                    subject_hours=str(wp.get('subjectHours', {})),
                    focus=wp.get('focus', ''),
                    notes=wp.get('notes', '')
                )
            
            # If no weeks created, create at least one
            if not created_week_numbers:
                total_weeks = ai_result.get('totalWeeks', 1)
                for i in range(1, total_weeks + 1):
                    WeekPlan.objects.create(
                        program=program,
                        week_number=i,
                        start_date=timezone.now() + timedelta(days=(i - 1) * 7),
                        end_date=timezone.now() + timedelta(days=i * 7),
                        subject_hours='{}',
                        focus=f'Week {i}',
                        notes=''
                    )
                    created_week_numbers.add(i)
            
            print(f"Created {len(created_week_numbers)} week plans")

            # Create Topic Plans from multiple sources
            topic_plans_data = list(ai_result.get('topicPlans', []))  # Make a copy
            
            # Extract topic plans from dayPlans.sessions (new daily format)
            for day in ai_result.get('dayPlans', []):
                day_num = day.get('dayNumber', 1)
                week_num = day.get('weekNumber', (day_num - 1) // 7 + 1)
                for session in day.get('sessions', []):
                    session_type = session.get('type', 'THEORY')
                    if session_type in ['THEORY', 'PRACTICE', 'REVIEW']:
                        topic_plans_data.append({
                            'topicName': session.get('topicName', ''),
                            'subjectName': session.get('subjectName', ''),
                            'plannedWeek': week_num,
                            'plannedDay': day_num,
                            'estimatedHours': session.get('durationMin', 45) / 60,
                            'priority': session.get('order', 1),
                            'type': session_type
                        })
            
            print(f"Total topic plans to process: {len(topic_plans_data)}")
            
            # Deduplicate by (topicName, plannedWeek) - allow same topic in different weeks
            seen_topics = set()
            created_count = 0
            for tp in topic_plans_data:
                topic_name = tp.get('topicName', tp.get('topic_name', ''))
                subject_name = tp.get('subjectName', tp.get('subject_name', ''))
                planned_week = tp.get('plannedWeek', tp.get('planned_week', 1))
                
                # Create unique key for dedup (same topic can appear in multiple weeks for review)
                dedup_key = f"{topic_name}||{planned_week}"
                
                if not topic_name or dedup_key in seen_topics:
                    continue
                seen_topics.add(dedup_key)
                    
                # Try to find topic by name within selected subjects
                topic = Topic.objects.filter(name__icontains=topic_name).first()
                if not topic:
                    # Create if doesn't exist
                    subject = Subject.objects.filter(name__icontains=subject_name).first() if subject_name else subjects.first()
                    if subject:
                        topic = Topic.objects.create(subject=subject, name=topic_name)
                
                if topic:
                    # Parse deadline from AI response if provided, else calculate from week
                    deadline_str = tp.get('deadline')
                    if deadline_str and deadline_str != 'YYYY-MM-DD':
                        try:
                            from datetime import datetime as dt
                            deadline = dt.fromisoformat(deadline_str.replace('Z', '+00:00'))
                        except:
                            deadline = timezone.now() + timedelta(weeks=planned_week)
                    else:
                        deadline = timezone.now() + timedelta(weeks=planned_week)
                    
                    TopicPlan.objects.create(
                        program=program,
                        topic=topic,
                        planned_week=planned_week,
                        estimated_hours=tp.get('estimatedHours', tp.get('estimated_hours', 2)),
                        priority=tp.get('priority', 1),
                        deadline=deadline
                    )
                    created_count += 1
            
            print(f"Created {created_count} topic plans")
            
            # Create Scheduled Tests from AI response
            scheduled_tests_data = ai_result.get('scheduledTests', [])
            tests_created = 0
            for test in scheduled_tests_data:
                test_title = test.get('title', '')
                subject_name = test.get('subjectName', test.get('subject_name', ''))
                scheduled_week = test.get('scheduledWeek', test.get('scheduled_week', 1))
                topics_covered = test.get('topics', [])
                test_type = test.get('type', 'WEEKLY_TEST')
                duration_min = test.get('durationMin', test.get('duration_min', 45))
                
                if not test_title:
                    continue
                
                # Find subject for this test
                subject = None
                if subject_name:
                    subject = Subject.objects.filter(name__icontains=subject_name).first()
                if not subject and subjects:
                    subject = subjects.first()
                
                if subject:
                    from .models import ScheduledTest
                    import json as json_module
                    
                    ScheduledTest.objects.create(
                        program=program,
                        subject=subject,
                        scheduled_date=timezone.now() + timedelta(weeks=scheduled_week, days=-1),  # End of week
                        title=test_title,
                        description=f"Test covering: {', '.join(topics_covered)}",
                        topics_covered=json_module.dumps(topics_covered),
                        type=test_type,
                        status='SCHEDULED'
                    )
                    tests_created += 1
            
            print(f"Created {tests_created} scheduled tests")

            return Response(LearningProgramSerializer(program).data, status=status.HTTP_201_CREATED)

        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

class LearningProgramViewSet(viewsets.ModelViewSet):
    queryset = LearningProgram.objects.all().order_by('-created_at')
    serializer_class = LearningProgramSerializer

    # Optional: logic to get "current" program easily
    def get_queryset(self):
        return super().get_queryset()


class TopicPlanViewSet(viewsets.ModelViewSet):
    """ViewSet for managing individual topic plans"""
    queryset = TopicPlan.objects.all()
    
    def get_serializer_class(self):
        from .serializers import TopicPlanSerializer
        return TopicPlanSerializer
    
    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        
        # Handle specific field updates
        if 'planned_week' in request.data:
            instance.planned_week = request.data['planned_week']
            instance.manually_moved = True
        
        if 'deadline' in request.data:
            instance.deadline = request.data['deadline']
        
        if 'priority' in request.data:
            instance.priority = request.data['priority']
            
        if 'status' in request.data:
            instance.status = request.data['status']
        
        instance.save()
        
        serializer = self.get_serializer(instance)
        return Response(serializer.data)

class AnalyzeView(APIView):
    def post(self, request):
        return Response(analyze_progress(request.data))

class FastTopicsView(APIView):
    def post(self, request):
        from mind.models import Subtopic
        
        subject_id = request.data.get('subjectId') or request.data.get('subject_id')
        text = request.data.get('text', '')
        
        if not subject_id:
            return Response({'error': 'subjectId is required'}, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            subject = Subject.objects.get(id=subject_id)
        except Subject.DoesNotExist:
            return Response({'error': 'Subject not found'}, status=status.HTTP_404_NOT_FOUND)
        
        # Generate topics using AI - returns a list with potential subtopics
        generated_topics = generate_fast_topics(subject.name, text)
        
        # Save topics and subtopics to database
        created_topics = []
        total_subtopics = 0
        
        for topic_data in generated_topics:
            topic_name = topic_data.get('name', '')
            if not topic_name:
                continue
                
            # Create topic
            topic = Topic.objects.create(
                subject=subject,
                name=topic_name,
                status='NOT_STARTED',
                study_state='NOT_STUDIED'
            )
            
            # Create subtopics if present
            subtopic_list = topic_data.get('subtopics', [])
            created_subtopics = []
            
            for subtopic_data in subtopic_list:
                subtopic_name = subtopic_data.get('name', '')
                if subtopic_name:
                    subtopic = Subtopic.objects.create(
                        topic=topic,
                        title=subtopic_name  # Subtopic uses 'title' not 'name'
                    )
                    created_subtopics.append({
                        'id': str(subtopic.id),
                        'name': subtopic.title
                    })
                    total_subtopics += 1
            
            created_topics.append({
                'id': str(topic.id),
                'name': topic.name,
                'estimatedHours': topic_data.get('estimatedHours', 0),
                'difficulty': topic_data.get('difficulty', 'Medium'),
                'subtopics': created_subtopics
            })
        
        return Response({
            'topics': created_topics,
            'message': f'Created {len(created_topics)} topics with {total_subtopics} subtopics'
        })

class ModifyProgramView(APIView):
    def post(self, request):
        current = request.data.get('program', {})
        req_text = request.data.get('request', '')
        return Response(modify_program(current, req_text))

class GenerateSubtopicsView(APIView):
    # Quick stub for generation
    def post(self, request):
        # reuse fast topics logic or similar
        topic = request.data.get('topicName', '')
        return Response(generate_fast_topics(topic, "Generate subtopics for this topic"))


class DailyTasksView(APIView):
    """Generate daily task recommendations based on SRS and progress"""
    
    def get(self, request):
        from mind.models import Topic
        
        now = timezone.now()
        
        # Get topics due for review
        due_topics = Topic.objects.filter(
            next_review_at__lte=now
        ).order_by('next_review_at')[:5]
        
        # Get topics not started
        not_started = Topic.objects.filter(
            status='NOT_STARTED'
        ).order_by('order_index')[:3]
        
        daily_tasks = []
        
        for topic in due_topics:
            daily_tasks.append({
                'id': str(topic.id),
                'title': topic.name,
                'type': 'REVIEW',
                'priority': 1,
                'estimatedMinutes': 30,
                'subject': topic.subject.name if topic.subject else 'General',
            })
        
        for topic in not_started:
            daily_tasks.append({
                'id': str(topic.id),
                'title': topic.name,
                'type': 'NEW',
                'priority': 2,
                'estimatedMinutes': 45,
                'subject': topic.subject.name if topic.subject else 'General',
            })
        
        return Response({
            'dailyTasks': daily_tasks,
            'insights': [
                f'You have {len(due_topics)} topics due for review',
                f'{len(not_started)} new topics waiting to be studied',
                'Focus on review tasks first to maintain retention',
            ],
            'studyGoal': {
                'hoursRecommended': min(len(daily_tasks), 4),
                'focusAreas': list(set([t.subject.name for t in due_topics if t.subject] + 
                                       [t.subject.name for t in not_started if t.subject])),
            }
        })
    
    def post(self, request):
        # Custom task generation based on user preferences
        preferences = request.data.get('preferences', {})
        available_hours = request.data.get('availableHours', 4)
        
        return Response({
            'message': 'Custom daily tasks generated',
            'tasks': [],
            'adjustments': f'Adjusted for: {preferences}' if preferences else None,
        })


class ScheduleView(APIView):
    """Generate AI-powered daily schedule"""
    
    def post(self, request):
        from mind.models import Topic
        from planner.models import Block, DayPlan
        
        topics = request.data.get('topics', [])
        date = request.data.get('date')
        hours_available = request.data.get('hoursAvailable', 4)
        
        if not date:
            date = timezone.now().date().isoformat()
        
        # Get or create day plan
        day_plan, created = DayPlan.objects.get_or_create(date=date)
        
        # Generate blocks based on topics to study
        blocks = []
        start_hour = 9
        
        for index, topic_data in enumerate(topics[:hours_available]):
            if isinstance(topic_data, str):
                # Topic ID provided
                try:
                    topic = Topic.objects.get(id=topic_data)
                    topic_name = topic.name
                    topic_color = topic.subject.color if topic.subject else '#3b82f6'
                except Topic.DoesNotExist:
                    topic_name = f'Study Session {index + 1}'
                    topic_color = '#3b82f6'
            else:
                # Topic object provided
                topic_name = topic_data.get('name') or topic_data.get('title') or f'Study Session {index + 1}'
                topic_color = topic_data.get('color', '#3b82f6')
            
            blocks.append({
                'id': f'generated-{timezone.now().timestamp()}-{index}',
                'type': 'LESSON',
                'title': topic_name,
                'duration_minutes': 60,
                'start_time': f'{start_hour + index}:00',
                'status': 'NOT_STARTED',
                'order_index': index,
                'color': topic_color,
            })
        
        return Response({
            'date': date,
            'blocks': blocks,
            'recommendations': [
                'Start with the most challenging topics in the morning',
                'Take 10-15 minute breaks between study blocks',
                'Review yesterday\'s topics briefly before starting new ones',
            ],
        })


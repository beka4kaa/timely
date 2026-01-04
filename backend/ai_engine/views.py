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
from datetime import timedelta, datetime
from django.utils import timezone
import math


def parse_deadline_date(deadline_str):
    """
    Parse deadline string to datetime object.
    Returns None if parsing fails.
    """
    if not deadline_str:
        return None
    try:
        if 'T' in str(deadline_str):
            return datetime.fromisoformat(str(deadline_str).replace('Z', '+00:00')).replace(tzinfo=None)
        else:
            return datetime.strptime(str(deadline_str)[:10], '%Y-%m-%d')
    except:
        return None


def generate_programmatic_schedule(subjects_data, subject_deadlines, hours_per_day, session_minutes=45):
    """
    Generate schedule PROGRAMMATICALLY - this ALWAYS respects deadline.
    No AI involved in structure - just pure math.
    
    STRICT DEADLINE GUARANTEE:
    - If deadline is January 5th, ALL topics MUST be scheduled by January 5th
    - Program end date will be the deadline date (or earlier)
    - Topics are evenly distributed across available days
    
    Args:
        subjects_data: List of subjects with topics
        subject_deadlines: List of {subjectId, deadline, milestoneTopicId}
        hours_per_day: Available study hours per day (e.g., 12)
        session_minutes: Duration of each session in minutes (default 45)
    
    Returns:
        dict with dayPlans, weekPlans, topicPlans structured for storage
    """
    now = datetime.now()
    today_start = datetime(now.year, now.month, now.day)  # Start of today
    
    print("=" * 60)
    print("STRICT DEADLINE PROGRAMMATIC SCHEDULER")
    print("=" * 60)
    
    # Parse all deadlines and find the EARLIEST one (most urgent)
    deadline_by_subject = {}
    min_deadline_date = None
    
    for sd in subject_deadlines:
        subj_id = str(sd.get('subjectId') or sd.get('subject_id', ''))
        deadline_date = parse_deadline_date(sd.get('deadline'))
        
        if deadline_date:
            deadline_by_subject[subj_id] = {
                'deadline': deadline_date,
                'milestone_topic_id': sd.get('milestoneTopicId')
            }
            if min_deadline_date is None or deadline_date < min_deadline_date:
                min_deadline_date = deadline_date
    
    # Calculate STRICT available days
    if min_deadline_date:
        # Days from today until deadline (inclusive of deadline day)
        days_available = (min_deadline_date - today_start).days
        if days_available < 1:
            days_available = 1  # At least today
        print(f"DEADLINE: {min_deadline_date.strftime('%Y-%m-%d')}")
        print(f"DAYS AVAILABLE: {days_available} (today to deadline inclusive)")
    else:
        # No deadline set - default to 7 days
        days_available = 7
        min_deadline_date = today_start + timedelta(days=7)
        print("NO DEADLINE SET - defaulting to 7 days")
    
    # Collect all topics from all subjects with scope filtering
    all_topics = []
    for subj in subjects_data:
        subj_id = str(subj.get('id', ''))
        subj_name = subj.get('name', 'Subject')
        topics = subj.get('topics', [])
        
        # Find milestone topic for this subject (if any)
        end_index = len(topics)
        subj_deadline_info = deadline_by_subject.get(subj_id)
        
        if subj_deadline_info:
            milestone_id = subj_deadline_info.get('milestone_topic_id')
            if milestone_id:
                for idx, t in enumerate(topics):
                    if str(t.get('id')) == str(milestone_id):
                        end_index = idx + 1
                        print(f"Subject '{subj_name}': milestone at topic #{end_index} '{t.get('name')}'")
                        break
        
        # Only include topics up to milestone (or all if no milestone)
        for t in topics[:end_index]:
            all_topics.append({
                'topic_id': t.get('id'),
                'topic_name': t.get('name'),
                'subject_id': subj_id,
                'subject_name': subj_name,
                'status': t.get('status', 'NOT_STARTED')
            })
    
    total_topics = len(all_topics)
    print(f"TOTAL TOPICS TO SCHEDULE: {total_topics}")
    
    if total_topics == 0:
        print("WARNING: No topics to schedule!")
        return {
            'programTitle': 'Empty Program',
            'totalDays': 0,
            'totalWeeks': 0,
            'dayPlans': [],
            'weekSummaries': [],
            'topicPlans': [],
            'weekPlans': [],
            'scheduledTests': [],
            'endDate': today_start.strftime('%Y-%m-%d')
        }
    
    # MATH: Calculate topics per day to FIT ALL within deadline
    # This is the KEY - we MUST fit all topics, so we calculate how many per day
    topics_per_day = math.ceil(total_topics / days_available)
    
    print(f"MATH: {total_topics} topics / {days_available} days = {topics_per_day} topics/day (rounded up)")
    
    # Session duration based on topic status (shorter for already known topics)
    def get_session_duration(topic):
        st = topic.get('status', 'NOT_STARTED')
        if st in ['MASTERED', 'SUCCESS']:
            return 15  # Quick review
        elif st == 'MEDIUM':
            return 30  # Practice focus
        else:
            return session_minutes  # Full treatment for new topics
    
    # Build day plans - STRICTLY distribute topics to meet deadline
    day_plans = []
    topic_plans = []
    topic_idx = 0
    
    for day in range(1, days_available + 1):
        if topic_idx >= total_topics:
            break  # All topics scheduled
            
        day_date = today_start + timedelta(days=day - 1)
        sessions = []
        
        # Schedule exactly topics_per_day topics (or remaining topics on last day)
        remaining_topics = total_topics - topic_idx
        topics_for_today = min(topics_per_day, remaining_topics)
        
        # Distribute topics throughout the day
        hours_available = hours_per_day
        hour = 8  # Start at 8 AM
        
        for _ in range(topics_for_today):
            if topic_idx >= total_topics:
                break
                
            topic = all_topics[topic_idx]
            duration = get_session_duration(topic)
            
            # Add session for this topic
            sessions.append({
                'order': len(sessions) + 1,
                'startTime': f'{hour:02d}:00',
                'subjectName': topic['subject_name'],
                'topicName': topic['topic_name'],
                'topicId': topic['topic_id'],
                'type': 'STUDY',
                'durationMin': duration
            })
            
            # Calculate which week this day falls in
            week_number = ((day - 1) // 7) + 1
            
            # Add topic plan
            topic_plans.append({
                'topicName': topic['topic_name'],
                'topicId': topic['topic_id'],
                'subjectName': topic['subject_name'],
                'plannedWeek': week_number,
                'plannedDay': day,
                'date': day_date.strftime('%Y-%m-%d'),
                'estimatedHours': duration / 60,
                'priority': topic_idx + 1,
                'type': 'THEORY',
                'status': topic['status'],
                'deadline': min_deadline_date.strftime('%Y-%m-%d')  # All topics share the deadline
            })
            
            # Move to next time slot
            hour += 1
            if hour >= 22:
                hour = 8
            
            topic_idx += 1
        
        total_day_hours = sum(s['durationMin'] for s in sessions) / 60
        print(f"Day {day} ({day_date.strftime('%Y-%m-%d')}): {len(sessions)} topics, {total_day_hours:.1f}h")
        
        day_plans.append({
            'dayNumber': day,
            'date': day_date.strftime('%Y-%m-%d'),
            'weekNumber': ((day - 1) // 7) + 1,
            'totalHours': total_day_hours,
            'sessions': sessions
        })
    
    # Verify all topics scheduled
    topics_scheduled = topic_idx
    print(f"\nSCHEDULE COMPLETE:")
    print(f"  Topics scheduled: {topics_scheduled}/{total_topics}")
    print(f"  Days used: {len(day_plans)}/{days_available}")
    print(f"  End date: {day_plans[-1]['date'] if day_plans else 'N/A'}")
    print(f"  Deadline: {min_deadline_date.strftime('%Y-%m-%d')}")
    
    # Build week summaries
    weeks = {}
    for dp in day_plans:
        wn = dp['weekNumber']
        if wn not in weeks:
            weeks[wn] = {
                'weekNumber': wn, 
                'topics': [], 
                'sessions': 0,
                'startDate': dp['date'],
                'endDate': dp['date']
            }
        weeks[wn]['sessions'] += len(dp['sessions'])
        weeks[wn]['endDate'] = dp['date']
        for s in dp['sessions']:
            topic_key = f"{s['subjectName']}: {s['topicName']}"
            if topic_key not in weeks[wn]['topics']:
                weeks[wn]['topics'].append(topic_key)
    
    week_summaries = []
    for wn, w in sorted(weeks.items()):
        week_summaries.append({
            'weekNumber': w['weekNumber'],
            'startDate': w['startDate'],
            'endDate': w['endDate'],
            'mainTopics': w['topics'][:10],
            'totalHours': w['sessions'] * session_minutes / 60,
            'goals': f"Complete {len(w['topics'])} topics"
        })
    
    # Calculate actual end date (when last topic is scheduled)
    actual_end_date = day_plans[-1]['date'] if day_plans else today_start.strftime('%Y-%m-%d')
    
    return {
        'programTitle': f'{days_available}-Day Study Plan (Deadline: {min_deadline_date.strftime("%b %d")})',
        'totalDays': len(day_plans),
        'totalWeeks': max(1, len(weeks)),
        'startDate': today_start.strftime('%Y-%m-%d'),
        'endDate': actual_end_date,  # ACTUAL end date (should be <= deadline)
        'deadline': min_deadline_date.strftime('%Y-%m-%d'),
        'dayPlans': day_plans,
        'weekSummaries': week_summaries,
        'topicPlans': topic_plans,
        'weekPlans': [
            {
                'weekNumber': ws['weekNumber'], 
                'startDate': ws['startDate'],
                'endDate': ws['endDate'],
                'focus': ', '.join(ws['mainTopics'][:5])
            } 
            for ws in week_summaries
        ],
        'scheduledTests': [],
        'topicsPerDay': topics_per_day,
        'totalTopicsScheduled': topics_scheduled
    }


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
        
        # DEBUG: Log all topics being passed to AI
        print("=" * 60)
        print("GENERATING PROGRAM VIA AI")
        print("=" * 60)
        total_topics_count = sum(len(sd.get('topics', [])) for sd in subject_data)
        print(f"Total subjects: {len(subject_data)}")
        print(f"Total topics: {total_topics_count}")
        for sd in subject_data:
            print(f"  {sd['name']}: {len(sd.get('topics', []))} topics, deadline: {sd.get('deadline')}")
        print("=" * 60)
        
        try:
            # Call AI Service for program generation
            ai_result = generate_learning_program_content(
                goal=goal, 
                timeframe=timeframe, 
                hours_per_day=hours_per_day, 
                current_level=current_level, 
                subjects=subject_data,
                context={
                    'totalWeeks': total_weeks, 
                    'hoursPerWeek': hours_per_week,
                    'subjectDeadlines': subject_deadlines
                }
            )
            
            if not ai_result:
                return Response({'error': 'AI failed to generate program'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
            # Log feasibility status
            feasibility = ai_result.get('feasibility', 'UNKNOWN')
            feasibility_msg = ai_result.get('feasibilityMessage', 'No message from AI')
            print(f"FEASIBILITY: {feasibility} - {feasibility_msg}")
            
            # Check if dayPlans is empty - might be due to AI error
            if not ai_result.get('dayPlans'):
                error_detail = feasibility_msg if feasibility_msg else ai_result.get('description', 'Unknown error')
                print(f"ERROR: No dayPlans generated. Feasibility: {feasibility}, Message: {error_detail}")
                return Response({
                    'error': f'AI не смог создать программу: {error_detail}',
                    'feasibility': feasibility,
                    'details': error_detail
                }, status=status.HTTP_400_BAD_REQUEST)  # 400 not 500 - it's a client-side issue

            # Parse dates from AI result
            start_date_str = ai_result.get('startDate')
            end_date_str = ai_result.get('endDate')
            deadline_str = ai_result.get('deadline')
            
            start_date = None
            end_date = None
            
            if start_date_str:
                try:
                    start_date = datetime.strptime(start_date_str, '%Y-%m-%d')
                except:
                    start_date = timezone.now()
            else:
                start_date = timezone.now()
                
            if end_date_str:
                try:
                    end_date = datetime.strptime(end_date_str, '%Y-%m-%d')
                except:
                    end_date = None
            
            # Fallback: if no end_date, use the earliest deadline from subject_deadlines
            if not end_date and subject_deadlines:
                earliest_deadline = None
                for sd in subject_deadlines:
                    deadline_str_raw = sd.get('deadline')
                    if deadline_str_raw:
                        try:
                            if 'T' in str(deadline_str_raw):
                                dl = datetime.fromisoformat(str(deadline_str_raw).replace('Z', '+00:00')).replace(tzinfo=None)
                            else:
                                dl = datetime.strptime(str(deadline_str_raw)[:10], '%Y-%m-%d')
                            if earliest_deadline is None or dl < earliest_deadline:
                                earliest_deadline = dl
                        except:
                            pass
                if earliest_deadline:
                    end_date = earliest_deadline
                    print(f"Computed end_date from deadlines: {end_date}")

            # Create Database Objects with CORRECT end_date
            program = LearningProgram.objects.create(
                name=ai_result.get('programTitle', program_name),
                start_date=start_date,
                end_date=end_date,  # Use actual end date from scheduler
                total_weeks=ai_result.get('totalWeeks', total_weeks),
                hours_per_week=hours_per_week,
                description=f"Topics per day: {ai_result.get('topicsPerDay', 'N/A')}. Deadline: {deadline_str or 'Not set'}",
                strategy=f"Strict deadline mode. {ai_result.get('totalTopicsScheduled', 0)} topics scheduled."
            )
            
            print(f"PROGRAM CREATED: {program.name}")
            print(f"  Start: {start_date}")
            print(f"  End: {end_date}")
            print(f"  Deadline: {deadline_str}")
            
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
            print(f"Direct topicPlans from AI: {len(topic_plans_data)}")
            
            # Debug: print AI response structure
            day_plans = ai_result.get('dayPlans', [])
            print(f"dayPlans count from AI: {len(day_plans)}")
            
            # Extract topic plans from dayPlans.sessions (new daily format)
            sessions_extracted = 0
            for day in day_plans:
                day_num = day.get('dayNumber', 1)
                week_num = day.get('weekNumber', (day_num - 1) // 7 + 1)
                sessions = day.get('sessions', [])
                print(f"  Day {day_num}: {len(sessions)} sessions")
                
                for session in sessions:
                    session_type = session.get('type', 'THEORY')
                    topic_name = session.get('topicName', '')
                    subject_name = session.get('subjectName', '')
                    
                    if session_type in ['THEORY', 'PRACTICE', 'REVIEW'] and topic_name:
                        topic_plans_data.append({
                            'topicName': topic_name,
                            'subjectName': subject_name,
                            'plannedWeek': week_num,
                            'plannedDay': day_num,
                            'estimatedHours': session.get('durationMin', 45) / 60,
                            'priority': session.get('order', 1),
                            'type': session_type
                        })
                        sessions_extracted += 1
                        print(f"    + Extracted: {topic_name} ({subject_name})")
            
            print(f"Sessions extracted from dayPlans: {sessions_extracted}")
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


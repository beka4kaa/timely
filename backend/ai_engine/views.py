from rest_framework import viewsets, status
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import LearningProgram, WeekPlan, TopicPlan, ScheduledTest
from .serializers import LearningProgramSerializer
from mind.models import Subject, Topic
from .services import generate_learning_program_content
from datetime import timedelta
from django.utils import timezone

class GenerateProgramView(APIView):
    def post(self, request):
        data = request.data
        goal = data.get('goal')
        timeframe = data.get('timeframe') # e.g. "3 months"
        hours_per_day = data.get('hoursPerDay', 2)
        current_level = data.get('currentLevel', 'Beginner')
        subject_ids = data.get('subjectIds', [])
        
        subjects = Subject.objects.filter(id__in=subject_ids)
        subject_data = [{'name': s.name, 'id': str(s.id)} for s in subjects]
        
        try:
            # Call AI Service
            ai_result = generate_learning_program_content(
                goal, timeframe, hours_per_day, current_level, subject_data
            )
            
            if not ai_result:
                return Response({'error': 'AI failed to generate program'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            # Create Database Objects
            program = LearningProgram.objects.create(
                name=f"Program: {goal[:30]}...",
                total_weeks=ai_result.get('totalWeeks', 4),
                hours_per_week=hours_per_day * 7,
                description=ai_result.get('description'),
                strategy=ai_result.get('strategy')
            )

            # Create Week Plans
            for wp in ai_result.get('weekPlans', []):
                WeekPlan.objects.create(
                    program=program,
                    week_number=wp['weekNumber'],
                    start_date=timezone.now() + timedelta(days=wp.get('startOffset', 0)),
                    end_date=timezone.now() + timedelta(days=wp.get('endOffset', 7)),
                    subject_hours=str(wp.get('subjectHours', {})),
                    focus=wp.get('focus'),
                    notes=wp.get('notes')
                )

            # Create Topic Plans
            # Note: finding topics by name is fuzzy. ideally we use IDs if AI returns them, 
            # but AI operates on names mostly.
            for tp in ai_result.get('topicPlans', []):
                # Try to find topic by name within selected subjects
                topic = Topic.objects.filter(name__icontains=tp['topicName'], subject__id__in=subject_ids).first()
                if not topic:
                    # Create if doesn't exist? Or skip? Let's create for now if we can find subject
                    subject = Subject.objects.filter(name__icontains=tp.get('subjectName'), id__in=subject_ids).first()
                    if subject:
                         topic = Topic.objects.create(subject=subject, name=tp['topicName'])
                
                if topic:
                    TopicPlan.objects.create(
                        program=program,
                        topic=topic,
                        planned_week=tp['plannedWeek'],
                        estimated_hours=tp['estimatedHours'],
                        priority=tp.get('priority', 1),
                        deadline=timezone.now() + timedelta(weeks=tp['plannedWeek']) # Rough deadline
                    )

            return Response(LearningProgramSerializer(program).data, status=status.HTTP_201_CREATED)

        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

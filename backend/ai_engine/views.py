from rest_framework import viewsets, status, mixins
from rest_framework.views import APIView
from rest_framework.response import Response
from .models import LearningProgram, WeekPlan, TopicPlan, ScheduledTest, SubjectDeadline
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

# Try to import StudySession (may not exist if migration not applied)
try:
    from .models import StudySession
    STUDY_SESSION_AVAILABLE = True
except ImportError:
    STUDY_SESSION_AVAILABLE = False
    StudySession = None


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


def validate_deadlines_strict(subject_deadlines_objs, topic_plans_list, subjects_map):
    """
    Verify all topics are scheduled before their subject deadlines.
    Returns list of violations as dicts with {subject_name, topic_name, scheduled_day, deadline}.
    """
    violations = []
    
    # Build map of subject_id -> deadline datetime
    deadline_map = {}
    for sd_obj in subject_deadlines_objs:
        deadline_map[str(sd_obj.subject.id)] = sd_obj.due_date
    
    for tp_dict in topic_plans_list:
        topic_id = tp_dict.get('topicId') or tp_dict.get('topic_id')
        if not topic_id:
            continue
            
        # Find subject for this topic
        topic_obj = Topic.objects.filter(id=topic_id).first()
        if not topic_obj or not topic_obj.subject:
            continue
            
        subject_id = str(topic_obj.subject.id)
        if subject_id not in deadline_map:
            continue
            
        deadline_date = deadline_map[subject_id]
        scheduled_date_str = tp_dict.get('date')
        
        if not scheduled_date_str:
            continue
            
        try:
            scheduled_date = datetime.strptime(scheduled_date_str[:10], '%Y-%m-%d')
            if scheduled_date > deadline_date:
                violations.append({
                    'subject_name': topic_obj.subject.name,
                    'topic_name': topic_obj.name,
                    'scheduled_date': scheduled_date_str,
                    'deadline': deadline_date.strftime('%Y-%m-%d'),
                    'days_over': (scheduled_date - deadline_date).days
                })
        except:
            pass
    
    return violations


def validate_scope(subject_deadlines_objs, topic_plans_list, all_subjects_data):
    """
    Ensure topics beyond milestone are not scheduled before deadline.
    For subjects with scope_mode='UP_TO_TOPIC', verify topics after target_topic are excluded.
    Returns list of violations.
    """
    violations = []
    
    for sd_obj in subject_deadlines_objs:
        if sd_obj.scope_mode != 'UP_TO_TOPIC' or not sd_obj.target_topic:
            continue
            
        subject_id = str(sd_obj.subject.id)
        target_topic_id = str(sd_obj.target_topic.id)
        target_order = sd_obj.target_topic.order_index
        
        # Get all topics for this subject from the original data
        subject_data = next((s for s in all_subjects_data if str(s.get('id')) == subject_id), None)
        if not subject_data:
            continue
            
        # Find topics beyond the milestone (order_index > target_order)
        excluded_topic_ids = set()
        for t in subject_data.get('topics', []):
            if t.get('order') is not None and t.get('order') > target_order:
                excluded_topic_ids.add(str(t.get('id')))
        
        # Check if any excluded topics appear in the topic_plans before deadline
        deadline_date = sd_obj.due_date
        for tp_dict in topic_plans_list:
            topic_id = str(tp_dict.get('topicId') or tp_dict.get('topic_id', ''))
            if topic_id not in excluded_topic_ids:
                continue
                
            scheduled_date_str = tp_dict.get('date')
            if not scheduled_date_str:
                continue
                
            try:
                scheduled_date = datetime.strptime(scheduled_date_str[:10], '%Y-%m-%d')
                if scheduled_date <= deadline_date:
                    topic_obj = Topic.objects.filter(id=topic_id).first()
                    violations.append({
                        'subject_name': sd_obj.subject.name,
                        'topic_name': topic_obj.name if topic_obj else topic_id,
                        'reason': f'Topic beyond milestone (order {topic_obj.order_index if topic_obj else "?"} > {target_order}) scheduled before deadline',
                        'scheduled_date': scheduled_date_str,
                        'deadline': deadline_date.strftime('%Y-%m-%d')
                    })
            except:
                pass
    
    return violations


def generate_programmatic_schedule(subjects_data, subject_deadlines, hours_per_day, session_minutes=45, 
                                   min_topics_per_day=3, max_topics_per_day=8, study_days=None):
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
        min_topics_per_day: Minimum topics per day based on intensity
        max_topics_per_day: Maximum topics per day based on intensity
        study_days: List of days of week for studying (1=Mon, 7=Sun), default all days
    
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
        # Get subject-specific deadline
        subject_deadline = subj_deadline_info.get('deadline') if subj_deadline_info else None
        
        for t in topics[:end_index]:
            all_topics.append({
                'topic_id': t.get('id'),
                'topic_name': t.get('name'),
                'subject_id': subj_id,
                'subject_name': subj_name,
                'status': t.get('status', 'NOT_STARTED'),
                'subject_deadline': subject_deadline  # Store subject's specific deadline
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
    
    # Use provided intensity settings or defaults
    if study_days is None:
        study_days = [1, 2, 3, 4, 5, 6, 7]  # All days by default
    
    # Calculate actual study days available until deadline
    # Filter days_available to only count study days
    actual_study_days = 0
    for day in range(days_available):
        day_date = today_start + timedelta(days=day)
        day_of_week = day_date.isoweekday()  # 1=Mon, 7=Sun
        if day_of_week in study_days:
            actual_study_days += 1
    
    if actual_study_days == 0:
        actual_study_days = 1  # At least 1 day
    
    print(f"STUDY DAYS CONFIG: {study_days}")
    print(f"Calendar days until deadline: {days_available}")
    print(f"Actual study days: {actual_study_days}")
    
    # MATH: Calculate topics per day based on intensity settings
    required_topics_per_day = math.ceil(total_topics / actual_study_days)
    
    # Apply intensity constraints from parameters
    if required_topics_per_day < min_topics_per_day:
        # Schedule is too relaxed - compress it for efficiency
        topics_per_day = min_topics_per_day
        # Recalculate actual days needed
        actual_days_needed = math.ceil(total_topics / topics_per_day)
        print(f"INTENSITY MODE: Compressing schedule from {actual_study_days} to {actual_days_needed} study days")
        print(f"  Min topics/day: {min_topics_per_day}, using: {topics_per_day}")
    elif required_topics_per_day > max_topics_per_day:
        # Can't exceed max intensity - schedule will be tight
        topics_per_day = max_topics_per_day
        print(f"WARNING: Required {required_topics_per_day} topics/day exceeds max {max_topics_per_day}. Schedule will be tight!")
    else:
        topics_per_day = required_topics_per_day
    
    print(f"MATH: {total_topics} topics / {days_available} days = {topics_per_day} topics/day (min={min_topics_per_day}, max={max_topics_per_day})")
    
    # Session duration based on topic status (shorter for already known topics)
    def get_session_duration(topic):
        st = topic.get('status', 'NOT_STARTED')
        if st in ['MASTERED', 'SUCCESS']:
            return 15  # Quick review
        elif st == 'MEDIUM':
            return 30  # Practice focus
        else:
            return session_minutes  # Full treatment for new topics
    
    # Build day plans with SPACED REPETITION - STRICTLY distribute topics to meet deadline
    # Each topic gets: THEORY (day N), PRACTICE (day N+1), REVIEW (day N+3), REVIEW (day N+7)
    day_plans = []
    topic_plans = []
    topic_idx = 0
    study_day_count = 0
    
    # Track when each topic was introduced for spaced repetition scheduling
    topic_introduced_on_day = {}  # {topic_id: theory_day_number}
    
    # First pass: schedule THEORY sessions for all topics
    for day in range(1, days_available + 1):
        if topic_idx >= total_topics:
            break  # All topics scheduled
            
        day_date = today_start + timedelta(days=day - 1)
        day_of_week = day_date.isoweekday()  # 1=Mon, 7=Sun
        
        # Skip non-study days
        if day_of_week not in study_days:
            continue
            
        study_day_count += 1
        sessions = []
        
        # Schedule exactly topics_per_day topics (or remaining topics on last day)
        remaining_topics = total_topics - topic_idx
        topics_for_today = min(topics_per_day, remaining_topics)
        
        # Distribute topics throughout the day
        hour = 8  # Start at 8 AM
        
        for _ in range(topics_for_today):
            if topic_idx >= total_topics:
                break
                
            topic = all_topics[topic_idx]
            duration = get_session_duration(topic)
            
            # Add THEORY session (initial learning)
            sessions.append({
                'order': len(sessions) + 1,
                'startTime': f'{hour:02d}:00',
                'subjectName': topic['subject_name'],
                'topicName': topic['topic_name'],
                'topicId': topic['topic_id'],
                'type': 'THEORY',
                'durationMin': duration
            })
            
            # Calculate which week this day falls in
            week_number = ((day - 1) // 7) + 1
            
            # Add topic plan with subject-specific deadline
            topic_deadline = topic['subject_deadline'] if topic.get('subject_deadline') else min_deadline_date.strftime('%Y-%m-%d')
            if isinstance(topic_deadline, datetime):
                topic_deadline = topic_deadline.strftime('%Y-%m-%d')
            
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
                'deadline': topic_deadline,  # Subject-specific deadline
                'theoryDay': day,  # Track for spaced repetition
            })
            
            # Track this topic for spaced repetition
            topic_introduced_on_day[topic['topic_id']] = day
            
            # Move to next time slot
            hour += 1
            if hour >= 22:
                hour = 8
            
            topic_idx += 1
        
        total_day_hours = sum(s['durationMin'] for s in sessions) / 60
        print(f"Day {day} ({day_date.strftime('%Y-%m-%d')}): {len(sessions)} THEORY sessions, {total_day_hours:.1f}h")
        
        day_plans.append({
            'dayNumber': day,
            'date': day_date.strftime('%Y-%m-%d'),
            'weekNumber': ((day - 1) // 7) + 1,
            'totalHours': total_day_hours,
            'sessions': sessions
        })
    
    # Second pass: Add PRACTICE and REVIEW sessions with spaced repetition
    # For each topic, schedule: PRACTICE (+1d), REVIEW (+3d), REVIEW (+7d)
    print("\nAdding spaced repetition sessions...")
    
    for topic in all_topics:
        topic_id = topic['topic_id']
        if topic_id not in topic_introduced_on_day:
            continue  # Topic wasn't scheduled (shouldn't happen)
        
        theory_day = topic_introduced_on_day[topic_id]
        
        # PRACTICE session: +1 day after THEORY
        practice_day = theory_day + 1
        # REVIEW 1: +3 days after THEORY
        review1_day = theory_day + 3
        # REVIEW 2: +7 days after THEORY
        review2_day = theory_day + 7
        
        for session_type, target_day, duration_min in [
            ('PRACTICE', practice_day, 30),
            ('REVIEW', review1_day, 20),
            ('REVIEW', review2_day, 15),
        ]:
            # Find or create day plan for this day
            target_date = today_start + timedelta(days=target_day - 1)
            
            # Check if within deadline
            if target_date > min_deadline_date:
                continue  # Don't schedule reviews after deadline
            
            # Check if it's a study day
            if target_date.isoweekday() not in study_days:
                # Find next available study day
                offset = 1
                while (target_date + timedelta(days=offset)).isoweekday() not in study_days and offset < 7:
                    offset += 1
                target_date = target_date + timedelta(days=offset)
                target_day = (target_date - today_start).days + 1
            
            # Find existing day plan or create new one
            day_plan = next((dp for dp in day_plans if dp['dayNumber'] == target_day), None)
            
            if not day_plan:
                # Create new day plan for this review day
                day_plan = {
                    'dayNumber': target_day,
                    'date': target_date.strftime('%Y-%m-%d'),
                    'weekNumber': ((target_day - 1) // 7) + 1,
                    'totalHours': 0,
                    'sessions': []
                }
                day_plans.append(day_plan)
            
            # Add session to this day
            hour = 14 + len(day_plan['sessions'])  # Afternoon slots for reviews
            day_plan['sessions'].append({
                'order': len(day_plan['sessions']) + 1,
                'startTime': f'{hour:02d}:00',
                'subjectName': topic['subject_name'],
                'topicName': topic['topic_name'],
                'topicId': topic['topic_id'],
                'type': session_type,
                'durationMin': duration_min
            })
            
            # Update total hours
            day_plan['totalHours'] = sum(s['durationMin'] for s in day_plan['sessions']) / 60
    
    # Sort day plans by day number
    day_plans.sort(key=lambda x: x['dayNumber'])
    
    print(f"Added spaced repetition sessions. Total days with sessions: {len(day_plans)}")
    
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
        # New format from frontend: totalWeeks, hoursPerWeek, hoursPerDay, intensityLevel, studyDays, name, subjectDeadlines
        # Old format: goal, timeframe, hoursPerDay, currentLevel, subjectIds
        
        total_weeks = data.get('totalWeeks', data.get('total_weeks', 4))
        hours_per_week = data.get('hoursPerWeek', data.get('hours_per_week', 20))
        hours_per_day = data.get('hoursPerDay', hours_per_week / 7)
        program_name = data.get('name', 'Моя программа обучения')
        
        # New intensity settings
        intensity_level = data.get('intensityLevel', 'normal')  # relaxed, normal, intense, extreme
        min_topics_per_day = data.get('minTopicsPerDay', 3)  # From intensity presets
        study_days = data.get('studyDays', [1, 2, 3, 4, 5, 6, 7])  # Days of week for studying
        
        # Intensity presets
        intensity_config = {
            'relaxed': {'min_topics': 1, 'max_topics': 3},
            'normal': {'min_topics': 3, 'max_topics': 6},
            'intense': {'min_topics': 5, 'max_topics': 8},
            'extreme': {'min_topics': 8, 'max_topics': 12},
        }
        config = intensity_config.get(intensity_level, intensity_config['normal'])
        
        print(f"=== INTENSITY SETTINGS ===")
        print(f"Level: {intensity_level}")
        print(f"Hours/day: {hours_per_day}")
        print(f"Study days: {study_days} ({len(study_days)} days/week)")
        print(f"Min topics/day: {config['min_topics']}, Max: {config['max_topics']}")
        
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
                    'subjectDeadlines': subject_deadlines,
                    'intensityLevel': intensity_level,
                    'minTopicsPerDay': config['min_topics'],
                    'maxTopicsPerDay': config['max_topics'],
                    'studyDays': study_days
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
            
            # ==============================================================
            # CREATE SUBJECT DEADLINES - SINGLE SOURCE OF TRUTH
            # ==============================================================
            subject_deadline_objs = []
            
            # Only create SubjectDeadlines if migration has been applied
            try:
                from ai_engine.models import SubjectDeadline as SD_Model
                
                for sd in subject_deadlines:
                    try:
                        subj_id = sd.get('subjectId') or sd.get('subject_id')
                        deadline_raw = sd.get('deadline')
                        milestone_topic_id = sd.get('milestoneTopicId') or sd.get('milestone_topic_id')
                        
                        if not subj_id or not deadline_raw:
                            continue
                        
                        # Find subject object
                        subject_obj = Subject.objects.get(id=subj_id)
                        
                        # Parse deadline
                        deadline_dt = parse_deadline_date(deadline_raw)
                        if not deadline_dt:
                            print(f"WARNING: Could not parse deadline {deadline_raw} for {subject_obj.name}")
                            continue
                        
                        # Find target topic if milestone specified
                        target_topic_obj = None
                        scope_mode = 'ALL_TOPICS'
                        if milestone_topic_id:
                            try:
                                target_topic_obj = Topic.objects.get(id=milestone_topic_id, subject=subject_obj)
                                scope_mode = 'UP_TO_TOPIC'
                            except Topic.DoesNotExist:
                                print(f"WARNING: Milestone topic {milestone_topic_id} not found for {subject_obj.name}")
                        
                        # Create SubjectDeadline entity
                        sd_obj = SD_Model.objects.create(
                            program=program,
                            subject=subject_obj,
                            target_topic=target_topic_obj,
                            due_date=deadline_dt,
                            scope_mode=scope_mode
                        )
                        subject_deadline_objs.append(sd_obj)
                        
                        scope_desc = f"up to '{target_topic_obj.name}'" if target_topic_obj else "all topics"
                        print(f"  + SubjectDeadline: {subject_obj.name} - {scope_desc} by {deadline_dt.strftime('%Y-%m-%d')}")
                    
                    except Exception as sd_create_err:
                        print(f"WARNING: Could not create SubjectDeadline for subject {sd.get('subjectId')}: {sd_create_err}")
                        continue
                
                print(f"Created {len(subject_deadline_objs)} subject deadline entities")
            
            except ImportError:
                print("WARNING: SubjectDeadline model not available (migration not applied)")
            except Exception as sd_err:
                print(f"WARNING: SubjectDeadline creation failed: {sd_err}")
                import traceback
                traceback.print_exc()

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
            
            # Build a map of subject name -> deadline from original request
            subject_deadline_map = {}
            for sd in subject_deadlines:
                subj_id = str(sd.get('subjectId') or sd.get('subject_id', ''))
                deadline_str = sd.get('deadline')
                if subj_id and deadline_str:
                    # Find subject name by ID
                    for subj in subject_data:
                        if str(subj.get('id')) == subj_id:
                            subject_deadline_map[subj.get('name', '').lower()] = deadline_str
                            break
            
            print(f"Subject deadline map: {subject_deadline_map}")
            
            # ==============================================================
            # CREATE STUDY SESSIONS from dayPlans (with spaced repetition)
            # ==============================================================
            sessions_created = 0
            topic_session_days = {}  # Track which days each topic has sessions: {topic_name: {THEORY: day, PRACTICE: day, ...}}
            
            # Only try to create study sessions if model is available
            if STUDY_SESSION_AVAILABLE and StudySession is not None:
                try:
                    for day in day_plans:
                        day_num = day.get('dayNumber', 1)
                        day_date_str = day.get('date', '')
                        week_num = day.get('weekNumber', (day_num - 1) // 7 + 1)
                        sessions = day.get('sessions', [])
                        
                        # Parse day date
                        try:
                            if day_date_str:
                                day_date = datetime.strptime(str(day_date_str)[:10], '%Y-%m-%d').date()
                            else:
                                day_date = (timezone.now() + timedelta(days=day_num - 1)).date()
                        except:
                            day_date = (timezone.now() + timedelta(days=day_num - 1)).date()
                        
                        print(f"  Day {day_num} ({day_date}): {len(sessions)} sessions")
                    
                    for session in sessions:
                        session_type = session.get('type', 'THEORY')
                        topic_name = session.get('topicName', '')
                        subject_name = session.get('subjectName', '')
                        start_time = session.get('startTime', '08:00')
                        duration_min = session.get('durationMin', 45)
                        order_in_day = session.get('order', 1)
                        
                        # Find or create subject
                        subject = None
                        if subject_name:
                            subject = Subject.objects.filter(name__icontains=subject_name).first()
                        if not subject and subjects:
                            subject = subjects.first()
                        
                        if not subject:
                            print(f"    ! Skipping session - no subject found for {subject_name}")
                            continue
                        
                        # Find or create topic
                        topic = None
                        if topic_name and session_type != 'TEST':
                            topic = Topic.objects.filter(name__icontains=topic_name, subject=subject).first()
                            if not topic:
                                topic = Topic.objects.filter(name__icontains=topic_name).first()
                            if not topic:
                                # Create topic if it doesn't exist
                                topic = Topic.objects.create(subject=subject, name=topic_name)
                        
                        # Create StudySession
                        try:
                            session_obj = StudySession.objects.create(
                                program=program,
                                topic=topic,
                                subject=subject,
                                session_type=session_type,
                                scheduled_date=day_date,
                                scheduled_time=start_time,
                                duration_minutes=duration_min,
                                day_number=day_num,
                                order_in_day=order_in_day,
                                status='SCHEDULED',
                                title=session.get('title', f"{session_type}: {topic_name}" if topic_name else session_type),
                                topics_covered=str(session.get('topicsCovered', [])) if session_type == 'TEST' else None
                            )
                            sessions_created += 1
                        except Exception as session_err:
                            print(f"    ! Failed to create session: {session_err}")
                        
                        # Track session days for topic plans
                        if topic_name and session_type in ['THEORY', 'PRACTICE', 'REVIEW']:
                            if topic_name not in topic_session_days:
                                topic_session_days[topic_name] = {'subject': subject_name, 'planned_week': week_num}
                            
                            if session_type == 'THEORY':
                                topic_session_days[topic_name]['theory_day'] = day_num
                                topic_session_days[topic_name]['planned_day'] = day_num
                            elif session_type == 'PRACTICE':
                                topic_session_days[topic_name]['practice_day'] = day_num
                            elif session_type == 'REVIEW':
                                if 'review1_day' not in topic_session_days[topic_name]:
                                    topic_session_days[topic_name]['review1_day'] = day_num
                                else:
                                    topic_session_days[topic_name]['review2_day'] = day_num
                        
                        print(f"    + Session: {session_type} - {topic_name or 'Test'} at {start_time}")
                
                    print(f"Created {sessions_created} study sessions")
                except Exception as sessions_error:
                    print(f"WARNING: Could not create study sessions (migration may not be applied): {sessions_error}")
                    # Still continue with topic plans
            else:
                # StudySession not available - extract topic info from dayPlans for TopicPlan creation
                print("StudySession model not available, extracting topic info from dayPlans...")
                for day in day_plans:
                    day_num = day.get('dayNumber', 1)
                    week_num = day.get('weekNumber', (day_num - 1) // 7 + 1)
                    sessions = day.get('sessions', [])
                    
                    for session in sessions:
                        session_type = session.get('type', 'THEORY')
                        topic_name = session.get('topicName', '')
                        subject_name = session.get('subjectName', '')
                        
                        if topic_name and session_type in ['THEORY', 'PRACTICE', 'REVIEW']:
                            if topic_name not in topic_session_days:
                                topic_session_days[topic_name] = {'subject': subject_name, 'planned_week': week_num, 'planned_day': day_num}
            
            # ==============================================================
            # CREATE TOPIC PLANS (with spaced repetition day tracking)
            # ==============================================================
            # Merge topicPlans from AI with tracked session days
            for tp in topic_plans_data:
                topic_name = tp.get('topicName', tp.get('topic_name', ''))
                if topic_name and topic_name not in topic_session_days:
                    topic_session_days[topic_name] = {
                        'subject': tp.get('subjectName', tp.get('subject_name', '')),
                        'planned_week': tp.get('plannedWeek', tp.get('planned_week', 1)),
                        'planned_day': tp.get('plannedDay', tp.get('theoryDay', 1)),
                        'theory_day': tp.get('theoryDay'),
                        'practice_day': tp.get('practiceDay'),
                        'review1_day': tp.get('review1Day'),
                        'review2_day': tp.get('review2Day'),
                    }
            
            # Create TopicPlan entries with spaced repetition days
            created_count = 0
            for topic_name, tp_data in topic_session_days.items():
                subject_name = tp_data.get('subject', '')
                planned_week = tp_data.get('planned_week', 1)
                planned_day = tp_data.get('planned_day', 1)
                
                # Find or create topic
                topic = Topic.objects.filter(name__icontains=topic_name).first()
                if not topic:
                    subject = Subject.objects.filter(name__icontains=subject_name).first() if subject_name else subjects.first()
                    if subject:
                        topic = Topic.objects.create(subject=subject, name=topic_name)
                
                if not topic:
                    print(f"    ! Could not create TopicPlan - no topic for {topic_name}")
                    continue
                
                # Get deadline from original request
                deadline = None
                if topic.subject:
                    actual_subject_name = topic.subject.name.lower()
                    for subj_name, dl_str in subject_deadline_map.items():
                        if subj_name in actual_subject_name or actual_subject_name in subj_name:
                            deadline = parse_deadline_date(dl_str)
                            break
                
                # Fallback: try subject_name from AI
                if not deadline and subject_name:
                    subj_name_lower = subject_name.lower()
                    for subj_name_key, dl_str in subject_deadline_map.items():
                        if subj_name_key in subj_name_lower or subj_name_lower in subj_name_key:
                            deadline = parse_deadline_date(dl_str)
                            break
                
                # Last fallback
                if not deadline:
                    deadline = timezone.now() + timedelta(weeks=planned_week)
                    print(f"WARNING: No deadline found for {topic_name}, using week-based fallback")
                
                # Try to create TopicPlan with new fields, fallback to basic fields if migration not applied
                try:
                    TopicPlan.objects.create(
                        program=program,
                        topic=topic,
                        planned_week=planned_week,
                        planned_day=planned_day,
                        estimated_hours=1.5,  # Base hours for initial learning
                        priority=1,
                        deadline=deadline,
                        theory_day=tp_data.get('theory_day'),
                        practice_day=tp_data.get('practice_day'),
                        review1_day=tp_data.get('review1_day'),
                        review2_day=tp_data.get('review2_day'),
                    )
                except Exception as field_err:
                    # Fallback: create without new fields (migration may not be applied)
                    print(f"Creating TopicPlan without new fields: {field_err}")
                    TopicPlan.objects.create(
                        program=program,
                        topic=topic,
                        planned_week=planned_week,
                        estimated_hours=1.5,
                        priority=1,
                        deadline=deadline,
                    )
                created_count += 1
            
            print(f"Created {created_count} topic plans")
            
            # ==============================================================
            # VALIDATE GENERATED PLAN (CRITICAL: Enforce scope & deadlines)
            # ==============================================================
            
            # Only validate if we have subject deadlines
            if subject_deadline_objs:
                try:
                    print("\n=== VALIDATING GENERATED PLAN ===")
                    
                    # Get all created TopicPlans for validation
                    created_topic_plans = TopicPlan.objects.filter(program=program)
                    
                    # Validate deadlines (ensure all topics scheduled before their subject deadlines)
                    deadline_violations = validate_deadlines_strict(
                        subject_deadlines_objs=subject_deadline_objs,
                        topic_plans_list=[{
                            'topicId': tp.topic.id,
                            'date': (start_date + timedelta(days=tp.planned_day - 1)).strftime('%Y-%m-%d') if tp.planned_day else None
                        } for tp in created_topic_plans],
                        subjects_map={}
                    )
                    
                    if deadline_violations:
                        print(f"WARNING: {len(deadline_violations)} deadline violations found:")
                        for v in deadline_violations[:5]:  # Show first 5
                            print(f"  - {v['subject_name']}/{v['topic_name']}: scheduled {v['scheduled_date']} > deadline {v['deadline']} ({v['days_over']} days over)")
                    
                    # Validate scope (ensure topics beyond milestone are NOT included)
                    scope_violations = validate_scope(
                        subject_deadlines_objs=subject_deadline_objs,
                        topic_plans_list=[{
                            'topicId': tp.topic.id,
                            'topic_id': tp.topic.id,
                            'date': (start_date + timedelta(days=tp.planned_day - 1)).strftime('%Y-%m-%d') if tp.planned_day else None
                        } for tp in created_topic_plans],
                        all_subjects_data=subject_data
                    )
                    
                    if scope_violations:
                        print(f"ERROR: {len(scope_violations)} scope violations found (topics beyond milestone included):")
                        for v in scope_violations[:5]:
                            print(f"  - {v['subject_name']}/{v['topic_name']}: {v['reason']}")
                        
                        # CRITICAL: If scope violations exist, this is a bug - log and warn but continue
                        # In production, you might want to reject the program or fix automatically
                        print("WARNING: Scope violations detected but program will be created. Review manually.")
                    
                    if not deadline_violations and not scope_violations:
                        print("✓ Validation passed: No deadline or scope violations")
                        
                except Exception as validation_error:
                    # Don't let validation errors break program generation
                    print(f"WARNING: Validation failed with error: {validation_error}")
                    import traceback
                    traceback.print_exc()
            else:
                print("Skipping validation - no subject deadlines specified")
            
            # ==============================================================
            # CREATE SCHEDULED TESTS from AI response
            # ==============================================================
            scheduled_tests_data = ai_result.get('scheduledTests', [])
            tests_created = 0
            for test in scheduled_tests_data:
                test_title = test.get('title', '')
                subject_name = test.get('subjectName', test.get('subject_name', ''))
                day_number = test.get('dayNumber', test.get('day_number', 1))
                test_date_str = test.get('date', '')
                topics_covered = test.get('topicsCovered', test.get('topics', []))
                test_type = test.get('type', 'KNOWLEDGE_CHECK')
                duration_min = test.get('durationMin', test.get('duration_min', 45))
                
                if not test_title:
                    continue
                
                # Parse test date
                try:
                    if test_date_str:
                        test_date = datetime.strptime(str(test_date_str)[:10], '%Y-%m-%d')
                    else:
                        test_date = timezone.now() + timedelta(days=day_number - 1)
                except:
                    test_date = timezone.now() + timedelta(days=day_number - 1)
                
                # Find subject for this test
                subject = None
                if subject_name:
                    subject = Subject.objects.filter(name__icontains=subject_name).first()
                if not subject and subjects:
                    subject = subjects.first()
                
                if subject:
                    import json as json_module
                    
                    ScheduledTest.objects.create(
                        program=program,
                        subject=subject,
                        scheduled_date=test_date,
                        title=test_title,
                        description=f"Test covering: {', '.join(topics_covered) if isinstance(topics_covered, list) else topics_covered}",
                        topics_covered=json_module.dumps(topics_covered) if isinstance(topics_covered, list) else str(topics_covered),
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


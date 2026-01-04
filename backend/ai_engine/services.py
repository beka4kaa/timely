import google.generativeai as genai
import os
import json
from datetime import datetime

# Initialize Gemini
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)

def generate_learning_program_content(goal, timeframe, hours_per_day, current_level, subjects, context=None):
    if not GEMINI_API_KEY:
        raise Exception("GEMINI_API_KEY is not set")

    model = genai.GenerativeModel('gemini-2.5-flash')

    # Extract context parameters with defaults
    ctx = context or {}
    total_weeks = ctx.get('totalWeeks', 12)
    hours_per_week = ctx.get('hoursPerWeek', hours_per_day * 7)
    subject_deadlines = ctx.get('subjectDeadlines', [])
    
    # Calculate derived constraints - user can study up to hours_per_day!
    days_per_week = 7  # Study every day for tight deadlines
    session_minutes = 45
    hours_per_day_available = hours_per_day  # Use actual hours user specified
    sessions_per_day_max = int(hours_per_day * 60 / session_minutes)  # e.g. 12 hours = 16 sessions
    
    # Current date for calculations
    current_date = datetime.now()
    current_date_str = current_date.strftime('%Y-%m-%d')
    
    # Build structured subjects input - ONLY include topics 1..K (in-scope)
    subjects_structured = []
    min_days_until_deadline = 365  # Track closest deadline
    
    for s in subjects:
        topics_list = s.get('topics', [])
        deadline = s.get('deadline', None)
        
        # Find end topic index from milestoneTopicId in subject_deadlines
        end_topic_index = len(topics_list)  # Default: all topics
        for sd in subject_deadlines:
            if str(sd.get('subjectId') or sd.get('subject_id')) == str(s.get('id')):
                if sd.get('milestoneTopicId'):
                    # Find index of milestone topic - this is K, we need topics 1..K
                    for idx, t in enumerate(topics_list):
                        if str(t.get('id')) == str(sd.get('milestoneTopicId')):
                            end_topic_index = idx + 1  # idx is 0-based, so idx+1 gives us count of topics
                            break
                if sd.get('deadline'):
                    deadline = sd.get('deadline')
                break
        
        # Calculate days until deadline
        days_until_deadline = None
        if deadline:
            try:
                print(f"DEBUG: Raw deadline for {s.get('name', 'unknown')}: {deadline}")
                if 'T' in str(deadline):
                    deadline_date = datetime.fromisoformat(str(deadline).replace('Z', '+00:00'))
                else:
                    deadline_date = datetime.strptime(str(deadline)[:10], '%Y-%m-%d')
                days_until_deadline = (deadline_date.replace(tzinfo=None) - current_date.replace(tzinfo=None)).days
                print(f"DEBUG: Days until deadline: {days_until_deadline} (deadline={deadline_date}, now={current_date})")
                days_until_deadline = max(1, days_until_deadline)  # At least 1 day
                min_days_until_deadline = min(min_days_until_deadline, days_until_deadline)
                print(f"DEBUG: min_days_until_deadline now: {min_days_until_deadline}")
            except Exception as e:
                print(f"Error parsing deadline {deadline}: {e}")
                days_until_deadline = 30
        else:
            print(f"DEBUG: No deadline for {s.get('name', 'unknown')}")
        
        # CRITICAL: Only pass topics 1..K (in-scope topics) to AI
        in_scope_topics = topics_list[:end_topic_index]
        
        topic_data = []
        for idx, t in enumerate(in_scope_topics, 1):
            topic_data.append({
                'index': idx,
                'name': t.get('name', ''),
                'status': t.get('status', 'NOT_STARTED')
            })
        
        subjects_structured.append({
            'name': s.get('name', ''),
            'id': s.get('id', ''),
            'deadline': deadline,
            'daysUntilDeadline': days_until_deadline,
            'totalTopicsInScope': len(in_scope_topics),
            'topics': topic_data,
            'hoursTarget': s.get('target_hours_week', hours_per_week // max(len(subjects), 1))
        })
    
    # Calculate total days to plan (use minimum deadline or default 30 days)
    total_days = min(max(min_days_until_deadline, 1), 60) if min_days_until_deadline < 365 else 30
    total_weeks_calc = max(1, (total_days + 6) // 7)  # Round up to weeks
    
    # Format subjects clearly for AI
    subjects_text = ""
    for idx, s in enumerate(subjects_structured, 1):
        topics_str = ", ".join([f"{t['index']}.{t['name']}({t['status']})" for t in s['topics']])
        deadline_info = f"{s['daysUntilDeadline']} days" if s['daysUntilDeadline'] else "No deadline"
        # Show topic status: ✓=MASTERED, ~=IN_PROGRESS, ○=NOT_STARTED
        topics_str = ", ".join([
            f"{t['index']}.{t['name']}({'✓' if t['status'] in ['MASTERED', 'SUCCESS'] else '~' if t['status'] == 'MEDIUM' else '○'})"
            for t in s['topics']
        ])
        subjects_text += f"""
SUBJECT {idx}: {s['name']}
  DEADLINE: {s['deadline'] or 'None'} ({deadline_info} remaining) - CRITICAL!
  TOPICS: [{topics_str}]
  MUST COMPLETE: {s['totalTopicsInScope']} topics IN {deadline_info}!
"""
    
    # Calculate total topics count (for reference only)
    total_topics = sum(s['totalTopicsInScope'] for s in subjects_structured)
    total_topics = max(1, total_topics)
    
    # DEBUG: Print what we're sending to AI
    print("=" * 60)
    print("DEBUG: AI INPUT DATA")
    print("=" * 60)
    
    # Calculate feasibility PER SUBJECT
    hours_per_topic = 1.5
    per_subject_feasibility = []
    overall_feasible = True
    overall_tight = False
    
    for s in subjects_structured:
        subj_topics = s['totalTopicsInScope']
        subj_days = s['daysUntilDeadline'] or 30  # Default 30 if no deadline
        subj_hours_needed = subj_topics * hours_per_topic
        subj_hours_available = subj_days * hours_per_day_available
        subj_feasible = subj_hours_needed <= subj_hours_available
        subj_tight = subj_hours_needed > subj_hours_available * 0.8
        
        topics_per_day_subj = subj_topics / max(1, subj_days)
        
        status = "POSSIBLE"
        if not subj_feasible:
            status = "IMPOSSIBLE"
            overall_feasible = False
        elif subj_tight:
            status = "TIGHT"
            overall_tight = True
        
        per_subject_feasibility.append({
            'name': s['name'],
            'topics': subj_topics,
            'days': subj_days,
            'hours_needed': subj_hours_needed,
            'hours_available': subj_hours_available,
            'topics_per_day': topics_per_day_subj,
            'status': status,
            'deadline': s['deadline']
        })
        
        print(f"Subject: {s['name']}")
        print(f"  Deadline: {s['deadline']} ({subj_days} days)")
        print(f"  Topics: {subj_topics} ({topics_per_day_subj:.1f}/day)")
        print(f"  Hours needed: {subj_hours_needed}, available: {subj_hours_available}")
        print(f"  Status: {status}")
        for t in s['topics']:
            print(f"    {t['index']}. {t['name']} ({t['status']})")
    
    print("=" * 60)
    
    # Build per-subject text for AI
    subjects_text = ""
    for idx, s in enumerate(subjects_structured, 1):
        psf = per_subject_feasibility[idx-1]
        topics_str = ", ".join([
            f"{t['index']}.{t['name']}({'✓' if t['status'] in ['MASTERED', 'SUCCESS'] else '~' if t['status'] == 'MEDIUM' else '○'})"
            for t in s['topics']
        ])
        subjects_text += f"""
SUBJECT {idx}: {s['name']}
  DEADLINE: {s['deadline']} ({psf['days']} days remaining)
  FEASIBILITY: {psf['status']} ({psf['topics_per_day']:.1f} topics/day needed)
  TOPICS ({psf['topics']}): [{topics_str}]
"""
    
    # Overall feasibility
    feasibility_status = "POSSIBLE" if overall_feasible and not overall_tight else ("TIGHT" if overall_feasible else "IMPOSSIBLE")
    
    # Build detailed feasibility message
    problem_subjects = [f for f in per_subject_feasibility if f['status'] == 'IMPOSSIBLE']
    tight_subjects = [f for f in per_subject_feasibility if f['status'] == 'TIGHT']
    
    if problem_subjects:
        problem_msgs = [f"{p['name']} ({p['topics']} topics in {p['days']} days)" for p in problem_subjects]
        feasibility_msg = f"IMPOSSIBLE for: {', '.join(problem_msgs)}"
    elif tight_subjects:
        feasibility_msg = f"TIGHT schedule for: {', '.join([t['name'] for t in tight_subjects])}"
    else:
        feasibility_msg = "All subjects achievable within deadlines"
    
    print(f"OVERALL FEASIBILITY: {feasibility_status}")
    print(f"  {feasibility_msg}")
    print("=" * 60)
    
    # Get overall planning window (use max deadline for planning, but respect each subject's deadline)
    max_days = max(s['daysUntilDeadline'] or 30 for s in subjects_structured)
    min_days = min(s['daysUntilDeadline'] or 30 for s in subjects_structured)
    total_days = max_days  # Plan for entire window
    total_weeks_calc = max(1, (total_days + 6) // 7)
    
    # Calculate overall hours (for prompt)
    hours_needed = total_topics * hours_per_topic
    hours_available = max_days * hours_per_day_available
    is_feasible = overall_feasible
    is_tight = overall_tight
    
    # Calculate deadline dates
    earliest_deadline_date = current_date + __import__('datetime').timedelta(days=min_days)
    latest_deadline_date = current_date + __import__('datetime').timedelta(days=max_days)
    earliest_deadline_str = earliest_deadline_date.strftime('%Y-%m-%d')
    latest_deadline_str = latest_deadline_date.strftime('%Y-%m-%d')
    
    prompt = f"""You are a STRICT study program generator. Be BRUTALLY HONEST about what is achievable.

CURRENT SITUATION:
- Today: {current_date_str}
- Earliest deadline: {earliest_deadline_str} ({min_days} days)
- Latest deadline: {latest_deadline_str} ({max_days} days)
- Total topics: {total_topics}
- Hours per day available: {hours_per_day_available}

FEASIBILITY STATUS: {feasibility_status}
{feasibility_msg}

SUBJECTS (each with OWN deadline):
{subjects_text}

{'⚠️ SOME SUBJECTS ARE IMPOSSIBLE TO COMPLETE FULLY!' if not is_feasible else ''}
{'Since some subjects CANNOT be completed by their deadline:' if not is_feasible else 'Create a complete study program:'}
{'- Create QUICK REVIEW (20-30 min per topic) for topics before their deadline' if not is_feasible else '- Schedule all topics before their deadlines'}
{'- Prioritize NOT_STARTED topics over MASTERED ones' if not is_feasible else '- Use available study hours efficiently'}
{'- After deadline, schedule REINFORCEMENT sessions for deeper learning' if not is_feasible else '- Pack sessions densely if needed'}
{'- Be HONEST: say this is a quick review, NOT full study' if not is_feasible else ''}

SCHEDULE RULES:
- Each subject has its OWN deadline - respect it!
- For impossible subjects: quick review BEFORE deadline, reinforcement AFTER
- Sessions: 08:00 to 20:00
- Session duration: 20-30 min (quick review) or 45 min (full study)

OUTPUT (JSON only, no markdown):
{{
  "feasibility": "{feasibility_status}",
  "feasibilityMessage": "{feasibility_msg}",
  "programTitle": "{'Quick Review + Reinforcement' if not is_feasible else 'Intensive Study Plan'}",
  "description": "{'Quick review before deadline, reinforcement after' if not is_feasible else 'Complete study program'}",
  "totalWeeks": {total_weeks_calc},
  "totalDays": {total_days},
  
  "dayPlans": [
    {{
      "dayNumber": 1,
      "date": "{current_date_str}",
      "weekNumber": 1,
      "sessions": [
        {{"order": 1, "startTime": "08:00", "subjectName": "...", "topicName": "...", "type": "QUICK_REVIEW", "durationMin": 20}}
      ]
    }}
  ],
  
  "weekPlans": [{{"weekNumber": 1, "focus": "..."}}],
  "topicPlans": [{{"topicName": "...", "subjectName": "...", "plannedDay": 1, "plannedWeek": 1}}],
  "scheduledTests": []
}}

CRITICAL: 
- Include "feasibility": "{feasibility_status}"
- For IMPOSSIBLE/TIGHT subjects, create quick review before deadline
- You may schedule reinforcement AFTER deadline for deeper learning
"""
    
    try:
        response = model.generate_content(prompt)
        text = response.text.replace('```json', '').replace('```', '').strip()
        result = json.loads(text)
        
        # Debug output
        print(f"AI generated: weekPlans={len(result.get('weekPlans', []))}, topicPlans={len(result.get('topicPlans', []))}, tests={len(result.get('scheduledTests', []))}")
        
        # Validate required fields
        if not isinstance(result, dict):
            raise ValueError("AI response is not a valid object")
        return result
    except json.JSONDecodeError as e:
        print(f"Error parsing AI response JSON: {e}")
        print(f"Raw response: {response.text[:500] if response else 'No response'}")
        # Return a fallback structure instead of None
        return {
            "description": "AI generation failed - using default program",
            "strategy": "Manual planning recommended",
            "totalWeeks": total_weeks,
            "weekPlans": [],
            "topicPlans": [],
            "scheduledTests": []
        }
    except Exception as e:
        print(f"Error generating program: {e}")
        return {
            "description": f"Error: {str(e)}",
            "strategy": "Manual planning recommended",
            "totalWeeks": total_weeks,
            "weekPlans": [],
            "topicPlans": [],
            "scheduledTests": []
        }

def generate_fast_topics(subject_name, extra_prompt=""):
    if not GEMINI_API_KEY: raise Exception("GEMINI_API_KEY is not set")
    model = genai.GenerativeModel('gemini-2.0-flash')
    
    prompt = f"""
    Analyze this text and extract TOPICS and SUBTOPICS for the subject: {subject_name}.
    
    INPUT TEXT:
    {extra_prompt}
    
    RULES:
    1. Identify main topics (chapters, sections like "1)", "2)", "Chapter 1", etc.)
    2. Identify subtopics (sub-sections like "1.1", "1.2", "2.1", bullet points under topics)
    3. Keep original names but make them clean and concise
    4. If text has numbered structure (1, 1.1, 1.2, 2, 2.1...) - preserve hierarchy
    5. If no clear hierarchy, create only topics (no subtopics)
    6. Ignore review exercises, end-of-chapter exercises - don't include them
    
    RESPONSE FORMAT (JSON LIST):
    [
      {{
        "name": "Main Topic Name",
        "estimatedHours": 3,
        "difficulty": "Medium",
        "subtopics": [
          {{ "name": "Subtopic 1.1 Name" }},
          {{ "name": "Subtopic 1.2 Name" }}
        ]
      }},
      {{
        "name": "Another Topic without subtopics",
        "estimatedHours": 2,
        "difficulty": "Easy",
        "subtopics": []
      }}
    ]
    
    Return ONLY valid JSON array, no markdown, no explanations.
    """
    try:
        response = model.generate_content(prompt)
        text = response.text.replace('```json', '').replace('```', '').strip()
        return json.loads(text)
    except Exception as e:
        print(f"Error generating fast topics: {e}")
        return []

def analyze_progress(context_data):
    if not GEMINI_API_KEY: raise Exception("GEMINI_API_KEY is not set")
    model = genai.GenerativeModel('gemini-2.0-flash')
    
    prompt = f"""
    Analyze the user's study progress.
    DATA: {json.dumps(context_data)}
    
    Provide identifying strengths, weaknesses, and a recommendation.
    RESPONSE FORMAT (JSON):
    {{
        "strengths": ["...", "..."],
        "weaknesses": ["...", "..."],
        "recommendation": "..."
    }}
    """
    try:
        response = model.generate_content(prompt)
        text = response.text.replace('```json', '').replace('```', '').strip()
        return json.loads(text)
    except Exception as e:
        print(f"Error analyzing progress: {e}")
        return {"error": "Failed to analyze"}

def modify_program(current_program_summary, user_request):
    if not GEMINI_API_KEY: raise Exception("GEMINI_API_KEY is not set")
    model = genai.GenerativeModel('gemini-2.0-flash')
    
    prompt = f"""
    Modify this learning program based on user request.
    CURRENT PROGRAM: {current_program_summary}
    USER REQUEST: {user_request}
    
    Return the suggested changes in FREE TEXT format (Markdown ok), 
    but conclude with a JSON block of specific actions if any (like adding topics).
    """
    try:
        response = model.generate_content(prompt)
        return {"text": response.text} # simplified for now
    except Exception as e:
        return {"error": str(e)}

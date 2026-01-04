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

    model = genai.GenerativeModel('gemini-2.0-flash')

    # Extract context parameters with defaults
    ctx = context or {}
    total_weeks = ctx.get('totalWeeks', 12)
    hours_per_week = ctx.get('hoursPerWeek', hours_per_day * 7)
    subject_deadlines = ctx.get('subjectDeadlines', [])
    
    # Intensity settings from frontend
    intensity_level = ctx.get('intensityLevel', 'normal')
    min_topics_per_day = ctx.get('minTopicsPerDay', 3)
    max_topics_per_day = ctx.get('maxTopicsPerDay', 6)
    study_days = ctx.get('studyDays', [1, 2, 3, 4, 5, 6, 7])  # 1=Mon, 7=Sun
    
    print(f"INTENSITY CONFIG: {intensity_level}, {min_topics_per_day}-{max_topics_per_day} topics/day, study days: {study_days}")
    
    # Calculate derived constraints - user can study up to hours_per_day!
    days_per_week = len(study_days)  # Only count study days
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
    
    # Build per-subject text for AI with STRICT deadline requirements
    subjects_text = ""
    deadline_constraints = []
    for idx, s in enumerate(subjects_structured, 1):
        psf = per_subject_feasibility[idx-1]
        topics_str = ", ".join([
            f"{t['index']}.{t['name']}({'✓' if t['status'] in ['MASTERED', 'SUCCESS'] else '~' if t['status'] == 'MEDIUM' else '○'})"
            for t in s['topics']
        ])
        
        # Calculate actual deadline date string
        deadline_date_str = "No deadline"
        if s['deadline']:
            try:
                if 'T' in str(s['deadline']):
                    dl_date = datetime.fromisoformat(str(s['deadline']).replace('Z', '+00:00'))
                else:
                    dl_date = datetime.strptime(str(s['deadline'])[:10], '%Y-%m-%d')
                deadline_date_str = dl_date.strftime('%Y-%m-%d')
            except:
                deadline_date_str = str(s['deadline'])[:10]
        
        subjects_text += f"""
SUBJECT {idx}: {s['name']}
  ⚠️ HARD DEADLINE: {deadline_date_str} ({psf['days']} days from today)
  FEASIBILITY: {psf['status']} ({psf['topics_per_day']:.1f} topics/day needed)
  TOPICS TO COMPLETE ({psf['topics']} total): [{topics_str}]
  🚨 ALL {psf['topics']} TOPICS MUST BE SCHEDULED BEFORE {deadline_date_str}!
"""
        # Add to constraints list for emphasis
        if deadline_date_str != "No deadline":
            deadline_constraints.append(f"- {s['name']}: ALL topics must finish by {deadline_date_str} (day {psf['days']})")
    
    # Build deadline constraints section
    deadline_constraints_text = "\n".join(deadline_constraints) if deadline_constraints else "No specific deadlines set"
    
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
    
    # Use intensity settings from frontend
    MIN_TOPICS_PER_DAY = min_topics_per_day  # From frontend
    MAX_TOPICS_PER_DAY = max_topics_per_day  # From frontend
    
    # Calculate effective study days (only count days user is willing to study)
    effective_days_available = max_days * len(study_days) // 7  # Scale by study days per week
    
    required_topics_per_day = total_topics / max(1, effective_days_available)
    
    if required_topics_per_day < MIN_TOPICS_PER_DAY:
        # Compress schedule for high-intensity learning
        actual_days_needed = max(1, total_topics // MIN_TOPICS_PER_DAY + (1 if total_topics % MIN_TOPICS_PER_DAY else 0))
        total_days = min(max_days, actual_days_needed)
        topics_per_day = MIN_TOPICS_PER_DAY
        print(f"HIGH-INTENSITY MODE: Compressing schedule to {total_days} days ({topics_per_day} topics/day)")
    elif required_topics_per_day > MAX_TOPICS_PER_DAY:
        topics_per_day = MAX_TOPICS_PER_DAY
        total_days = max_days
        print(f"WARNING: Required {required_topics_per_day:.1f} topics/day exceeds max. Using {MAX_TOPICS_PER_DAY}/day")
    else:
        topics_per_day = int(required_topics_per_day) + 1
        total_days = max_days
    
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
    
    # Map study days to names
    day_names = {1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun'}
    study_days_text = ', '.join([day_names.get(d, str(d)) for d in sorted(study_days)])
    
    # Intensity level descriptions
    intensity_descriptions = {
        'relaxed': 'Relaxed pace with plenty of breaks',
        'normal': 'Balanced study pace',
        'intense': 'High-intensity focused learning',
        'extreme': 'Maximum intensity sprint mode'
    }
    intensity_desc = intensity_descriptions.get(intensity_level, 'Balanced study pace')
    
    prompt = f"""You are a STRICT study program generator. You MUST respect individual subject deadlines.

CURRENT SITUATION:
- Today: {current_date_str}
- Total topics to cover: {total_topics}
- Hours per day available: {hours_per_day_available}
- Planning window: {total_days} days

🚨 CRITICAL DEADLINE CONSTRAINTS (MUST BE RESPECTED):
{deadline_constraints_text}

STUDY PREFERENCES:
- Intensity: {intensity_level.upper()} ({intensity_desc})
- Study days: {study_days_text} ({len(study_days)} days/week)
- Topics per day: {MIN_TOPICS_PER_DAY}-{MAX_TOPICS_PER_DAY}

FEASIBILITY STATUS: {feasibility_status}
{feasibility_msg}

SUBJECTS WITH INDIVIDUAL DEADLINES:
{subjects_text}

{'⚠️ WARNING: SOME SUBJECTS MAY NOT BE COMPLETABLE BY DEADLINE!' if not is_feasible else ''}

SCHEDULING RULES:
1. 🚨 EACH SUBJECT has its OWN deadline - schedule ALL topics for that subject BEFORE its deadline!
2. For subjects with earlier deadlines, prioritize them first
3. {MIN_TOPICS_PER_DAY}-{MAX_TOPICS_PER_DAY} topics per day
4. Sessions: 08:00 to 20:00, duration 30-45 min each
5. Mix subjects within days to avoid fatigue
6. ONLY schedule on: {study_days_text}

DEADLINE PRIORITY ORDER:
- Schedule subjects with EARLIEST deadlines FIRST
- A topic for Subject A (deadline Jan 10) should come BEFORE a topic for Subject B (deadline Jan 20)
- Each topicPlan must include the deadline date from its subject

OUTPUT FORMAT (JSON only, no markdown):
{{
  "feasibility": "{feasibility_status}",
  "feasibilityMessage": "Deadline-aware analysis",
  "programTitle": "Study Plan",
  "description": "Deadline-optimized study program",
  "startDate": "{current_date_str}",
  "endDate": "{latest_deadline_str}",
  "totalWeeks": {total_weeks_calc},
  "totalDays": {total_days},
  
  "dayPlans": [
    {{"dayNumber": 1, "date": "{current_date_str}", "weekNumber": 1, "sessions": [{{"order": 1, "subjectName": "SubjectA", "topicName": "Topic1", "durationMin": 45}}]}}
  ],
  
  "topicPlans": [
    {{"topicName": "Topic1", "subjectName": "SubjectA", "plannedDay": 1, "plannedWeek": 1, "deadline": "YYYY-MM-DD"}}
  ],
  
  "weekPlans": [
    {{"weekNumber": 1, "startDate": "{current_date_str}", "endDate": "YYYY-MM-DD", "focus": "Week focus"}}
  ],
  "scheduledTests": []
}}

IMPORTANT: 
- Generate dayPlans and topicPlans for ALL {total_days} days!
- ALL topic names and subject names must EXACTLY match the subjects and topics listed above
- Each topicPlan MUST include the "deadline" field with the subject's deadline date (YYYY-MM-DD format)

🚨 DEADLINE VERIFICATION:
- For EACH subject, verify ALL its topics are scheduled BEFORE that subject's deadline
- Topics for subjects with earlier deadlines should be scheduled FIRST
- The "deadline" field in topicPlans must match the subject's deadline from the constraints above

REMEMBER: ALL {total_topics} topics must be assigned. Prioritize subjects with earlier deadlines!
"""
    
    # Debug: Log prompt details before AI call
    print(f"=== CALLING AI ===")
    print(f"Prompt length: {len(prompt)} chars")
    print(f"Total days: {total_days}, Total weeks: {total_weeks_calc}, Total topics: {total_topics}")
    print(f"Hours per day: {hours_per_day_available}")
    
    try:
        response = model.generate_content(prompt)
        if not response or not response.text:
            print("ERROR: AI returned empty response!")
            raise Exception("Empty AI response")
        
        print(f"AI response length: {len(response.text)} chars")
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
        # Return a fallback structure with dayPlans
        return {
            "programTitle": "Quick Program",
            "description": "AI generation failed - using fallback",
            "feasibility": "UNKNOWN",
            "feasibilityMessage": f"JSON parse error: {str(e)[:100]}",
            "totalWeeks": total_weeks,
            "totalDays": total_days,
            "dayPlans": [],  # Required by views.py
            "weekPlans": [],
            "topicPlans": [],
            "scheduledTests": []
        }
    except Exception as e:
        print(f"Error generating program: {e}")
        import traceback
        traceback.print_exc()
        return {
            "programTitle": "Fallback Program",
            "description": f"Error: {str(e)}",
            "feasibility": "ERROR",
            "feasibilityMessage": str(e)[:200],
            "totalWeeks": total_weeks,
            "totalDays": total_days,
            "dayPlans": [],  # Required by views.py
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

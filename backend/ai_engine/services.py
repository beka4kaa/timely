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
    
    # Calculate total topics count and sessions needed (with safe division)
    total_topics = sum(s['totalTopicsInScope'] for s in subjects_structured)
    total_topics = max(1, total_topics)  # At least 1 to prevent division errors
    topics_per_day = total_topics / max(1, total_days)
    sessions_needed_per_day = max(6, min(20, int(topics_per_day * 2)))  # Cap at 20 sessions
    
    # DEBUG: Print what we're sending to AI
    print("=" * 60)
    print("DEBUG: AI INPUT DATA")
    print("=" * 60)
    for s in subjects_structured:
        print(f"Subject: {s['name']}")
        print(f"  Deadline: {s['deadline']} ({s['daysUntilDeadline']} days)")
        print(f"  Topics count: {len(s['topics'])}")
        for t in s['topics']:
            print(f"    {t['index']}. {t['name']} ({t['status']})")
    print(f"Total topics to learn: {total_topics}")
    print(f"Total days available: {total_days}")
    print(f"Topics per day needed: {topics_per_day:.1f}")
    print(f"Sessions per day needed: {sessions_needed_per_day}")
    print("=" * 60)
    
    # Calculate feasibility
    # Assume 1.5 hours per topic (theory + practice), 12 hours max per day
    hours_per_topic = 1.5
    hours_needed = total_topics * hours_per_topic
    hours_available = total_days * hours_per_day_available
    is_feasible = hours_needed <= hours_available
    is_tight = hours_needed > hours_available * 0.8  # 80%+ capacity = tight
    
    print(f"FEASIBILITY CHECK:")
    print(f"  Hours needed: {hours_needed}")
    print(f"  Hours available: {hours_available}")
    print(f"  Feasible: {is_feasible}, Tight: {is_tight}")
    
    # Calculate deadline date
    deadline_date = current_date + __import__('datetime').timedelta(days=total_days)
    deadline_date_str = deadline_date.strftime('%Y-%m-%d')
    
    # Build prompt with honest feasibility assessment
    feasibility_status = "POSSIBLE" if is_feasible and not is_tight else ("TIGHT" if is_feasible else "IMPOSSIBLE")
    
    prompt = f"""You are a STRICT study program generator. Be HONEST about what is achievable.

CURRENT SITUATION:
- Date: {current_date_str}
- Deadline: {deadline_date_str} ({total_days} days available)
- Total topics: {total_topics}
- Hours per day: {hours_per_day_available}
- Hours needed: {hours_needed} (at 1.5h per topic)
- Hours available: {hours_available}

FEASIBILITY ANALYSIS: {feasibility_status}
{f"⚠️ THIS PROGRAM IS IMPOSSIBLE TO COMPLETE FULLY!" if not is_feasible else ""}
{f"⚠️ This program is TIGHT - student must study {hours_per_day_available}h/day non-stop!" if is_tight and is_feasible else ""}

SUBJECTS AND TOPICS:
{subjects_text}

YOUR TASK:
{"Since full completion is IMPOSSIBLE, create a QUICK REVIEW program that:" if not is_feasible else "Create a complete study program that:"}
{"- Covers the MOST IMPORTANT topics from each subject" if not is_feasible else "- Schedules ALL topics before the deadline"}
{"- Prioritizes topics that are NOT_STARTED over MASTERED" if not is_feasible else "- Uses all available study hours"}
{"- Gives brief 20-30min review per topic" if not is_feasible else "- Gives proper 45min+ study per topic"}
- NEVER extends beyond {deadline_date_str}
- Honestly reports feasibility status

SCHEDULE RULES:
- Day 1 = {current_date_str}
- Last allowed day = Day {total_days} ({deadline_date_str})
- NO sessions on Day {total_days + 1} or later!
- Sessions: 08:00 to 20:00
- Session duration: 45 min (full) or 20 min (quick review)

OUTPUT (JSON only, no markdown):
{{
  "feasibility": "{feasibility_status}",
  "feasibilityMessage": "{f'Cannot complete {total_topics} topics in {total_days} days. Created quick review instead.' if not is_feasible else f'Program achievable in {total_days} days.'}",
  "programTitle": "{'Quick Review Program' if not is_feasible else f'{total_days}-Day Intensive Course'}",
  "description": "...",
  "totalWeeks": {total_weeks_calc},
  "totalDays": {total_days},
  
  "dayPlans": [
    {{
      "dayNumber": 1,
      "date": "{current_date_str}",
      "weekNumber": 1,
      "sessions": [
        {{"order": 1, "startTime": "08:00", "subjectName": "...", "topicName": "...", "type": "STUDY", "durationMin": {20 if not is_feasible else 45}}}
      ]
    }}
  ],
  
  "weekPlans": [{{"weekNumber": 1, "focus": "..."}}],
  "topicPlans": [{{"topicName": "...", "subjectName": "...", "plannedDay": 1, "plannedWeek": 1}}],
  "scheduledTests": []
}}

CRITICAL: Include "feasibility": "{feasibility_status}" in your response!
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

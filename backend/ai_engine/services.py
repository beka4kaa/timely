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
    
    # Calculate derived constraints
    days_per_week = 6
    sessions_per_day_max = 3
    session_minutes = 45
    hours_per_day_available = hours_per_week / days_per_week
    
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
                if 'T' in str(deadline):
                    deadline_date = datetime.fromisoformat(str(deadline).replace('Z', '+00:00'))
                else:
                    deadline_date = datetime.strptime(str(deadline)[:10], '%Y-%m-%d')
                days_until_deadline = (deadline_date.replace(tzinfo=None) - current_date.replace(tzinfo=None)).days
                days_until_deadline = max(1, days_until_deadline)  # At least 1 day
                min_days_until_deadline = min(min_days_until_deadline, days_until_deadline)
            except Exception as e:
                print(f"Error parsing deadline {deadline}: {e}")
                days_until_deadline = 30
        
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
    total_days = min(min_days_until_deadline, 60) if min_days_until_deadline < 365 else 30
    total_weeks_calc = (total_days + 6) // 7  # Round up to weeks
    
    # Format subjects clearly for AI
    subjects_text = ""
    for idx, s in enumerate(subjects_structured, 1):
        topics_str = ", ".join([f"{t['index']}.{t['name']}({t['status']})" for t in s['topics']])
        deadline_info = f"{s['daysUntilDeadline']} days" if s['daysUntilDeadline'] else "No deadline"
        subjects_text += f"""
SUBJECT {idx}: {s['name']}
  Deadline: {s['deadline'] or 'None'} ({deadline_info} remaining)
  Topics to learn (in order): [{topics_str}]
  Total topics: {s['totalTopicsInScope']}
"""
    
    # ALWAYS daily planning with weekly summaries
    prompt = f"""You are a 61-school-style study program generator. Create a COMPLETE DAY-BY-DAY study schedule.

CURRENT DATE: {current_date_str}

TIME BUDGET:
- Total days to plan: {total_days}
- Hours per day available: {hours_per_day_available:.1f}
- Sessions per day: {sessions_per_day_max}
- Session duration: {session_minutes} min
- Study days per week: {days_per_week}

SUBJECTS TO STUDY:
{subjects_text}

CRITICAL REQUIREMENTS:
1. Generate a SPECIFIC schedule for EVERY SINGLE DAY
2. Each day must list EXACT sessions (subject, topic, type, duration)
3. User should NOT need to think - just follow the daily plan
4. Include ALL topics from each subject in strict order (1, 2, 3...)
5. For each topic: schedule THEORY day, then PRACTICE day, then REVIEW day
6. Weekly summary shows what topics are covered that week
7. Schedule tests: mini-quiz every 3-4 days, weekly test on day 6-7

OUTPUT FORMAT (JSON only, no markdown):
{{
  "programTitle": "61-School Study Program",
  "description": "Day-by-day study schedule with weekly summaries",
  "strategy": "Each day has specific sessions - just follow the plan",
  "totalWeeks": {total_weeks_calc},
  "totalDays": {total_days},
  "planningMode": "DAILY",
  
  "weekSummaries": [
    {{
      "weekNumber": 1,
      "dateRange": "Jan 3 - Jan 9",
      "mainTopics": ["Physics: Kinematics, Dynamics", "Math: Functions, Quadratics"],
      "totalHours": 20,
      "testsThisWeek": ["Week 1 Physics Quiz", "Week 1 Math Quiz"],
      "goals": "Master foundational topics"
    }}
  ],
  
  "dayPlans": [
    {{
      "dayNumber": 1,
      "dayOfWeek": "Friday",
      "date": "{current_date_str}",
      "weekNumber": 1,
      "totalHours": 4,
      "sessions": [
        {{
          "order": 1,
          "startTime": "09:00",
          "subjectName": "A Level Physics",
          "topicName": "Kinematics",
          "type": "THEORY",
          "durationMin": 45,
          "tasks": "Read chapter, take notes, solve 5 examples"
        }},
        {{
          "order": 2,
          "startTime": "10:00",
          "subjectName": "A Level Physics",
          "topicName": "Kinematics",
          "type": "PRACTICE",
          "durationMin": 45,
          "tasks": "Solve 15 problems (10 easy, 5 medium)"
        }},
        {{
          "order": 3,
          "startTime": "11:00",
          "subjectName": "A Level Math",
          "topicName": "Functions",
          "type": "THEORY",
          "durationMin": 45,
          "tasks": "Read chapter, work through examples"
        }}
      ]
    }},
    {{
      "dayNumber": 2,
      "dayOfWeek": "Saturday",
      "date": "YYYY-MM-DD",
      "weekNumber": 1,
      "totalHours": 4,
      "sessions": [...]
    }}
  ],
  
  "weekPlans": [
    {{
      "weekNumber": 1,
      "startOffset": 0,
      "endOffset": 7,
      "focus": "Build foundations in Physics and Math",
      "notes": "Focus on understanding concepts before heavy practice",
      "subjectHours": {{"A Level Physics": 10, "A Level Math": 8, "A Level Further Math": 6}}
    }}
  ],
  
  "topicPlans": [
    {{
      "topicName": "Kinematics",
      "subjectName": "A Level Physics",
      "plannedWeek": 1,
      "plannedDay": 1,
      "estimatedHours": 3,
      "priority": 1,
      "type": "THEORY"
    }}
  ],
  
  "scheduledTests": [
    {{
      "title": "Day 3 Physics Mini-Quiz",
      "scheduledWeek": 1,
      "scheduledDay": 3,
      "subjectName": "A Level Physics",
      "topics": ["Kinematics"],
      "type": "MINI_QUIZ",
      "durationMin": 20
    }},
    {{
      "title": "Week 1 Comprehensive Test",
      "scheduledWeek": 1,
      "scheduledDay": 7,
      "subjectName": "Mixed",
      "topics": ["Kinematics", "Functions"],
      "type": "WEEKLY_TEST",
      "durationMin": 60
    }}
  ]
}}

IMPORTANT:
- Generate dayPlans for ALL {total_days} days
- Each day has 2-4 study sessions
- Alternate between subjects within each day
- Sessions include SPECIFIC tasks (not generic)
- Include actual topic names from the input
- weekSummaries help user see the big picture
- Return ONLY valid JSON, no explanations
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

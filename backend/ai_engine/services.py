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
    
    # Determine planning mode: daily (short-term) or weekly (long-term)
    is_short_term = min_days_until_deadline < 14  # Less than 2 weeks
    
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
    
    # Adjust prompt based on planning mode
    if is_short_term:
        planning_unit = "DAY"
        time_budget = f"""
- Total days available: {min_days_until_deadline}
- Hours per day: {hours_per_day_available:.1f}
- Sessions per day: {sessions_per_day_max}
- Session duration: {session_minutes} min
"""
        output_structure = f"""
OUTPUT FORMAT (JSON only, no markdown):
{{
  "programTitle": "Intensive Study Plan",
  "description": "Short-term intensive preparation",
  "strategy": "Daily focused sessions with immediate practice",
  "totalWeeks": 1,
  "totalDays": {min_days_until_deadline},
  "planningMode": "DAILY",
  "weekPlans": [
    {{
      "weekNumber": 1,
      "startOffset": 0,
      "endOffset": {min_days_until_deadline},
      "focus": "Intensive preparation",
      "notes": "Daily schedule below",
      "subjectHours": {{"Subject Name": {hours_per_day_available:.1f}}}
    }}
  ],
  "dayPlans": [
    {{
      "dayNumber": 1,
      "date": "YYYY-MM-DD",
      "focus": "Day 1 focus",
      "sessions": [
        {{
          "subjectName": "Subject Name",
          "topicName": "Topic Name",
          "type": "THEORY|PRACTICE",
          "durationMin": 45,
          "order": 1
        }}
      ]
    }}
  ],
  "topicPlans": [
    {{
      "topicName": "Exact topic name",
      "subjectName": "Subject name",
      "plannedWeek": 1,
      "plannedDay": 1,
      "estimatedHours": 2,
      "priority": 1,
      "type": "THEORY"
    }}
  ],
  "scheduledTests": [
    {{
      "title": "Final Test",
      "scheduledWeek": 1,
      "scheduledDay": {min_days_until_deadline},
      "subjectName": "Subject",
      "topics": ["Topic 1"],
      "type": "FINAL_TEST",
      "durationMin": 60
    }}
  ]
}}
"""
        special_instructions = f"""
CRITICAL - SHORT DEADLINE MODE:
- You only have {min_days_until_deadline} DAYS, not weeks!
- Create a DAY-BY-DAY schedule in "dayPlans"
- Each day must have specific study sessions
- Prioritize most urgent subjects first
- Focus on core material, skip optional content
- Schedule mini-tests every 2-3 days
- Include final test on last day before deadline
"""
    else:
        # Standard weekly planning
        planning_unit = "WEEK"
        time_budget = f"""
- Hours per week: {hours_per_week}
- Study days per week: {days_per_week}
- Sessions per day: {sessions_per_day_max}
- Session duration: {session_minutes} min
- Total weeks: {total_weeks}
"""
        output_structure = f"""
OUTPUT FORMAT (JSON only, no markdown):
{{
  "programTitle": "61-School Study Program",
  "description": "Intensive study program with spaced repetition",
  "strategy": "Sequential learning with frequent testing",
  "totalWeeks": {total_weeks},
  "planningMode": "WEEKLY",
  "weekPlans": [
    {{
      "weekNumber": 1,
      "startOffset": 0,
      "endOffset": 7,
      "focus": "Week focus",
      "notes": "Additional notes",
      "subjectHours": {{"Subject Name": 10}}
    }}
  ],
  "topicPlans": [
    {{
      "topicName": "Exact topic name",
      "subjectName": "Subject name",
      "plannedWeek": 1,
      "estimatedHours": 3,
      "priority": 1,
      "type": "THEORY"
    }}
  ],
  "scheduledTests": [
    {{
      "title": "Week 1 Test",
      "scheduledWeek": 1,
      "subjectName": "Subject",
      "topics": ["Topic 1"],
      "type": "WEEKLY_TEST",
      "durationMin": 45
    }}
  ]
}}
"""
        special_instructions = """
STANDARD WEEKLY PLANNING:
- Generate plans for ALL weeks
- Include EVERY topic listed above
- Add spaced repetition reviews at +7 days
- Generate at least 1 test per week
"""

    prompt = f"""You are a 61-school-style study program generator.

CURRENT DATE: {current_date_str}
PLANNING MODE: {planning_unit}

TIME BUDGET:
{time_budget}

SUBJECTS TO STUDY:
{subjects_text}

MANDATORY REQUIREMENTS:
1. INCLUDE EVERY TOPIC listed above - no exceptions
2. Schedule topics in STRICT ORDER (1, 2, 3...) per subject
3. For each topic: THEORY session + PRACTICE session
4. Generate tests for assessment
5. Distribute time across all subjects proportionally

{special_instructions}

{output_structure}

CRITICAL: Return ONLY valid JSON. Include ALL topics. No markdown.
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

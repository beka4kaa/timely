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
    
    # Build structured subjects input for 61-school style
    subjects_structured = []
    for s in subjects:
        topics_list = s.get('topics', [])
        deadline = s.get('deadline', None)
        
        # Find end topic index from milestoneTopicId in subject_deadlines
        end_topic_index = len(topics_list)  # Default: all topics
        for sd in subject_deadlines:
            if str(sd.get('subjectId') or sd.get('subject_id')) == str(s.get('id')):
                if sd.get('milestoneTopicId'):
                    # Find index of milestone topic
                    for idx, t in enumerate(topics_list):
                        if str(t.get('id')) == str(sd.get('milestoneTopicId')):
                            end_topic_index = idx + 1
                            break
                if sd.get('deadline'):
                    deadline = sd.get('deadline')
                break
        
        topic_statuses = [t.get('status', 'NOT_STARTED') for t in topics_list]
        topic_names = [t.get('name', '') for t in topics_list]
        
        subjects_structured.append({
            'name': s.get('name', ''),
            'id': s.get('id', ''),
            'deadline': deadline,
            'endTopicIndexK': end_topic_index,
            'topicsOrdered': topic_names,
            'topicStatus': topic_statuses,
            'hoursTarget': s.get('target_hours_week', hours_per_week // max(len(subjects), 1))
        })
    
    # Format subjects for prompt
    subjects_text = ""
    for idx, s in enumerate(subjects_structured, 1):
        subjects_text += f"""
{idx}) {s['name']}
deadline={s['deadline'] or 'None'}
endTopicIndexK={s['endTopicIndexK']}
topicsOrdered={s['topicsOrdered']}
topicStatus={s['topicStatus']}
hoursTarget={s['hoursTarget']}
"""
    
    prompt = f"""You are a strict study-program optimizer. Your job is to generate a 61-school-style study program: high workload, clear sequencing, frequent testing, and spaced repetition. Do NOT write generic advice. Produce a concrete weekly plan.

IMPORTANT: You must follow ALL constraints. If a constraint conflicts, explain the conflict and propose the smallest fix, then generate the plan.

GOAL
Build a plan that maximizes mastery by deadline using:
- Sequenced learning (topic order is mandatory)
- High practice volume
- Weekly tests + mini-quizzes
- Spaced repetition of previously learned material
- Measurable tasks per session

HARD CONSTRAINTS (must satisfy)
1) Weekly time budget:
   - Total study hours per week = {hours_per_week}
   - Max study days per week = {days_per_week}
   - Max sessions per day = {sessions_per_day_max}
   - Default session duration = {session_minutes} minutes
2) Topic ordering rule (MANDATORY):
   - For each subject, topics have an explicit order.
   - If user says "learn up to topic K", then ONLY topics 1..K are in scope for the deadline.
   - Topics after K can be optionally scheduled ONLY as "light preview" and ONLY if all in-scope topics + reviews fit.
3) Deadline rule:
   - Each subject has a deadline date and an "end topic index K".
   - By the deadline, topics 1..K must be completed at least once + reviewed at least twice.
4) 61-school testing rule:
   - Every week must include:
     a) 2 mini-quizzes (15–20 min) on current-week material
     b) 1 weekly test (45–60 min) covering current + previous material
     c) 1 mixed problem set (timed) for speed/accuracy
5) Spaced repetition rule:
   - After a topic is first learned, schedule reviews on:
     +2 days, +7 days, +21 days (or nearest feasible sessions)
   - Reviews must include practice problems, not only reading.
6) Workload intensity:
   - At least 60% of total time must be problem-solving (practice), max 40% theory.
   - For math/physics, each "practice session" must specify number of problems (e.g., 20 easy + 10 medium + 5 hard).
7) Output format:
   - Return ONLY valid JSON (no markdown).
   - JSON must match the schema described in OUTPUT SCHEMA below.

SOFT PREFERENCES (follow if possible)
- Prioritize weak topics first IF it does not violate ordering.
- Keep one "buffer / catch-up" slot per week.
- Front-load early weeks slightly (more hours early) but never exceed weekly max.

INPUT
HOURS_PER_WEEK_MAX={hours_per_week}
DAYS_PER_WEEK={days_per_week}
SESSIONS_PER_DAY_MAX={sessions_per_day_max}
SESSION_MINUTES={session_minutes}
TOTAL_WEEKS={total_weeks}

Subjects:{subjects_text}

PLANNING METHOD (must use)
- Step 1: Determine in-scope topics for each subject: topics[1..K]
- Step 2: Allocate weekly hours proportionally to subject priorities + closeness of deadline
- Step 3: For each subject, schedule topics in strict order (no skipping)
- Step 4: Insert reviews for each topic at +2d, +7d, +21d (approximate)
- Step 5: Insert quizzes and tests (required)
- Step 6: Validate constraints and output checks

OUTPUT SCHEMA (must follow exactly):
{{
  "programTitle": "string",
  "description": "string",
  "strategy": "string",
  "totalWeeks": number,
  "weeks": [
    {{
      "weekIndex": 1,
      "weekNumber": 1,
      "dateRange": "YYYY-MM-DD..YYYY-MM-DD",
      "startOffset": 0,
      "endOffset": 7,
      "focus": "string",
      "notes": "string",
      "subjectHours": {{ "subject_name": number }},
      "targets": [
        {{
          "subject": "string",
          "topic": "string",
          "topicName": "string",
          "subjectName": "string",
          "type": "THEORY|PRACTICE|REVIEW|QUIZ|TEST|MIXED_SET",
          "durationMin": number,
          "estimatedHours": number,
          "plannedWeek": number,
          "priority": 1,
          "tasks": [
            {{ "text": "string", "count": number, "difficulty": "EASY|MEDIUM|HARD|MIXED" }}
          ],
          "notes": "string"
        }}
      ],
      "weeklyTest": {{
        "subjectMix": ["string"],
        "durationMin": number,
        "coverage": "string",
        "tasks": [
          {{ "text": "string", "count": number, "difficulty": "MIXED" }}
        ]
      }},
      "miniQuizzes": [
        {{
          "durationMin": number,
          "coverage": "string",
          "tasks": [
            {{ "text": "string", "count": number, "difficulty": "MIXED" }}
          ]
        }}
      ],
      "bufferSlot": {{
        "durationMin": number,
        "rules": "string"
      }}
    }}
  ],
  "weekPlans": [
    {{ "weekNumber": number, "startOffset": number, "endOffset": number, "focus": "string", "notes": "string", "subjectHours": {{ "subject_name": number }} }}
  ],
  "topicPlans": [
    {{ "topicName": "string", "subjectName": "string", "plannedWeek": number, "estimatedHours": number, "priority": number, "deadline": "YYYY-MM-DD", "type": "THEORY|PRACTICE|REVIEW" }}
  ],
  "scheduledTests": [
    {{ "title": "string", "scheduledWeek": number, "topics": ["string"], "type": "WEEKLY_TEST|MINI_QUIZ|MIXED_SET", "durationMin": number }}
  ],
  "checks": {{
    "hoursPerWeekUsed": [number],
    "practiceRatio": [number],
    "deadlineSatisfaction": [
      {{ "subject": "string", "deadline": "YYYY-MM-DD", "endTopicIndex": number, "status": "OK|RISK|FAIL", "reason": "string" }}
    ]
  }}
}}

CRITICAL: Return ONLY valid JSON, no markdown code fences, no explanations before or after.
"""
    
    try:
        response = model.generate_content(prompt)
        text = response.text.replace('```json', '').replace('```', '').strip()
        result = json.loads(text)
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
            "totalWeeks": 4,
            "weekPlans": [],
            "topicPlans": [],
            "scheduledTests": []
        }
    except Exception as e:
        print(f"Error generating program: {e}")
        return {
            "description": f"Error: {str(e)}",
            "strategy": "Manual planning recommended",
            "totalWeeks": 4,
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

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

    # Build subjects info with topic order details
    subjects_info = []
    for s in subjects:
        topics_list = s.get('topics', [])
        topic_names = [f"{i+1}. {t['name']} (status: {t['status']})" for i, t in enumerate(topics_list)]
        subjects_info.append(f"{s['name']}: {', '.join(topic_names)}")
    
    prompt = f"""
    You are an expert strict AI Tutor. Create a detailed learning program.
    
    GOAL: {goal}
    TIMEFRAME: {timeframe}
    HOURS/DAY: {hours_per_day}
    LEVEL: {current_level}
    SUBJECTS WITH TOPICS (ordered by difficulty, from easier to harder):
    {chr(10).join(subjects_info)}
    CONTEXT: {json.dumps(context or {})}

    CRITICAL RULES:
    1. STRICTLY follow deadlines.
    2. Mastered topics = shorter time.
    3. New topics = 2-4 hours.
    4. RESPECT TOPIC ORDER - topics are ordered from easier to harder, schedule earlier topics before later ones.
    5. Do not skip foundational topics - they build upon each other.
    
    RESPONSE FORMAT (JSON ONLY, NO MARKDOWN):
    {{
      "description": "Short summary",
      "strategy": "Learning strategy description",
      "totalWeeks": 4,
      "weekPlans": [
        {{ "weekNumber": 1, "startOffset": 0, "endOffset": 7, "focus": "Basics", "notes": "Start strong", "subjectHours": {{ "subject_name": 10 }} }}
      ],
      "topicPlans": [
        {{ "topicName": "Topic Name", "subjectName": "Subject Name", "plannedWeek": 1, "estimatedHours": 2, "priority": 5, "deadline": "YYYY-MM-DD" }}
      ],
      "scheduledTests": [
         {{ "title": "Week 1 Test", "scheduledWeek": 1, "topics": ["Topic 1"] }}
      ]
    }}
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

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

    prompt = f"""
    You are an expert strict AI Tutor. Create a detailed learning program.
    
    GOAL: {goal}
    TIMEFRAME: {timeframe}
    HOURS/DAY: {hours_per_day}
    LEVEL: {current_level}
    SUBJECTS: {', '.join([s['name'] for s in subjects])}
    CONTEXT: {json.dumps(context or {})}

    CRITICAL RULES:
    1. STRICTLY follow deadlines.
    2. Mastered topics = shorter time.
    3. New topics = 2-4 hours.
    
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
    
    response = model.generate_content(prompt)
    try:
        text = response.text.replace('```json', '').replace('```', '').strip()
        return json.loads(text)
    except Exception as e:
        print(f"Error parsing AI response: {e}")
        return None

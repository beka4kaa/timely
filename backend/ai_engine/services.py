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

def generate_fast_topics(subject_name, extra_prompt=""):
    if not GEMINI_API_KEY: raise Exception("GEMINI_API_KEY is not set")
    model = genai.GenerativeModel('gemini-2.0-flash')
    
    prompt = f"""
    Generate a list of study topics for the subject: {subject_name}.
    Context: {extra_prompt}
    
    RESPONSE FORMAT (JSON LIST):
    [
      {{ "name": "Topic Name", "estimatedHours": 2, "difficulty": "Medium" }}
    ]
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

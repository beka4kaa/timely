#!/usr/bin/env python
"""
Script to clear all data from the database for a fresh start.
Run this script on Railway to reset the database.
"""
import os
import sys
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from mind.models import Subject, Topic, Subtopic, ReviewSet, SrsState, ReviewLog, SrsReviewLog, MindSession
from planner.models import DayPlan, Block, Segment, Subtask, ScheduleSlot
from ai_engine.models import LearningProgram, WeekPlan, DailyPlan, TopicPlan

def clear_all_data():
    """Delete all data from all tables"""
    print("🗑️  Clearing all data from database...")
    
    # Mind app
    print("  - Deleting SrsReviewLog...")
    SrsReviewLog.objects.all().delete()
    print("  - Deleting ReviewLog...")
    ReviewLog.objects.all().delete()
    print("  - Deleting SrsState...")
    SrsState.objects.all().delete()
    print("  - Deleting ReviewSet...")
    ReviewSet.objects.all().delete()
    print("  - Deleting MindSession...")
    MindSession.objects.all().delete()
    print("  - Deleting Subtopic...")
    Subtopic.objects.all().delete()
    print("  - Deleting Topic...")
    Topic.objects.all().delete()
    print("  - Deleting Subject...")
    Subject.objects.all().delete()
    
    # Planner app
    print("  - Deleting Subtask...")
    Subtask.objects.all().delete()
    print("  - Deleting Segment...")
    Segment.objects.all().delete()
    print("  - Deleting Block...")
    Block.objects.all().delete()
    print("  - Deleting DayPlan...")
    DayPlan.objects.all().delete()
    print("  - Deleting ScheduleSlot...")
    ScheduleSlot.objects.all().delete()
    
    # AI Engine app
    print("  - Deleting TopicPlan...")
    TopicPlan.objects.all().delete()
    print("  - Deleting DailyPlan...")
    DailyPlan.objects.all().delete()
    print("  - Deleting WeekPlan...")
    WeekPlan.objects.all().delete()
    print("  - Deleting LearningProgram...")
    LearningProgram.objects.all().delete()
    
    print("✅ All data cleared successfully!")

if __name__ == "__main__":
    confirm = input("⚠️  This will DELETE ALL DATA from the database. Type 'yes' to confirm: ")
    if confirm.lower() == 'yes':
        clear_all_data()
    else:
        print("❌ Aborted.")

"""
Data migration script to assign all existing data to pro100bekzhan@gmail.com
Run this on Railway after deploying the new models with user_email fields.
"""

import os
import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from mind.models import Subject, MindSession
from planner.models import DayPlan, ScheduleSlot
from ai_engine.models import LearningProgram

DEFAULT_USER_EMAIL = 'pro100bekzhan@gmail.com'

def migrate_data():
    print(f"Migrating all data to user: {DEFAULT_USER_EMAIL}")
    
    # Migrate Subjects
    count = Subject.objects.filter(user_email__isnull=True).update(user_email=DEFAULT_USER_EMAIL)
    print(f"Migrated {count} subjects")
    
    # Migrate MindSessions
    count = MindSession.objects.filter(user_email__isnull=True).update(user_email=DEFAULT_USER_EMAIL)
    print(f"Migrated {count} mind sessions")
    
    # Migrate DayPlans
    count = DayPlan.objects.filter(user_email__isnull=True).update(user_email=DEFAULT_USER_EMAIL)
    print(f"Migrated {count} day plans")
    
    # Migrate ScheduleSlots
    count = ScheduleSlot.objects.filter(user_email__isnull=True).update(user_email=DEFAULT_USER_EMAIL)
    print(f"Migrated {count} schedule slots")
    
    # Migrate LearningPrograms
    count = LearningProgram.objects.filter(user_email__isnull=True).update(user_email=DEFAULT_USER_EMAIL)
    print(f"Migrated {count} learning programs")
    
    print("Migration complete!")

if __name__ == '__main__':
    migrate_data()

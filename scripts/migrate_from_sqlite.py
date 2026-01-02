import os
import sys
import sqlite3
import django
from datetime import datetime
from pathlib import Path

# Setup Django environment
sys.path.append(str(Path(__file__).resolve().parent.parent / 'backend'))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from mind.models import Subject, Topic, Subtopic
from planner.models import DayPlan, Block, Segment, Subtask

# SQLite DB Path
DB_PATH = 'Deм.db'

def get_sqlite_conn():
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        return conn
    except Exception as e:
        print(f"Error connecting to {DB_PATH}: {e}")
        sys.exit(1)

def parse_date(date_val):
    if date_val is None:
        return None
    try:
        if isinstance(date_val, (int, float)):
            # Assume milliseconds if large integer (typical for JS/Prisma)
            # If > 3000000000000 (roughly year 2065), maybe microseconds?
            # Usually Prisma uses ms for SQLite.
            return datetime.fromtimestamp(date_val / 1000.0)
            
        # Try format 2024-01-01T00:00:00.000Z
        return datetime.fromisoformat(date_val.replace('Z', '+00:00'))
    except ValueError:
        try:
             # Try simple date 2024-01-01
             return datetime.strptime(date_val, "%Y-%m-%d")
        except:
             return None

def migrate_subjects(conn):
    print("Migrating Subjects...")
    rows = conn.execute("SELECT * FROM Subject").fetchall()
    for row in rows:
        Subject.objects.update_or_create(
            id=row['id'],
            defaults={
                'name': row['name'],
                'emoji': row['emoji'],
                'color': row['color'],
                'target_hours_week': row['targetHoursWeek'],
                'textbook_url': row['textbookUrl'],
                'created_at': parse_date(row['createdAt']),
                'updated_at': parse_date(row['updatedAt']),
            }
        )
    print(f"Migrated {len(rows)} subjects.")

def migrate_topics(conn):
    print("Migrating Topics...")
    rows = conn.execute("SELECT * FROM Topic").fetchall()
    for row in rows:
        try:
            # Check if subject exists
            if not Subject.objects.filter(id=row['subjectId']).exists():
                print(f"Skipping topic {row['name']} (Subject {row['subjectId']} not found)")
                continue

            Topic.objects.update_or_create(
                id=row['id'],
                defaults={
                    'subject_id': row['subjectId'],
                    'name': row['name'],
                    'status': row['status'],
                    'study_state': row['studyState'],
                    'picked': bool(row['picked']),
                    'order_index': row['orderIndex'] if 'orderIndex' in row.keys() else 0,
                    'created_at': parse_date(row['createdAt']),
                    'updated_at': parse_date(row['updatedAt']),
                }
            )
        except Exception as e:
            print(f"Error migrating topic {row['id']}: {e}")
    print(f"Migrated {len(rows)} topics.")

def migrate_dayplans(conn):
    print("Migrating DayPlans...")
    rows = conn.execute("SELECT * FROM DayPlan").fetchall()
    for row in rows:
        # Convert 2025-01-04 00:00:00 to date object
        date_val = parse_date(row['date'])
        if isinstance(date_val, datetime):
            date_val = date_val.date()
            
        DayPlan.objects.update_or_create(
            id=row['id'],
            defaults={
                'date': date_val,
                'created_at': parse_date(row['createdAt']),
                'updated_at': parse_date(row['updatedAt']),
            }
        )
    print(f"Migrated {len(rows)} day plans.")

def migrate_blocks(conn):
    print("Migrating Blocks...")
    rows = conn.execute("SELECT * FROM Block").fetchall()
    for row in rows:
        if not DayPlan.objects.filter(id=row['dayPlanId']).exists():
            continue
            
        Block.objects.update_or_create(
            id=row['id'],
            defaults={
                'day_plan_id': row['dayPlanId'],
                'type': row['type'],
                'title': row['title'],
                'duration_minutes': row['durationMinutes'],
                'start_time': row['startTime'],
                'status': row['status'],
                'order_index': row['orderIndex'],
                'notes': row['notes'],
                'color': row['color'],
                'created_at': parse_date(row['createdAt']),
                'updated_at': parse_date(row['updatedAt']),
            }
        )
    print(f"Migrated {len(rows)} blocks.")

def run():
    conn = get_sqlite_conn()
    
    migrate_subjects(conn)
    migrate_topics(conn)
    migrate_dayplans(conn)
    migrate_blocks(conn)
    # Segments and Subtasks can be added if needed, but these are the core.
    
    print("Migration finished!")

if __name__ == "__main__":
    run()

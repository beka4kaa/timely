"""
0002_templatelesson

Adds:
 - WeeklyTemplate.custom_presets  (JSONField, if not yet present)
 - TemplateLesson model           (normalised lessons with FK → WeeklyTemplate)

Run with: python manage.py migrate diary
"""
import uuid
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('diary', '0001_initial'),
    ]

    operations = [
        # ── WeeklyTemplate: add custom_presets — use raw SQL with IF NOT EXISTS
        # so the migration is idempotent even if the column was added out-of-band.
        migrations.RunSQL(
            sql="""
                ALTER TABLE diary_weeklytemplate
                ADD COLUMN IF NOT EXISTS custom_presets jsonb NOT NULL DEFAULT '[]'::jsonb;
            """,
            reverse_sql="""
                ALTER TABLE diary_weeklytemplate
                DROP COLUMN IF EXISTS custom_presets;
            """,
        ),

        # Record the state change so Django knows about the field
        migrations.SeparateDatabaseAndState(
            database_operations=[],   # already done above via RunSQL
            state_operations=[
                migrations.AddField(
                    model_name='weeklytemplate',
                    name='custom_presets',
                    field=models.JSONField(default=list),
                ),
            ],
        ),

        # ── TemplateLesson: normalised lesson rows ────────────────────────────
        migrations.CreateModel(
            name='TemplateLesson',
            fields=[
                ('id',            models.CharField(
                    primary_key=True, max_length=36,
                    default=uuid.uuid4, editable=False, serialize=False,
                )),
                ('template',      models.ForeignKey(
                    to='diary.WeeklyTemplate',
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='template_lessons',
                )),
                ('day_of_week',   models.CharField(
                    max_length=10,
                    choices=[
                        ('monday',    'Monday'),
                        ('tuesday',   'Tuesday'),
                        ('wednesday', 'Wednesday'),
                        ('thursday',  'Thursday'),
                        ('friday',    'Friday'),
                        ('saturday',  'Saturday'),
                        ('sunday',    'Sunday'),
                    ],
                )),
                ('lesson_number', models.IntegerField()),
                ('start_time',    models.CharField(max_length=5)),
                ('end_time',      models.CharField(max_length=5)),
                ('subject_id',    models.CharField(max_length=36, blank=True, default='')),
                ('block_type',    models.CharField(max_length=50, default='lesson')),
                ('label',         models.CharField(max_length=255, blank=True, default='')),
                ('created_at',    models.DateTimeField(auto_now_add=True)),
            ],
            options={
                'ordering': ['day_of_week', 'lesson_number'],
            },
        ),

        # ── Index for fast per-template, per-day queries ──────────────────────
        migrations.AddIndex(
            model_name='templatelesson',
            index=models.Index(
                fields=['template', 'day_of_week'],
                name='diary_tmpl_lesson_tpl_day_idx',
            ),
        ),
    ]

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('planner', '0006_goal_tone_scope_is_main_lessons'),
        ('habits', '0002_habit_freeze_budget_habit_goal_text_habitlog_minutes_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='habit',
            name='goal',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='habits',
                to='planner.goal',
            ),
        ),
    ]

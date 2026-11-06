from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('habits', '0003_habit_goal'),
    ]

    operations = [
        migrations.AddField(
            model_name='habit',
            name='frequency',
            field=models.CharField(
                choices=[
                    ('daily', 'Каждый день'),
                    ('weekdays', 'По дням недели'),
                    ('interval', 'Раз в несколько дней'),
                ],
                default='daily',
                max_length=10,
            ),
        ),
        migrations.AddField(
            model_name='habit',
            name='interval_days',
            field=models.PositiveSmallIntegerField(default=2),
        ),
        migrations.AddField(
            model_name='habit',
            name='weekdays',
            field=models.JSONField(blank=True, default=list),
        ),
    ]

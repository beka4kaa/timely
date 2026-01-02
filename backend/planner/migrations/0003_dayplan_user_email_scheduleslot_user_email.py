# Generated manually - add user_email to DayPlan and ScheduleSlot

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('planner', '0002_alter_block_id_alter_dayplan_id_alter_segment_id_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='dayplan',
            name='user_email',
            field=models.EmailField(blank=True, db_index=True, max_length=254, null=True),
        ),
        migrations.AddField(
            model_name='scheduleslot',
            name='user_email',
            field=models.EmailField(blank=True, db_index=True, max_length=254, null=True),
        ),
        # Remove unique constraint on date, add composite unique
        migrations.AlterField(
            model_name='dayplan',
            name='date',
            field=models.DateField(),
        ),
        migrations.AlterUniqueTogether(
            name='dayplan',
            unique_together={('user_email', 'date')},
        ),
    ]

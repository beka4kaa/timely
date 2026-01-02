# Generated manually - add user_email to LearningProgram

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('ai_engine', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='learningprogram',
            name='user_email',
            field=models.EmailField(blank=True, db_index=True, max_length=254, null=True),
        ),
    ]

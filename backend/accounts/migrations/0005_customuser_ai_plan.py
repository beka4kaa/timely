from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0004_customuser_has_full_access'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='ai_plan',
            field=models.CharField(
                choices=[('free', 'Free'), ('pro', 'Pro'), ('max', 'Max')],
                db_index=True,
                default='free',
                max_length=12,
            ),
        ),
    ]

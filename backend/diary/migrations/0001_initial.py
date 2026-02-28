from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='WeeklyTemplate',
            fields=[
                ('id', models.CharField(max_length=36, primary_key=True, serialize=False)),
                ('user_email', models.EmailField(db_index=True, max_length=254)),
                ('name', models.CharField(max_length=255)),
                ('slots', models.JSONField(default=list)),
                ('is_active', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
        migrations.CreateModel(
            name='DiaryWeek',
            fields=[
                ('id', models.CharField(max_length=36, primary_key=True, serialize=False)),
                ('user_email', models.EmailField(db_index=True, max_length=254)),
                ('week_start', models.CharField(db_index=True, max_length=10)),
                ('week_end', models.CharField(max_length=10)),
                ('template_id', models.CharField(blank=True, max_length=36, null=True)),
                ('days', models.JSONField(default=list)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
            ],
        ),
        migrations.AddIndex(
            model_name='weeklytemplate',
            index=models.Index(fields=['user_email', 'is_active'], name='diary_weekl_user_em_idx'),
        ),
        migrations.AddIndex(
            model_name='diaryweek',
            index=models.Index(fields=['user_email', 'week_start'], name='diary_diary_user_em_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='diaryweek',
            unique_together={('user_email', 'week_start')},
        ),
    ]

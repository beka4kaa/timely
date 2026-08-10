"""Новое умолчание `PROCESSING_VERSION` = 1.4.0.

Данные не трогает: меняется только значение по умолчанию у новых строк.
Уже загруженные книги остаются на 1.3.0 и считаются устаревшими, пока их не
переобработают через `POST /api/curriculum/documents/{id}/ingest/`.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('curriculum', '0012_course_module_part_and_exercises'),
    ]

    operations = [
        migrations.AlterField(
            model_name='document',
            name='processing_version',
            field=models.CharField(default='1.4.0', max_length=16),
        ),
        migrations.AlterField(
            model_name='ingestionjob',
            name='processing_version',
            field=models.CharField(default='1.4.0', max_length=16),
        ),
        migrations.AlterField(
            model_name='knowledgechunk',
            name='processing_version',
            field=models.CharField(default='1.4.0', max_length=16),
        ),
        migrations.AlterField(
            model_name='sectionprofile',
            name='processing_version',
            field=models.CharField(default='1.4.0', max_length=16),
        ),
    ]

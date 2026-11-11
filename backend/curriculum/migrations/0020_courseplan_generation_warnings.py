"""Программа помнит, на что при её составлении не хватило лимита (решение 14).

Сейчас это разбор глав: по `plan_profiling_skipped` и `plan_profiling_partial`
фронт пишет, что программа составлена без подробного разбора. `db_default`
оставляет DEFAULT в базе: миграцию применяет новый веб-контейнер, пока старый
ещё создаёт программы без этой колонки, и его INSERT не должен падать на
NOT NULL.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("curriculum", "0019_document_ocr_summary"),
    ]

    operations = [
        migrations.AddField(
            model_name="courseplan",
            name="generation_warnings",
            field=models.JSONField(blank=True, db_default=[], default=list),
        ),
    ]

"""Книга помнит, что стало со сканами при последней обработке (решения 13, 17).

Сводку пишет обработка, строку у книги по ней строит фронт. `db_default`
оставляет DEFAULT в базе: миграцию применяет новый веб-контейнер, пока старый
ещё создаёт книги без этой колонки, и его INSERT не должен падать на NOT NULL.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("curriculum", "0018_chunk_embedding_halfvec"),
    ]

    operations = [
        migrations.AddField(
            model_name="document",
            name="ocr_summary",
            field=models.JSONField(blank=True, db_default={}, default=dict),
        ),
    ]

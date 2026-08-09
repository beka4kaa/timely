"""Блок без страницы и подъём версии обработки по умолчанию.

`DocumentBlock.page` становится nullable: страница есть не у всякого формата. У
EPUB её нет вовсе, и без null такой блок было невозможно записать — фрагменты
ссылались бы в `block_ids` на несуществующие строки.

Смена умолчания `processing_version` на 1.1.0 — следствие Фазы 5 (настоящий
токенайзер и overlap меняют границы фрагментов). Она затрагивает только НОВЫЕ
строки: у уже обработанных документов версия остаётся прежней, и это верно —
они действительно построены старым алгоритмом.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('curriculum', '0003_chunk_embeddings'),
    ]

    operations = [
        migrations.AlterField(
            model_name='document',
            name='processing_version',
            field=models.CharField(default='1.1.0', max_length=16),
        ),
        migrations.AlterField(
            model_name='documentblock',
            name='page',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='blocks', to='curriculum.documentpage'),
        ),
        migrations.AlterField(
            model_name='ingestionjob',
            name='processing_version',
            field=models.CharField(default='1.1.0', max_length=16),
        ),
        migrations.AlterField(
            model_name='knowledgechunk',
            name='processing_version',
            field=models.CharField(default='1.1.0', max_length=16),
        ),
    ]

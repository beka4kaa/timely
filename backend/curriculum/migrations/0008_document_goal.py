"""Книга получает предмет, к которому относится.

До каталога документ соединялся с целью только через уже построенный
`CoursePlan`, поэтому книга в обработке не могла показаться в карточке предмета —
а именно тогда ученику и нужно видеть, что происходит.

Заодно догоняется дефолт `processing_version`: константа выросла до 1.2.0 вместе
с переписанным разбором заголовков, а миграцию под неё не сделали. На данные это
не влияет (default применяется только к новым строкам), но без записи состояние
модели расходится с миграциями и `makemigrations --check` падает.
"""

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('curriculum', '0007_chunk_cross_database_refs'),
    ]

    operations = [
        migrations.AddField(
            model_name='document',
            name='goal',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='documents', to='curriculum.learninggoal'),
        ),
        migrations.AlterField(
            model_name='document',
            name='processing_version',
            field=models.CharField(default='1.2.0', max_length=16),
        ),
        migrations.AlterField(
            model_name='ingestionjob',
            name='processing_version',
            field=models.CharField(default='1.2.0', max_length=16),
        ),
        migrations.AlterField(
            model_name='knowledgechunk',
            name='processing_version',
            field=models.CharField(default='1.2.0', max_length=16),
        ),
        migrations.AddIndex(
            model_name='document',
            index=models.Index(fields=['user_email', 'goal'], name='curriculum__user_em_49f9f0_idx'),
        ),
    ]

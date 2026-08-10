"""Структура книги получает уровень, роль и доказательство.

До этого уровень раздела вычислялся из числа точек в `path`, а сам `path`
выдавался двумя несовместимыми способами — из-за чего строка «1. Вектор o» из
списка упражнений получала глубину 1 и становилась главой курса наравне с
«Кинематикой».

Старые разделы не удаляются и не переписываются задним числом: доказать их
происхождение нечем. Они честно помечаются как догадка (`source=heuristic`,
`verified=False`, низкая уверенность), а `is_teachable` снимается с тех, про
кого видно, что учить по ним нельзя. Настоящую структуру они получат при
переобработке книги — `PROCESSING_VERSION` для этого и поднят до 1.3.0.
"""

from django.db import migrations, models


def _backfill(apps, schema_editor):
    Section = apps.get_model("curriculum", "DocumentSection")

    # Роль по уже известному `kind`: иерархию мы знаем, педагогику — нет.
    role_by_kind = {
        "chapter": "chapter",
        "section": "section",
        "subsection": "subsection",
    }
    # Служебные разделы: по названию видно, что программу по ним не строят.
    service = (
        "ответ", "литератур", "библиограф", "указатель",
        "оглавление", "содержание", "предислови", "упражнени",
    )

    updates = []
    for row in Section.objects.all().only(
        "id", "kind", "path", "title", "start_page"
    ):
        row.level = (row.path.count(".") + 1) if row.path else 1
        row.structural_role = role_by_kind.get(row.kind, "unknown")
        row.source = "heuristic"
        row.confidence = 0.4
        row.verified = False
        title = (row.title or "").strip().casefold()
        # Заголовок без букв («2», «+») учебной единицей быть не может.
        has_words = any(ch.isalpha() for ch in title)
        row.is_teachable = has_words and not title.startswith(service)
        row.printed_page = None
        updates.append(row)

    if updates:
        Section.objects.bulk_update(
            updates,
            [
                "level",
                "structural_role",
                "source",
                "confidence",
                "verified",
                "is_teachable",
                "printed_page",
            ],
            batch_size=500,
        )


def _noop(apps, schema_editor):
    """Обратного переноса нет: новые поля просто исчезают вместе с колонками."""


class Migration(migrations.Migration):

    dependencies = [
        ('curriculum', '0008_document_goal'),
    ]

    operations = [
        migrations.AddField(
            model_name='documentsection',
            name='confidence',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='documentsection',
            name='is_teachable',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='documentsection',
            name='level',
            field=models.PositiveSmallIntegerField(default=1),
        ),
        migrations.AddField(
            model_name='documentsection',
            name='number_label',
            field=models.CharField(blank=True, default='', max_length=32),
        ),
        migrations.AddField(
            model_name='documentsection',
            name='printed_page',
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='documentsection',
            name='source',
            field=models.CharField(choices=[('body_heading', 'body_heading'), ('epub_navigation', 'epub_navigation'), ('heuristic', 'heuristic'), ('manual', 'manual'), ('model_assisted', 'model_assisted'), ('pdf_outline', 'pdf_outline'), ('table_of_contents', 'table_of_contents')], default='heuristic', max_length=24),
        ),
        migrations.AddField(
            model_name='documentsection',
            name='structural_role',
            field=models.CharField(choices=[('answers', 'answers'), ('appendix', 'appendix'), ('assessment', 'assessment'), ('bibliography', 'bibliography'), ('chapter', 'chapter'), ('exercise_set', 'exercise_set'), ('front_matter', 'front_matter'), ('index', 'index'), ('introduction', 'introduction'), ('laboratory', 'laboratory'), ('part', 'part'), ('reference', 'reference'), ('section', 'section'), ('subsection', 'subsection'), ('summary', 'summary'), ('theory', 'theory'), ('unknown', 'unknown'), ('worked_examples', 'worked_examples')], default='unknown', max_length=24),
        ),
        migrations.AddField(
            model_name='documentsection',
            name='verified',
            field=models.BooleanField(default=False),
        ),
        migrations.AlterField(
            model_name='document',
            name='processing_version',
            field=models.CharField(default='1.3.0', max_length=16),
        ),
        migrations.AlterField(
            model_name='ingestionjob',
            name='processing_version',
            field=models.CharField(default='1.3.0', max_length=16),
        ),
        migrations.AlterField(
            model_name='knowledgechunk',
            name='processing_version',
            field=models.CharField(default='1.3.0', max_length=16),
        ),
            migrations.RunPython(_backfill, _noop),
    ]

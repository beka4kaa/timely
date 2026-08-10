"""Часть и номер главы у модуля; упражнения возвращаются в программу.

Backfill нужен потому, что книги уже загружены. У разделов-упражнений лежит
`is_teachable=False` (роль была в `NON_TEACHABLE_ROLES`) и название без номера:
разбор оглавления срезал хвостовое число дважды, и все шестнадцать «Упражнение
7», «Упражнение 8» превратились в одинаковое «Упражнение». Переобрабатывать
пятисотстраничный учебник ради этого незачем.
"""

from django.db import migrations, models


def _restore_exercises(apps, schema_editor):
    """Возвращает упражнения в программу и восстанавливает их номера.

    Номер берётся из порядка следования, потому что в сохранённой строке его уже
    нет. Учебники нумеруют упражнения сквозной серией по всей книге, и для
    «Механики» это даёт 1…16 — но это именно восстановление утраченного, а не
    правило. Книгам, загруженным после правки `_clean_title`, номер приходит из
    самого оглавления, и угадывать ничего не нужно.
    """
    DocumentSection = apps.get_model("curriculum", "DocumentSection")

    exercises = DocumentSection.objects.filter(structural_role="exercise_set")
    exercises.update(is_teachable=True)

    counters: dict[str, int] = {}
    unnumbered = exercises.exclude(title__regex=r"\d").order_by(
        "document_id", "order_index"
    )
    for section in unnumbered:
        key = str(section.document_id)
        counters[key] = counters.get(key, 0) + 1
        section.title = f"{section.title.strip()} {counters[key]}"[:300]
        section.save(update_fields=["title"])


def _hide_exercises(apps, schema_editor):
    """Откат: упражнения снова вне программы. Номера остаются — они верны."""
    DocumentSection = apps.get_model("curriculum", "DocumentSection")
    DocumentSection.objects.filter(structural_role="exercise_set").update(
        is_teachable=False
    )


class Migration(migrations.Migration):

    dependencies = [
        ("curriculum", "0011_section_profile"),
    ]

    operations = [
        migrations.AddField(
            model_name="coursemodule",
            name="number_label",
            field=models.CharField(blank=True, default="", max_length=32),
        ),
        migrations.AddField(
            model_name="coursemodule",
            name="part_title",
            field=models.CharField(blank=True, default="", max_length=300),
        ),
        migrations.RunPython(_restore_exercises, _hide_exercises),
    ]

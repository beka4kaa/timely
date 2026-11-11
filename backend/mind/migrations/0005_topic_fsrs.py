import django.core.validators
from django.db import migrations, models

# Перевод SM-2 → FSRS записан здесь, а не импортирован из `mind.srs`: миграция
# должна делать то же, что в день выкладки, даже если код потом поменяется.
# Обратную прямую (сложность → ease_factor) держит `mind.srs.ease_from_difficulty`,
# совпадение проверяет `mind.test_fsrs_migration`.
SM2_MIN_EASE = 1.3
SM2_MAX_EASE = 3.0
SM2_DEFAULT_EASE = 2.5
FSRS_MIN_DIFFICULTY = 1.0
FSRS_MAX_DIFFICULTY = 10.0
# Максимальный интервал пакета fsrs 6.3.2 по умолчанию.
FSRS_MAX_STABILITY = 36500.0
# fsrs.State.Review
STATE_REVIEW = 2

FSRS_FIELDS = ["fsrs_stability", "fsrs_difficulty", "fsrs_state", "fsrs_reps", "fsrs_lapses"]


def fsrs_from_sm2(interval_days, ease_factor):
    """Устойчивость и сложность FSRS для темы, которую повторяли по SM-2.

    Устойчивость = прежний интервал в днях, не меньше дня. Устойчивость в FSRS —
    срок, за который шанс вспомнить падает до 90%, и при цели 0,9 интервал ей
    равен. Старый интервал означал то же: «к этому дню ещё вспомнит».

    Сложность — прямая по ease_factor: 3,0 (легче всего в SM-2) даёт 1, 1,3
    (тяжелее всего) даёт 10, между ними линейно, за краями SM-2 края FSRS:
    D = 1 + (3,0 − ease) × 9 / 1,7. Пустой ease_factor считается 2,5.
    """
    stability = float(min(max(interval_days or 1, 1), FSRS_MAX_STABILITY))
    ease = SM2_DEFAULT_EASE if ease_factor is None else float(ease_factor)
    difficulty = FSRS_MIN_DIFFICULTY + (SM2_MAX_EASE - ease) * (
        FSRS_MAX_DIFFICULTY - FSRS_MIN_DIFFICULTY
    ) / (SM2_MAX_EASE - SM2_MIN_EASE)
    return stability, min(max(difficulty, FSRS_MIN_DIFFICULTY), FSRS_MAX_DIFFICULTY)


def seed_fsrs_memory(apps, schema_editor):
    """Темам, которые уже повторяли, начальная память FSRS. Сроки не трогаем.

    «Уже повторяли» значит, что есть дата прошлого повторения: без неё шанс
    вспомнить не посчитать, и тема честнее остаётся новой. `next_review_at`,
    `status`, `interval_days` и `ease_factor` не меняются: ученик не должен
    увидеть, что всё вдруг «пора повторить». Сколько было повторений, SM-2 не
    записывал, поэтому одно. Провалов ноль.
    """
    Topic = apps.get_model("mind", "Topic")
    # Память, которая уже есть, не трогаем: повторный прогон ничего не портит.
    topics = list(
        Topic.objects.filter(last_revised_at__isnull=False, fsrs_stability__isnull=True).only(
            "id", "interval_days", "ease_factor"
        )
    )
    for topic in topics:
        topic.fsrs_stability, topic.fsrs_difficulty = fsrs_from_sm2(
            topic.interval_days, topic.ease_factor
        )
        topic.fsrs_state = STATE_REVIEW
        topic.fsrs_reps = 1
        topic.fsrs_lapses = 0
    Topic.objects.bulk_update(topics, FSRS_FIELDS, batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ("mind", "0004_add_order_index_to_subject"),
    ]

    operations = [
        migrations.AddField(
            model_name="topic",
            name="fsrs_stability",
            field=models.FloatField(
                blank=True,
                null=True,
                validators=[django.core.validators.MinValueValidator(0.001)],
            ),
        ),
        migrations.AddField(
            model_name="topic",
            name="fsrs_difficulty",
            field=models.FloatField(
                blank=True,
                null=True,
                validators=[
                    django.core.validators.MinValueValidator(1.0),
                    django.core.validators.MaxValueValidator(10.0),
                ],
            ),
        ),
        # У колонок NOT NULL `db_default`: старый веб-контейнер во время выкладки
        # создаёт темы без них, и его INSERT не должен падать.
        migrations.AddField(
            model_name="topic",
            name="fsrs_state",
            field=models.PositiveSmallIntegerField(
                choices=[(1, "Learning"), (2, "Review"), (3, "Relearning")],
                db_default=1,
                default=1,
            ),
        ),
        migrations.AddField(
            model_name="topic",
            name="fsrs_reps",
            field=models.PositiveIntegerField(db_default=0, default=0),
        ),
        migrations.AddField(
            model_name="topic",
            name="fsrs_lapses",
            field=models.PositiveIntegerField(db_default=0, default=0),
        ),
        migrations.RunPython(seed_fsrs_memory, migrations.RunPython.noop),
    ]

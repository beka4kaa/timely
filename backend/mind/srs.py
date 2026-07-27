"""
Интервальное повторение: чистый расчёт следующего интервала.

Зачем модуль
────────────
Логика жила прямо в `TopicViewSet.review` и была доступна только через HTTP.
Инструменту тьютора `schedule_review` (PRODUCT.md §5.7) нужен тот же расчёт, а
переписывать интервалы второй раз означало бы два алгоритма повторения, которые
рано или поздно разойдутся — и разойдутся молча, потому что глазами разницу в
`max(2, int(interval * ease))` не видно.

Функция чистая: ни БД, ни `now()`. Дату вычисляет вызывающий код, поэтому
поведение проверяется таблицей.

Совместимость: расчёт перенесён из вью без изменения чисел — те же множители,
те же границы, тот же порядок (в EASY интервал считается по СТАРОМУ ease_factor,
и это сохранено намеренно). Одно отличие: неизвестный rating раньше приводил к
`UnboundLocalError` (переменная `interval` не присваивалась ни в одной ветке, и
следующая же строка её читала), а теперь трактуется как GOOD — это и был
подразумеваемый режим по умолчанию в самом вью.
"""

from __future__ import annotations

from dataclasses import dataclass

# Оценки повторения, как их присылает фронтенд (`mind/topics/{id}/review/`).
RATING_AGAIN = "AGAIN"
RATING_HARD = "HARD"
RATING_GOOD = "GOOD"
RATING_EASY = "EASY"

REVIEW_RATINGS = (RATING_AGAIN, RATING_HARD, RATING_GOOD, RATING_EASY)

# Границы ease_factor из исходного расчёта.
MIN_EASE_FACTOR = 1.3
MAX_EASE_FACTOR = 3.0
DEFAULT_EASE_FACTOR = 2.5

# Статусы темы (mind.Topic.STATUS_CHOICES). Держим строками, чтобы модуль
# оставался свободным от Django и тестировался без БД.
STATUS_NOT_STARTED = "NOT_STARTED"
STATUS_MEDIUM = "MEDIUM"
STATUS_SUCCESS = "SUCCESS"
STATUS_MASTERED = "MASTERED"


@dataclass(frozen=True)
class ReviewOutcome:
    """Что должно стать с темой после повторения."""

    interval_days: int
    ease_factor: float
    status: str


def next_review(
    *,
    rating: str,
    status: str,
    interval_days: int | None,
    ease_factor: float | None,
) -> ReviewOutcome:
    """Посчитать следующий интервал, ease factor и статус темы.

    `interval_days`/`ease_factor` принимают None — у новой темы их ещё нет, и
    подстановка значений по умолчанию здесь избавляет вызывающий код от той же
    защиты в трёх местах.
    """
    current_interval = interval_days or 1
    ease = ease_factor or DEFAULT_EASE_FACTOR
    current_status = status or STATUS_NOT_STARTED
    normalized_rating = (rating or RATING_GOOD).strip().upper()

    if normalized_rating == RATING_AGAIN:
        # Не вспомнил — повторяем завтра и снижаем лёгкость.
        return ReviewOutcome(
            interval_days=1,
            ease_factor=max(MIN_EASE_FACTOR, ease - 0.2),
            status=STATUS_MEDIUM,
        )

    if normalized_rating == RATING_HARD:
        return ReviewOutcome(
            interval_days=max(1, int(current_interval * 1.2)),
            ease_factor=max(MIN_EASE_FACTOR, ease - 0.15),
            status=STATUS_MEDIUM if current_status == STATUS_NOT_STARTED else current_status,
        )

    if normalized_rating == RATING_EASY:
        # Интервал считается по ТЕКУЩЕМУ ease factor, и только потом лёгкость
        # растёт — порядок сохранён из исходного расчёта.
        interval = max(7, int(current_interval * ease * 1.5))
        if current_status in (STATUS_NOT_STARTED, STATUS_MEDIUM):
            new_status = STATUS_SUCCESS
        elif current_status == STATUS_SUCCESS:
            new_status = STATUS_MASTERED
        else:
            new_status = current_status
        return ReviewOutcome(
            interval_days=interval,
            ease_factor=min(MAX_EASE_FACTOR, ease + 0.15),
            status=new_status,
        )

    # GOOD и всё нераспознанное: у вью rating по умолчанию тоже GOOD.
    if current_status == STATUS_NOT_STARTED:
        return ReviewOutcome(interval_days=1, ease_factor=ease, status=STATUS_MEDIUM)

    if current_status == STATUS_MEDIUM:
        return ReviewOutcome(
            interval_days=max(2, int(current_interval * ease)),
            ease_factor=ease,
            status=STATUS_SUCCESS if current_interval >= 3 else STATUS_MEDIUM,
        )

    if current_status == STATUS_SUCCESS:
        return ReviewOutcome(
            interval_days=max(4, int(current_interval * ease)),
            ease_factor=ease,
            status=STATUS_MASTERED if current_interval >= 7 else STATUS_SUCCESS,
        )

    # MASTERED — интервал продолжает расти, статус уже максимальный.
    return ReviewOutcome(
        interval_days=max(7, int(current_interval * ease)),
        ease_factor=ease,
        status=current_status,
    )

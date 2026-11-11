"""Интервальные повторения в календаре.

Повторение планируется в момент построения календаря, а не «когда-нибудь
потом», потому что иначе оно не появится: ученик не станет сам вспоминать, что
тему двухнедельной давности пора освежить, — и именно это забывание продукт и
должен снимать (§6.6).

Два случая:

* ученик эту тему ещё ни разу не повторял. Результата повторения нет и быть не
  может, поэтому три повторения через 2, 7 и 21 день. Отсчёт идёт от даты,
  когда тема ЗАКОНЧЕНА в плане, а не от её начала: повторять то, что ещё не
  пройдено до конца, бессмысленно;
* тему уже повторяли. Срок назначил FSRS по ответам ученика и реальной паузе
  (`mind.srs`, поле `mind.Topic.next_review_at`), и план ставит одно повторение
  на этот срок. Если срок наступает в день урока по этой же теме или раньше, урок
  сам освежил тему: повторение встаёт через первый шаг (2 дня) после урока, а не
  сразу за ним и не до него. Следующий срок FSRS назначит после самого
  повторения, а план подхватит его при следующей сборке.

Алгоритм один на проект: шаги 2/7/21 — это только стартовые сроки темы без
истории, а не второй расчёт интервалов.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime, time, timedelta

from .contracts import (
    REVIEW_MINUTES,
    REVIEW_OFFSETS_DAYS,
    REVIEW_SEARCH_WINDOW_DAYS,
    PacingPlan,
    PlannedBlock,
)
from .slots import local_to_utc, resolve_zone

REVIEW_ACTIVITY = "review"


def place_reviews(
    pool,
    *,
    pacing: PacingPlan,
    topic_finished: dict[str, datetime],
    horizon_end: date,
    zone_name: str,
    review_due: Mapping[str, datetime] | None = None,
) -> tuple[list[PlannedBlock], dict]:
    """Расставить повторения в оставшуюся ёмкость.

    Повторение, которому не нашлось места в течение недели после целевой даты,
    не создаётся вовсе и НЕ делает расписание невыполнимым: пропущенное
    повторение — потеря качества, а не срыв курса, и обменивать на него урок
    новой темы неправильно.
    """
    zone = resolve_zone(zone_name)
    review_due = review_due or {}

    # Все запросы собираются заранее и сортируются по целевой дате: иначе
    # повторение первой темы через 21 день забирало бы окно раньше, чем
    # повторение пятой темы через 2 дня, хотя оно позже по календарю.
    # Запрос: (дата, тема по порядку, шаг для сортировки, шаг блока, тема).
    requests: list[tuple[date, int, int, int | None, object]] = []
    for topic_index, topic in enumerate(pacing.topic_pacing):
        finished = topic_finished.get(topic.topic_id)
        if finished is None:
            continue
        finished_local = finished.astimezone(zone).date()
        due = review_due.get(topic.topic_id)
        if due is not None:
            due_local = due.astimezone(zone).date()
            target = (
                due_local
                if due_local > finished_local
                else finished_local + timedelta(days=REVIEW_OFFSETS_DAYS[0])
            )
            # Шаг `None`: повторение по сроку FSRS, а не один из шагов 2/7/21.
            requests.append((target, topic_index, -1, None, topic))
            continue
        for step, offset in enumerate(REVIEW_OFFSETS_DAYS):
            requests.append(
                (finished_local + timedelta(days=offset), topic_index, step, step, topic)
            )
    requests.sort(key=lambda item: (item[0], item[1], item[2]))

    blocks: list[PlannedBlock] = []
    beyond_horizon = 0
    dropped = 0

    for target_date, _topic_index, _order, step, topic in requests:
        if target_date > horizon_end:
            beyond_horizon += 1
            continue

        window_end = min(
            horizon_end + timedelta(days=1),
            target_date + timedelta(days=REVIEW_SEARCH_WINDOW_DAYS + 1),
        )
        not_before, _ = local_to_utc(target_date, time(0, 0), zone)
        not_after, _ = local_to_utc(window_end, time(0, 0), zone)

        placement = pool.place(
            duration_minutes=REVIEW_MINUTES,
            activity_type=REVIEW_ACTIVITY,
            not_before=not_before,
            not_after=not_after,
        )
        if placement is None:
            dropped += 1
            continue

        first_part = topic.lesson_parts[0] if topic.lesson_parts else None
        blocks.append(
            PlannedBlock(
                start=placement.start,
                end=placement.end,
                duration_minutes=REVIEW_MINUTES,
                activity_type=REVIEW_ACTIVITY,
                title=f"{topic.title or topic.topic_external_id} — повторение",
                kind="review",
                objective="Вспомнить материал темы без подсказок.",
                topic_id=topic.topic_id,
                topic_external_id=topic.topic_external_id,
                module_external_id=topic.module_external_id,
                source_section_ids=(
                    first_part.source_section_ids if first_part else ()
                ),
                source_chunk_ids=(first_part.source_chunk_ids if first_part else ()),
                review_step=step,
                slot_id=placement.slot_id,
            )
        )

    stats = {
        "reviews_planned": len(blocks),
        "reviews_beyond_horizon": beyond_horizon,
        "reviews_dropped_no_slot": dropped,
    }
    return blocks, stats

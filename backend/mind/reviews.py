"""
Повторение темы целиком: оценка → FSRS → тема → журнал.

Здесь одно место, через которое проходит любое повторение: кнопки на «Сейчас» и
на странице слабых тем (`TopicViewSet.review`) и инструмент тьютора
`schedule_review`. Расчёт живёт в `mind.srs` и от базы не зависит, а этот модуль
добавляет то, что от неё зависит: цель вспоминания перед контрольной и запись в
журнал `LearningEvent`.

Журнал нужен, чтобы память FSRS можно было пересчитать из истории, как
`SkillState`, и потом подобрать веса под учеников Timely. Событие пишется без
оценённого результата (`result=""`): повторение — это не попытка решить задачу,
и `recompute_skill_state` не должен считать его практикой.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from django.conf import settings
from django.utils import timezone

from . import srs
from .models import Subject

# За сколько дней до контрольной цель вспоминания поднимается до 0,95. День самой
# контрольной входит: повторить утром ещё не поздно.
EXAM_WINDOW_DAYS = 7

# Блоки дневника, которые «Сейчас» показывает как контрольные: тот же список, что
# `TEST_BLOCK_TYPES` в src/types/diary.ts.
DIARY_TEST_BLOCK_TYPES = frozenset(
    {"test", "weakness-test", "cumulative-test", "error-test", "error-review"}
)


def base_retention() -> float:
    """Цель вспоминания из настройки `FSRS_DESIRED_RETENTION`."""
    return srs.clean_retention(
        getattr(settings, "FSRS_DESIRED_RETENTION", srs.DEFAULT_DESIRED_RETENTION)
    )


def retention_with_exam(has_exam: bool) -> float:
    """Перед контрольной 0,95, но не ниже настройки, если она выше."""
    base = base_retention()
    return max(base, srs.EXAM_DESIRED_RETENTION) if has_exam else base


def _test_window(now: datetime) -> tuple[date, date]:
    """От сегодня на самый длинный срок вперёд: дальше контрольная на срок не влияет."""
    today = timezone.localdate(now)
    return today, today + timedelta(days=srs.MAX_INTERVAL_DAYS)


def _scheduled_test_days(user_email: str, first: date, last: date) -> list[tuple[str, date]]:
    """Контрольные из `ScheduledTest` (их создаёт генератор программы): (предмет, день).

    Связь с темой через предмет: у `ScheduledTest` есть внешний ключ на
    `mind.Subject`, а `topics_covered` — свободный JSON, который генератор
    заполняет названиями, а не id. Поэтому контрольная по предмету касается всех
    его тем.
    """
    from ai_engine.models import ScheduledTest  # локальный импорт: mind → ai_engine только здесь

    rows = ScheduledTest.objects.filter(
        status="SCHEDULED",
        subject__user_email=user_email,
        scheduled_date__date__gte=first,
        scheduled_date__date__lte=last,
    ).values_list("subject_id", "scheduled_date")
    return [(str(subject_id), timezone.localdate(moment)) for subject_id, moment in rows]


def _subjects_by_name(user_email: str) -> dict[str, str]:
    """Предметы ученика по названию без учёта регистра. Одноимённые не в счёт: неоднозначно."""
    names: dict[str, list[str]] = defaultdict(list)
    for pk, name in Subject.objects.filter(user_email=user_email).values_list("pk", "name"):
        key = (name or "").strip().casefold()
        if key:
            names[key].append(str(pk))
    return {key: ids[0] for key, ids in names.items() if len(ids) == 1}


def _diary_test_days(user_email: str, first: date, last: date) -> list[tuple[str, date]]:
    """Контрольные из дневника, их ученик и видит на «Сейчас»: (предмет, день).

    Неделя дневника (`DiaryWeek.days`) хранит уроки и блоки JSON'ом. Предмет блока
    контрольной задан явно: `linkedSubjectIds` («для каких предметов этот тест»,
    ученик выбирает в окне урока) или `subjectId`. Если связи нет, блок из шаблона
    недели всё равно может называться как предмет: тогда засчитывается предмет
    ученика с ровно таким названием, без учёта регистра и пробелов по краям.
    Похожие названия не в счёт: неверная привязка хуже отсутствующей.
    """
    from diary.models import DiaryWeek  # локальный импорт: mind → diary только здесь

    monday = first - timedelta(days=first.weekday())
    weeks = DiaryWeek.objects.filter(
        user_email=user_email,
        week_start__gte=monday.isoformat(),
        week_start__lte=last.isoformat(),
    ).values_list("days", flat=True)

    found: list[tuple[str, date]] = []
    by_name: dict[str, str] | None = None
    for days in weeks:
        for day in days if isinstance(days, list) else []:
            if not isinstance(day, dict):
                continue
            try:
                when = date.fromisoformat(str(day.get("date") or "")[:10])
            except ValueError:
                continue
            if not first <= when <= last:
                continue
            for lesson in day.get("lessons") or []:
                if not isinstance(lesson, dict) or lesson.get("blockType") not in DIARY_TEST_BLOCK_TYPES:
                    continue
                linked = lesson.get("linkedSubjectIds")
                ids = [
                    str(value)
                    for value in [*(linked if isinstance(linked, list) else []), lesson.get("subjectId")]
                    if value
                ]
                if not ids:
                    if by_name is None:
                        by_name = _subjects_by_name(user_email)
                    for label in (lesson.get("blockLabel"), lesson.get("subjectName")):
                        subject_id = by_name.get(str(label or "").strip().casefold())
                        if subject_id:
                            ids = [subject_id]
                            break
                found.extend((subject_id, when) for subject_id in ids)
    return found


def exam_days(user_email: str | None, now: datetime) -> dict[str, list[date]]:
    """Дни контрольных ученика по предметам, из `ScheduledTest` и из дневника."""
    if not user_email:
        return {}
    first, last = _test_window(now)
    days: dict[str, set[date]] = defaultdict(set)
    for subject_id, day in [
        *_scheduled_test_days(user_email, first, last),
        *_diary_test_days(user_email, first, last),
    ]:
        days[subject_id].add(day)
    return {subject_id: sorted(values) for subject_id, values in days.items()}


def exam_outlook(
    subject_id: Any, days_by_subject: dict[str, list[date]], now: datetime
) -> tuple[float, date | None]:
    """Цель вспоминания и ближайшая контрольная после сегодня для предмета темы.

    Контрольная сегодня или в ближайшие 7 дней поднимает цель до 0,95. Ближайшая
    контрольная после сегодня нужна `srs.next_review`: срок не перескочит через неё.
    """
    today = timezone.localdate(now)
    days = days_by_subject.get(str(subject_id), [])
    soon = any(today <= day <= today + timedelta(days=EXAM_WINDOW_DAYS) for day in days)
    upcoming = next((day for day in days if day > today), None)
    return retention_with_exam(soon), upcoming


def exam_outlook_for(topic: Any, now: datetime) -> tuple[float, date | None]:
    """То же для одной темы: контрольные её ученика."""
    owner = getattr(getattr(topic, "subject", None), "user_email", None)
    return exam_outlook(topic.subject_id, exam_days(owner, now), now)


def retention_for(topic: Any, now: datetime) -> float:
    """Цель вспоминания для одной темы в момент `now`."""
    return exam_outlook_for(topic, now)[0]


def review_topic(
    topic: Any,
    rating: Any,
    *,
    user_email: str,
    source: str,
    mode: str = "",
    now: datetime | None = None,
) -> srs.ReviewOutcome:
    """Записать повторение темы: новую память, срок, старые поля и событие журнала."""
    from ai_engine.learning_events import record_learning_event

    moment = now or timezone.now()
    retention, next_test = exam_outlook_for(topic, moment)
    outcome = srs.next_review(
        rating=rating,
        memory=srs.memory_of(topic),
        now=moment,
        desired_retention=retention,
        next_test=next_test,
    )

    topic.status = outcome.status
    topic.last_revised_at = outcome.reviewed_at
    topic.next_review_at = outcome.next_review_at
    topic.interval_days = outcome.interval_days
    topic.ease_factor = outcome.ease_factor
    topic.fsrs_stability = outcome.stability
    topic.fsrs_difficulty = outcome.difficulty
    topic.fsrs_state = outcome.state
    topic.fsrs_reps = outcome.reps
    topic.fsrs_lapses = outcome.lapses
    topic.save()

    record_learning_event(
        user_email=user_email,
        topic=topic,
        activity="review",
        # "" значит «без оценки»: повторение не попытка решить, в mastery оно не идёт.
        result="",
        mode=mode,
        source=source,
        metadata={
            "rating": outcome.rating,
            "recall_probability": (
                None if outcome.recall_probability is None else round(outcome.recall_probability, 4)
            ),
            "desired_retention": outcome.desired_retention,
            "interval_days": outcome.interval_days,
            "stability": round(outcome.stability, 4),
            "difficulty": round(outcome.difficulty, 4),
        },
    )
    return outcome

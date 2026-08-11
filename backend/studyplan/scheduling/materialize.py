"""Черновик → строки `LearningBlock`. Единственный слой пакета, знающий про БД.

Детализация намеренно разная. Даты и темы известны у ВСЕХ блоков на весь
горизонт — иначе календарь на три месяца не показать. А подробное содержание
занятия (`lesson_payload`) заполняется только у ближайших дней: генерировать
пятьсот конкретных заданий вперёд бессмысленно и дорого, потому что к третьему
месяцу половина из них перестанет соответствовать тому, что ученик уже умеет.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

from django.db import transaction

from ..models import LearningBlock, StudySchedule
from .contracts import ScheduleDraft
from .pacing import workspace_for
from .slots import resolve_zone

# Что считается критерием завершения, если тема его не задала. Не «придуманный
# урок», а честная формулировка того, что блок вообще требует сделать.
_DEFAULT_COMPLETION: dict[str, str] = {
    "theory": "Можешь своими словами объяснить главную идею.",
    "guided_example": "Разобран пример целиком, каждый шаг понятен.",
    "guided_practice": "Задачи решены с подсказками, ход решения понятен.",
    "independent_practice": "Задачи решены самостоятельно.",
    "assessment": "Проверка пройдена без подсказок.",
    "review": "Материал вспомнился без подглядывания.",
}


def _lesson_payload(block) -> dict:
    """Подробности занятия из того, что известно достоверно.

    Список конкретных упражнений сюда НЕ выдумывается: его составит генератор
    урока (роль `LESSON_GENERATION`) ближе к дате. Пустое место честнее
    правдоподобной выдумки, по которой ученик пойдёт заниматься.
    """
    return {
        "expected_minutes": block.duration_minutes,
        "completion": block.mastery_criteria
        or _DEFAULT_COMPLETION.get(block.activity_type, ""),
        "sources": {
            "section_ids": list(block.source_section_ids),
            "chunk_ids": list(block.source_chunk_ids),
        },
    }


@transaction.atomic
def materialize(
    draft: ScheduleDraft,
    *,
    schedule: StudySchedule,
    prerequisites: dict[str, tuple[str, ...]] | None = None,
    detailed_horizon_days: int = 14,
    replace: bool = True,
) -> list[LearningBlock]:
    """Записать календарь. По умолчанию заменяет прежние блоки расписания.

    `replace` выключается там, где блоки достраиваются к существующему
    расписанию (восстановление пропусков): удалять чужие строки в этом случае
    значило бы стереть уже выполненную работу.
    """
    if replace:
        schedule.blocks.all().delete()

    zone = resolve_zone(schedule.timezone)
    detailed_until = schedule.start_date + timedelta(days=detailed_horizon_days)

    plan = schedule.course_plan
    topics = {str(topic.id): topic for topic in _topics_of(plan)}
    modules = {module.external_id: module for module in plan.modules.all()}

    # Идентификаторы выдаются заранее: без них нельзя проставить
    # `prerequisite_block_ids` в один проход, а второй проход по всему
    # календарю ради этого — лишний десяток запросов.
    last_block_of_topic: dict[str, uuid.UUID] = {}
    rows: list[LearningBlock] = []

    for planned in draft.blocks:
        topic = topics.get(planned.topic_id)
        module = modules.get(planned.module_external_id)
        local_date = planned.start.astimezone(zone).date()
        detailed = local_date < detailed_until

        row = LearningBlock(
            id=uuid.uuid4(),
            user_email=schedule.user_email,
            schedule=schedule,
            course_plan=plan,
            module=module,
            topic=topic if planned.kind == "lesson" else None,
            title=planned.title,
            objective=planned.objective,
            activity_type=planned.activity_type,
            workspace_type=workspace_for(planned.activity_type),
            start_at=planned.start,
            end_at=planned.end,
            duration_minutes=planned.duration_minutes,
            status=LearningBlock.Status.SCHEDULED,
            detail_level=(
                LearningBlock.DetailLevel.DETAILED
                if detailed
                else LearningBlock.DetailLevel.OUTLINE
            ),
            source=(
                LearningBlock.Source.REVIEW
                if planned.kind == "review"
                else LearningBlock.Source.SCHEDULER
            ),
            mastery_criteria=planned.mastery_criteria,
            source_section_ids=list(planned.source_section_ids),
            source_chunk_ids=list(planned.source_chunk_ids),
            review_of_topic=topic if planned.kind == "review" else None,
            review_step=planned.review_step,
            lesson_payload=_lesson_payload(planned) if detailed else {},
        )

        deps = (prerequisites or {}).get(planned.topic_id, ())
        row.prerequisite_block_ids = [
            str(last_block_of_topic[dep]) for dep in deps if dep in last_block_of_topic
        ]
        rows.append(row)
        if planned.kind == "lesson" and planned.topic_id:
            last_block_of_topic[planned.topic_id] = row.id

    LearningBlock.objects.bulk_create(rows)

    schedule.conflict_report = (
        draft.conflict.to_payload() if draft.conflict is not None else {}
    )
    schedule.warnings = list(draft.warnings)
    schedule.pacing_snapshot = {**schedule.pacing_snapshot, "stats": draft.stats}
    schedule.save(
        update_fields=["conflict_report", "warnings", "pacing_snapshot", "updated_at"]
    )
    return rows


def _topics_of(plan):
    from curriculum.models import CourseTopic

    return CourseTopic.objects.filter(module__plan=plan).select_related("module")

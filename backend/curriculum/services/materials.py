"""Программа по источнику без файла.

Книга даёт программу через планировщик: модель читает оглавление, предлагает
модули и темы, рецензент их проверяет. Для `StudyMaterial` ничего этого не
нужно и не из чего сделать — у набора practice-тестов нет оглавления, есть
только «их десять и каждый идёт три часа».

Поэтому здесь чистый расчёт: количество единиц и минуты на единицу
раскладываются в занятия. Ни одного вызова модели, ни одного обращения к
retrieval — а значит, ни одной причины для программы не построиться.

Ниже по течению разницы нет. `studyplan` цепляется за `CoursePlan`,
`CourseModule` и `CourseTopic` и ни разу — за `Document`, так что расписание,
блоки и недельная сетка принимают такую программу как любую другую.
"""

from __future__ import annotations

import math
from datetime import date

from django.db import transaction

from ..models import (
    CourseModule,
    CoursePlan,
    CourseTopic,
    StudyMaterial,
)
from .plans import _apply_forecast

#: К какой длине занятия стремимся, раскладывая единицы по блокам.
#: Точный темп потом уточнит прогноз (`_apply_forecast`) — это лишь то, по
#: сколько единиц брать за раз.
TARGET_SESSION_MINUTES = 45

#: Как назвать занятие: одна единица и несколько.
#: Русский не даёт вывести одно из другого, поэтому пары заданы явно.
UNIT_TITLES = {
    StudyMaterial.Kind.LINK: ("Занятие", "Занятия"),
    StudyMaterial.Kind.PRACTICE_SET: ("Вариант", "Варианты"),
    StudyMaterial.Kind.PROBLEM_SET: ("Задача", "Задачи"),
    StudyMaterial.Kind.CUSTOM: ("Занятие", "Занятия"),
}


class MaterialNotPlannable(RuntimeError):
    """У источника не хватает данных, чтобы разложить его по занятиям."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def units_per_session(material: StudyMaterial, *, target_minutes: int) -> int:
    """Сколько единиц брать за одно занятие.

    Единица длиннее занятия не дробится: практис-тест на три часа — это один
    блок на три часа, а не четыре блока по сорок пять минут. Разрезанный
    посередине пробник перестаёт быть пробником.
    """
    if material.minutes_per_unit <= 0:
        return 1
    if material.minutes_per_unit >= target_minutes:
        return 1
    return max(1, round(target_minutes / material.minutes_per_unit))


def session_ranges(material: StudyMaterial, *, per_session: int) -> list[tuple[int, int]]:
    """Границы единиц в каждом занятии, включительно и с единицы."""
    ranges: list[tuple[int, int]] = []
    start = 1
    while start <= material.total_units:
        end = min(start + per_session - 1, material.total_units)
        ranges.append((start, end))
        start = end + 1
    return ranges


def topic_title(material: StudyMaterial, first: int, last: int) -> str:
    singular, plural = UNIT_TITLES.get(
        material.kind, UNIT_TITLES[StudyMaterial.Kind.CUSTOM]
    )
    if first == last:
        return f"{singular} {first}"
    return f"{plural} {first}–{last}"


@transaction.atomic
def build_plan(
    material: StudyMaterial,
    *,
    target_session_minutes: int = TARGET_SESSION_MINUTES,
    start_date: date | None = None,
) -> CoursePlan:
    """Строит программу по источнику. Детерминированно и без модели."""
    if material.total_units <= 0:
        raise MaterialNotPlannable(
            "material_without_units",
            "У источника не указано, сколько в нём всего единиц.",
        )
    if material.minutes_per_unit <= 0:
        raise MaterialNotPlannable(
            "material_without_duration",
            "У источника не указано, сколько времени занимает одна единица.",
        )

    goal = material.goal
    per_session = units_per_session(material, target_minutes=target_session_minutes)
    ranges = session_ranges(material, per_session=per_session)
    total_minutes = material.total_minutes

    # Пересборка — это просто повторный расчёт, поэтому прежняя программа по
    # тому же источнику уходит в архив, а не удаляется: по ней могли уже
    # заниматься, и `CourseEnrollment` держит версию через `PROTECT`.
    CoursePlan.objects.filter(material=material).exclude(
        status=CoursePlan.Status.ARCHIVED
    ).update(status=CoursePlan.Status.ARCHIVED)

    plan = CoursePlan.objects.create(
        user_email=material.user_email,
        goal=goal,
        document=None,
        material=material,
        title=material.title[:300],
        objective=material.note,
        current_level=goal.current_level,
        target_level=goal.target_level,
        language=goal.preferred_language,
        estimated_total_minutes=total_minutes,
        # Проверять нечего — программа посчитана, а не предложена моделью, —
        # но подтверждение остаётся за учеником: именно оно ставит занятия в
        # календарь.
        status=CoursePlan.Status.AWAITING_APPROVAL,
        schema_version=CoursePlan._meta.get_field("schema_version").default,
        current_version=1,
    )

    module = CourseModule.objects.create(
        plan=plan,
        external_id="m1",
        title=material.title[:300],
        objective=material.note,
        order_index=0,
        estimated_minutes=total_minutes,
    )

    CourseTopic.objects.bulk_create(
        [
            CourseTopic(
                module=module,
                external_id=f"t{index + 1}",
                title=topic_title(material, first, last)[:300],
                order_index=index,
                estimated_minutes=(last - first + 1) * material.minutes_per_unit,
                suggested_lesson_count=1,
                duration_breakdown={
                    "units": last - first + 1,
                    "minutes_per_unit": material.minutes_per_unit,
                    "unit_from": first,
                    "unit_to": last,
                },
            )
            for index, (first, last) in enumerate(ranges)
        ]
    )

    _apply_forecast(plan, goal, start_date=start_date)
    return plan

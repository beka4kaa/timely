"""Сохранение контеста из админки: разбор формы, права на тир, правила после начала."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from django.db import transaction
from django.db.models import Q
from django.utils.dateparse import parse_datetime
from rest_framework import status

from .contest_payloads import ordered_tasks
from .contest_rules import (
    ARTS,
    MAX_DESCRIPTION,
    MAX_EXPECTED_LENGTH,
    MAX_TASKS,
    MAX_TITLE,
    TIER_CAPS,
    Problem,
    allowed_tiers,
    publish_problems,
)
from .models import Contest, ContestFile, Task

LOCKED_MESSAGE = "После начала задачи, ответы, баллы, тир и начало не меняются."
FORBIDDEN_TIER = "Этот тир ставит только владелец."


class AdminRefusal(Exception):
    def __init__(self, code: str, message: str, http_status: int, problems: list[Problem] | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.http_status = http_status
        self.problems = problems or []


@dataclass
class ContestInput:
    title: str
    description: str
    start: datetime | None
    end: datetime | None
    tier: int | None
    art: str
    tasks: list[dict] = field(default_factory=list)


def _problem(code: str, field_name: str, message: str) -> Problem:
    return {"code": code, "field": field_name, "message": message}


def _when(raw) -> datetime | None:
    if not isinstance(raw, str):
        return None
    try:
        value = parse_datetime(raw)
    except ValueError:
        return None
    if value is None or value.tzinfo is None:
        return None
    return value


def _whole(raw) -> int | None:
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.strip().lstrip("-").isdigit():
        return int(raw.strip())
    return None


def parse_input(data, contest: Contest | None = None) -> tuple[ContestInput, list[Problem]]:
    """Форма как пришла: что из неё взять и что в ней не так. Ничего не пишет в базу."""
    problems: list[Problem] = []
    data = data if isinstance(data, dict) else {}

    title = data.get("title").strip() if isinstance(data.get("title"), str) else ""
    if not title:
        problems.append(_problem("title", "title", "Напиши название."))
    elif len(title) > MAX_TITLE:
        problems.append(_problem("title_long", "title", f"Название длиннее {MAX_TITLE} знаков."))

    description = data.get("description").strip() if isinstance(data.get("description"), str) else ""
    if len(description) > MAX_DESCRIPTION:
        problems.append(_problem("description_long", "description", f"Описание длиннее {MAX_DESCRIPTION} знаков."))

    start, end = _when(data.get("start_time")), _when(data.get("end_time"))
    if start is None or end is None:
        problems.append(_problem("dates", "dates", "Укажи начало и конец."))
    elif end <= start:
        problems.append(_problem("dates_order", "dates", "Конец должен быть позже начала."))

    tier = _whole(data.get("tier"))
    if tier not in TIER_CAPS:
        problems.append(_problem("tier", "tier", "Выбери тир."))
        tier = None

    art = data.get("art") if isinstance(data.get("art"), str) else ""
    if art not in ARTS:
        problems.append(_problem("art", "art", "Выбери рисунок."))

    raw_tasks = data.get("tasks")
    if not isinstance(raw_tasks, list):
        raw_tasks = []
        problems.append(_problem("tasks", "tasks", "Задачи пришли в странном виде."))
    if len(raw_tasks) > MAX_TASKS:
        problems.append(_problem("too_many_tasks", "tasks", f"Задач не больше {MAX_TASKS}."))

    own_tasks = set(contest.tasks.values_list("id", flat=True)) if contest is not None else set()
    wanted_files = {
        _whole(item.get(key))
        for item in raw_tasks if isinstance(item, dict)
        for key in ("statement_file", "solution_file")
    } - {None}
    known_files = set(ContestFile.objects.filter(pk__in=wanted_files).values_list("pk", flat=True))

    tasks: list[dict] = []
    for number, item in enumerate(raw_tasks, start=1):
        where = f"tasks.{number}"
        if not isinstance(item, dict):
            problems.append(_problem("tasks", where, f"Задача {number} пришла в странном виде."))
            continue
        task_id = None
        if item.get("id") is not None:
            task_id = _whole(item.get("id"))
            if task_id not in own_tasks:
                problems.append(_problem("bad_task", where, f"Задача {number} не из этого контеста."))
        answer = item.get("answer").strip() if isinstance(item.get("answer"), str) else ""
        if len(answer) > MAX_EXPECTED_LENGTH:
            problems.append(_problem("answer_long", where, f"Ответ задачи {number} длиннее {MAX_EXPECTED_LENGTH} знаков."))
        points = _whole(item.get("points"))
        if points is None or points < 1:
            problems.append(_problem("bad_points", where, f"Баллы задачи {number} от 1."))
        files = {}
        for key in ("statement_file", "solution_file"):
            raw = item.get(key)
            file_id = _whole(raw) if raw is not None else None
            if raw is not None and file_id not in known_files:
                problems.append(_problem("bad_file", where, f"Файл задачи {number} не найден."))
                file_id = None
            files[key] = file_id
        tasks.append({"id": task_id, "answer": answer, "points": points or 0, **files})

    return ContestInput(title, description, start, end, tier, art, tasks), problems


def check_permission(actor, contest: Contest | None, wanted: ContestInput | None = None) -> None:
    """Модератор не трогает контесты тиров 1 и 2 и не ставит их сам."""
    allowed = allowed_tiers(actor)
    if contest is not None and contest.tier not in allowed:
        raise AdminRefusal("tier_forbidden", FORBIDDEN_TIER, status.HTTP_403_FORBIDDEN)
    if wanted is not None and wanted.tier is not None and wanted.tier not in allowed:
        raise AdminRefusal("tier_forbidden", FORBIDDEN_TIER, status.HTTP_403_FORBIDDEN)


def _same_time(left: datetime | None, right: datetime | None) -> bool:
    # Браузер хранит миллисекунды, база микросекунды: секунды достаточно.
    return left is not None and right is not None and abs((left - right).total_seconds()) < 1


def _same_tasks(contest: Contest, wanted: ContestInput) -> bool:
    current = ordered_tasks(contest)
    if len(current) != len(wanted.tasks):
        return False
    for task, item in zip(current, wanted.tasks):
        if (
            item["id"] != task.id
            or item["answer"] != (task.answer or "").strip()
            or item["points"] != task.points
            or item["statement_file"] != task.statement_file_id
        ):
            return False
    return True


def started(contest: Contest, now: datetime) -> bool:
    return contest.is_published and now >= contest.start_time


def check_locked(contest: Contest, wanted: ContestInput, now: datetime) -> None:
    """После начала меняются только название, описание, рисунок, конец и PDF решений."""
    if not started(contest, now):
        return
    locked = AdminRefusal("locked", LOCKED_MESSAGE, status.HTTP_409_CONFLICT)
    if wanted.tier != contest.tier or not _same_time(wanted.start, contest.start_time) or not _same_tasks(contest, wanted):
        raise locked
    if not _same_time(wanted.end, contest.end_time):
        # Закончившийся контест не продлевается: ответы уже видны.
        if now >= contest.end_time or wanted.end is None or wanted.end <= now:
            raise locked


def ready_problems(contest: Contest | None, wanted: ContestInput, actor, now: datetime) -> list[Problem]:
    return publish_problems(
        title=wanted.title,
        start=wanted.start,
        end=wanted.end,
        tier=wanted.tier,
        art=wanted.art,
        tasks=[{"answer": item["answer"], "points": item["points"], "statement_file": item["statement_file"]} for item in wanted.tasks],
        actor=actor,
        now=now,
    )


def contest_problems(contest: Contest, actor, now: datetime) -> list[Problem]:
    return publish_problems(
        title=contest.title,
        start=contest.start_time,
        end=contest.end_time,
        tier=contest.tier,
        art=contest.art,
        tasks=[
            {"answer": task.answer, "points": task.points, "statement_file": task.statement_file_id}
            for task in ordered_tasks(contest)
        ],
        actor=actor,
        now=now,
    )


def drop_unused_files(candidates: set[int]) -> None:
    """Удалить PDF, на которые больше не ссылается ни одна задача."""
    candidates = {file_id for file_id in candidates if file_id}
    if not candidates:
        return
    used: set[int] = set()
    for statement_id, solution_id in Task.objects.filter(
        Q(statement_file_id__in=candidates) | Q(solution_file_id__in=candidates)
    ).values_list("statement_file_id", "solution_file_id"):
        used.update({statement_id, solution_id})
    ContestFile.objects.filter(pk__in=candidates - used).delete()


def _forget_tasks(tasks) -> None:
    for task in tasks:
        if not task.contests.exists() and not task.submissions.exists():
            task.delete()


def save_contest(contest: Contest | None, wanted: ContestInput, actor) -> Contest:
    """Записать форму. Задачи с id обновляются, новые создаются, пропавшие уходят."""
    with transaction.atomic():
        fields = {
            "title": wanted.title,
            "description": wanted.description,
            "start_time": wanted.start,
            "end_time": wanted.end,
            "tier": wanted.tier,
            "art": wanted.art,
        }
        if contest is None:
            contest = Contest.objects.create(created_by=actor, is_published=False, **fields)
            existing: dict[int, Task] = {}
        else:
            for name, value in fields.items():
                setattr(contest, name, value)
            contest.save(update_fields=list(fields))
            existing = {task.id: task for task in contest.tasks.all()}
        old_files = {
            file_id for task in existing.values() for file_id in (task.statement_file_id, task.solution_file_id)
        }

        kept: list[Task] = []
        for position, item in enumerate(wanted.tasks):
            values = {
                "answer": item["answer"],
                "points": item["points"],
                "position": position,
                "statement_file_id": item["statement_file"],
                "solution_file_id": item["solution_file"],
            }
            task = existing.get(item["id"]) if item["id"] else None
            if task is None:
                task = Task.objects.create(author=actor, status="active", title="", **values)
            else:
                for name, value in values.items():
                    setattr(task, name, value)
                task.save(update_fields=["answer", "points", "position", "statement_file", "solution_file"])
            kept.append(task)
        contest.tasks.set(kept)
        kept_ids = {task.id for task in kept}
        _forget_tasks([task for task_id, task in existing.items() if task_id not in kept_ids])
        drop_unused_files(old_files)
    return contest


def delete_contest(contest: Contest) -> None:
    with transaction.atomic():
        tasks = list(contest.tasks.all())
        files = {file_id for task in tasks for file_id in (task.statement_file_id, task.solution_file_id)}
        contest.delete()
        _forget_tasks(tasks)
        drop_unused_files(files)

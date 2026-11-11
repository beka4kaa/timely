"""Ответы API о контестах, собранные руками.

Сериализатор по модели отдаёт все поля, и правильный ответ или условие легко
утекают раньше времени. Здесь каждое поле добавляется явно и только когда можно.
"""

from __future__ import annotations

from datetime import datetime

from django.db.models import Prefetch
from rest_framework import serializers

from .contest_rules import REVIEW_TEXT_LIMIT, contest_state, first_variant
from .models import Contest, Task, TaskSubmission

_iso = serializers.DateTimeField().to_representation


def contest_queryset():
    """Контесты с задачами, без самих PDF: содержимое файлов читают только скачивания."""
    tasks = Task.objects.select_related("statement_file", "solution_file").defer(
        "statement_file__data", "solution_file__data",
    )
    return Contest.objects.prefetch_related(Prefetch("tasks", queryset=tasks))


def ordered_tasks(contest: Contest) -> list[Task]:
    return sorted(contest.tasks.all(), key=lambda task: (task.position, task.id))


def task_number(contest: Contest, task_id: int) -> int | None:
    for number, task in enumerate(ordered_tasks(contest), start=1):
        if task.id == task_id:
            return number
    return None


def _task_detail(task: Task, number: int, state: str) -> dict:
    row = {
        "id": task.id,
        "number": number,
        "title": task.title or "",
        "points": task.points,
        "has_statement": bool(task.statement_file_id),
        # Текст только у старых задач без PDF: у новых условие в файле.
        "condition_text": "" if task.statement_file_id else (task.condition_text or ""),
    }
    if state == "ended":
        statement_text = task.statement_file.text if task.statement_file_id else ""
        row["answer"] = first_variant(task.answer)
        row["has_solution"] = bool(task.solution_file_id)
        row["review_text"] = (statement_text or task.condition_text or "")[:REVIEW_TEXT_LIMIT]
    return row


def mine_results(contest: Contest, viewer, tasks: list[Task]) -> list[dict]:
    """Свои попытки ученика по задачам: сколько, решена ли и последний ответ."""
    rows = (
        TaskSubmission.objects.filter(contest=contest, student=viewer)
        .order_by("created_at", "pk")
        .values_list("task_id", "status", "file_url_or_code")
    )
    summary: dict[int, dict] = {}
    for task_id, status, answer in rows:
        item = summary.setdefault(task_id, {"task": task_id, "attempts": 0, "solved": False, "last_answer": ""})
        item["attempts"] += 1
        item["solved"] = item["solved"] or status == "approved"
        item["last_answer"] = answer or ""
    return [summary[task.id] for task in tasks if task.id in summary]


def student_contest(contest: Contest, *, now: datetime, viewer=None, with_mine: bool = False) -> dict:
    state = contest_state(contest.start_time, contest.end_time, now)
    tasks = ordered_tasks(contest)
    data = {
        "id": contest.id,
        "title": contest.title,
        "description": contest.description,
        "start_time": _iso(contest.start_time),
        "end_time": _iso(contest.end_time),
        "tier": contest.tier,
        "art": contest.art,
        "state": state,
        "tasks": [task.id for task in tasks],
        "task_count": len(tasks),
        "points_total": sum(task.points for task in tasks),
        "task_details": [],
        "created_at": _iso(contest.created_at),
    }
    if state != "upcoming":
        data["task_details"] = [_task_detail(task, number, state) for number, task in enumerate(tasks, start=1)]
    if with_mine and viewer is not None:
        data["mine"] = mine_results(contest, viewer, tasks)
    return data

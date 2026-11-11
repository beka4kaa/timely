"""Ответы API о контестах, собранные руками.

Сериализатор по модели отдаёт все поля, и правильный ответ или условие легко
утекают раньше времени. Здесь каждое поле добавляется явно и только когда можно.
"""

from __future__ import annotations

from datetime import datetime

from django.db.models import Count, Prefetch
from rest_framework import serializers

from .contest_rules import REVIEW_TEXT_LIMIT, TIER_CAPS, Attempt, contest_state, first_variant, standings
from .models import Contest, CustomUser, Task, TaskSubmission
from .serializers import public_username

HIDDEN_NAME = "Участник"
FEED_LIMIT = 200

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


def visible_names(viewer, student_ids) -> dict[int, str]:
    """Имя для таблицы и ленты: публичное у согласившихся и у себя, иначе «Участник»."""
    from .views import on_public_board  # views импортирует этот модуль через contest_views

    users = list(CustomUser.objects.filter(pk__in=set(student_ids)).only("pk", "username"))
    shown = set(
        CustomUser.objects.filter(pk__in=[user.pk for user in users])
        .filter(on_public_board(viewer))
        .values_list("pk", flat=True)
    )
    return {user.pk: public_username(user) if user.pk in shown else HIDDEN_NAME for user in users}


def standings_payload(contest: Contest, *, now: datetime, viewer=None) -> list[dict]:
    if contest_state(contest.start_time, contest.end_time, now) == "upcoming":
        return []
    tasks = ordered_tasks(contest)
    rows = TaskSubmission.objects.filter(contest=contest).values_list("student_id", "task_id", "status", "created_at")
    attempts = [Attempt(student, task, status == "approved", at) for student, task, status, at in rows]
    table = standings([task.id for task in tasks], {task.id: task.points for task in tasks}, attempts, contest.start_time)
    names = visible_names(viewer, [row.student_id for row in table])
    me = viewer.pk if viewer is not None else None
    return [
        {
            "place": row.place,
            "name": names.get(row.student_id, HIDDEN_NAME),
            "me": row.student_id == me,
            "points": row.points,
            "solved": row.solved,
            "penalty": row.penalty,
            "marks": row.marks,
        }
        for row in table
    ]


def attempts_payload(contest: Contest, *, now: datetime, viewer=None, mine: bool = False) -> list[dict]:
    """Лента попыток без самих ответов: время от начала, кто, номер задачи и вердикт."""
    if contest_state(contest.start_time, contest.end_time, now) == "upcoming":
        return []
    numbers = {task.id: number for number, task in enumerate(ordered_tasks(contest), start=1)}
    queryset = TaskSubmission.objects.filter(contest=contest)
    if mine:
        queryset = queryset.filter(student=viewer) if viewer is not None else queryset.none()
    rows = list(
        queryset.order_by("-created_at", "-pk").values_list("pk", "student_id", "task_id", "status", "created_at")[:FEED_LIMIT]
    )
    names = visible_names(viewer, [row[1] for row in rows])
    me = viewer.pk if viewer is not None else None
    return [
        {
            "id": pk,
            "at": max(0, int((created_at - contest.start_time).total_seconds())),
            "name": names.get(student_id, HIDDEN_NAME),
            "me": student_id == me,
            "task": numbers.get(task_id, 0),
            "correct": status == "approved",
        }
        for pk, student_id, task_id, status, created_at in rows
    ]


def file_info(file) -> dict | None:
    if file is None:
        return None
    return {"id": file.pk, "name": file.name, "size": file.size, "pages": file.pages}


def with_stats(queryset):
    """Сколько учеников отвечало и сколько всего попыток."""
    return queryset.annotate(
        participants_count=Count("submissions__student", distinct=True),
        attempts_count=Count("submissions", distinct=True),
    )


def admin_contest(contest: Contest, *, now: datetime) -> dict:
    """Всё о контесте для админки, вместе с ответами и файлами."""
    tasks = ordered_tasks(contest)
    attempts = getattr(contest, "attempts_count", None)
    participants = getattr(contest, "participants_count", None)
    if attempts is None or participants is None:
        attempts = contest.submissions.count()
        participants = contest.submissions.values("student").distinct().count()
    return {
        "id": contest.id,
        "title": contest.title,
        "description": contest.description,
        "start_time": _iso(contest.start_time),
        "end_time": _iso(contest.end_time),
        "tier": contest.tier,
        "art": contest.art,
        "is_published": contest.is_published,
        "state": contest_state(contest.start_time, contest.end_time, now),
        "created_at": _iso(contest.created_at),
        "points_total": sum(task.points for task in tasks),
        "tier_cap": TIER_CAPS.get(contest.tier, 0),
        "participants": participants,
        "attempts": attempts,
        "can_delete": attempts == 0,
        "locked": contest.is_published and now >= contest.start_time,
        "tasks": [
            {
                "id": task.id,
                "number": number,
                "title": task.title or "",
                "condition_text": task.condition_text or "",
                "answer": task.answer or "",
                "points": task.points,
                "statement": file_info(task.statement_file),
                "solution": file_info(task.solution_file),
            }
            for number, task in enumerate(tasks, start=1)
        ],
    }

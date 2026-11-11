"""Адреса контестов: что видит ученик и что делает админ."""

from __future__ import annotations

import math

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .contest_files import PdfRejected, pdf_response, read_pdf
from .contest_payloads import contest_queryset, ordered_tasks, student_contest
from .contest_rules import (
    MAX_ANSWER_LENGTH,
    MAX_ATTEMPTS_PER_TASK,
    MIN_SECONDS_BETWEEN_ATTEMPTS,
    answers_match,
    contest_state,
    split_variants,
)
from .models import ContestFile, CustomUser, TaskSubmission
from .views import current_user, is_admin_or_mod


def refusal(code: str, message: str, http_status: int, **extra) -> Response:
    return Response({"error": message, "code": code, **extra}, status=http_status)


def forbidden() -> Response:
    return refusal("forbidden", "Это только для админов.", status.HTTP_403_FORBIDDEN)


def not_found(message: str = "Такого контеста нет.", code: str = "not_found") -> Response:
    return refusal(code, message, status.HTTP_404_NOT_FOUND)


def file_info(file: ContestFile | None) -> dict | None:
    if file is None:
        return None
    return {"id": file.pk, "name": file.name, "size": file.size, "pages": file.pages}


class ContestViewSet(viewsets.ViewSet):
    """Контесты для ученика. Только опубликованные, и ничего раньше времени."""

    permission_classes = [AllowAny]

    def _published(self, pk, *, admin: bool = False):
        if not str(pk).isdigit():
            return None
        queryset = contest_queryset()
        if not admin:
            queryset = queryset.filter(is_published=True)
        return queryset.filter(pk=int(pk)).first()

    def list(self, request):
        now = timezone.now()
        contests = contest_queryset().filter(is_published=True).order_by("-start_time", "-id")
        return Response([student_contest(contest, now=now) for contest in contests])

    def retrieve(self, request, pk=None):
        contest = self._published(pk)
        if contest is None:
            return not_found()
        viewer = current_user(request)
        return Response(student_contest(contest, now=timezone.now(), viewer=viewer, with_mine=True))

    def _download(self, request, pk, task_id, kind: str):
        admin = is_admin_or_mod(current_user(request))
        contest = self._published(pk, admin=admin)
        if contest is None:
            return not_found()
        tasks = ordered_tasks(contest)
        number = next((index for index, task in enumerate(tasks, start=1) if str(task.id) == str(task_id)), None)
        if number is None:
            return not_found("Такой задачи в контесте нет.", "bad_task")
        task = tasks[number - 1]
        state = contest_state(contest.start_time, contest.end_time, timezone.now())
        if not admin and kind == "statement" and state == "upcoming":
            return not_found("Задачи откроются, когда контест начнётся.", "not_started")
        if not admin and kind == "solution" and state != "ended":
            return not_found("Решение откроется после конца контеста.", "not_ended")
        file_id = task.statement_file_id if kind == "statement" else task.solution_file_id
        stored = ContestFile.objects.filter(pk=file_id).first() if file_id else None
        if stored is None:
            return not_found("Файла нет.", "no_file")
        prefix = "zadacha" if kind == "statement" else "reshenie"
        return pdf_response(stored, f"{prefix}-{number}.pdf")

    @action(detail=True, methods=["post"])
    def answer(self, request, pk=None):
        """POST /api/contests/{id}/answer/ {task, answer}: вердикт сразу, баллы один раз."""
        user = current_user(request)
        if user is None:
            return refusal("no_profile", "Войди в аккаунт, чтобы отвечать.", status.HTTP_403_FORBIDDEN)
        if is_admin_or_mod(user):
            return refusal("admin", "Админы не отвечают в контестах.", status.HTTP_403_FORBIDDEN)
        contest = self._published(pk)
        if contest is None:
            return not_found()
        task = next((row for row in ordered_tasks(contest) if str(row.id) == str(request.data.get("task"))), None)
        if task is None:
            return not_found("Такой задачи в контесте нет.", "bad_task")
        now = timezone.now()
        if contest_state(contest.start_time, contest.end_time, now) != "running":
            return refusal("not_running", "Контест сейчас не идёт.", status.HTTP_409_CONFLICT)
        raw = request.data.get("answer")
        text = raw.strip() if isinstance(raw, str) else ""
        if not text:
            return refusal("empty", "Впиши ответ.", status.HTTP_400_BAD_REQUEST)
        if len(text) > MAX_ANSWER_LENGTH:
            return refusal("too_long", f"Ответ длиннее {MAX_ANSWER_LENGTH} знаков.", status.HTTP_400_BAD_REQUEST)

        mine = TaskSubmission.objects.filter(contest=contest, student=user)
        if mine.filter(task=task, status="approved").exists():
            return refusal("already_solved", "Эта задача уже решена.", status.HTTP_409_CONFLICT)
        tried = mine.filter(task=task).count()
        if tried >= MAX_ATTEMPTS_PER_TASK:
            return refusal("too_many", "Попыток по этой задаче больше нет.", status.HTTP_429_TOO_MANY_REQUESTS)
        last = mine.order_by("-created_at").values_list("created_at", flat=True).first()
        if last is not None:
            waited = (now - last).total_seconds()
            if waited < MIN_SECONDS_BETWEEN_ATTEMPTS:
                return refusal(
                    "too_fast", "Подожди пару секунд.", status.HTTP_429_TOO_MANY_REQUESTS,
                    retry_after=max(1, math.ceil(MIN_SECONDS_BETWEEN_ATTEMPTS - waited)),
                )
        if not split_variants(task.answer):
            return refusal("no_answer", "У задачи нет ответа.", status.HTTP_409_CONFLICT)

        correct = answers_match(text, task.answer)
        try:
            with transaction.atomic():
                TaskSubmission.objects.create(
                    student=user, task=task, contest=contest, file_url_or_code=text,
                    status="approved" if correct else "rejected", reviewed_at=now,
                )
                if correct:
                    CustomUser.objects.filter(pk=user.pk).update(overall_elo=F("overall_elo") + task.points)
        except IntegrityError:
            # Вторая верная попытка из соседней вкладки: индекс не пустил, баллы не начислены.
            return refusal("already_solved", "Эта задача уже решена.", status.HTTP_409_CONFLICT)
        return Response({
            "correct": correct,
            "points": task.points if correct else 0,
            "attempt": tried + 1,
            "solved": correct,
        })

    @action(detail=True, methods=["get"], url_path=r"tasks/(?P<task_id>\d+)/statement")
    def statement(self, request, pk=None, task_id=None):
        return self._download(request, pk, task_id, "statement")

    @action(detail=True, methods=["get"], url_path=r"tasks/(?P<task_id>\d+)/solution")
    def solution(self, request, pk=None, task_id=None):
        return self._download(request, pk, task_id, "solution")


class AdminContestFileViewSet(viewsets.ViewSet):
    """POST /api/admin/contest-files/ — загрузить PDF; GET …/{id}/ — скачать его."""

    permission_classes = [AllowAny]
    parser_classes = [MultiPartParser, FormParser, JSONParser]

    def create(self, request):
        actor = current_user(request)
        if not is_admin_or_mod(actor):
            return forbidden()
        try:
            info = read_pdf(request.FILES.get("file"))
        except PdfRejected as rejected:
            return refusal(rejected.code, rejected.message, status.HTTP_400_BAD_REQUEST)
        stored = ContestFile.objects.create(
            data=info.data,
            name=info.name,
            size=info.size,
            pages=info.pages,
            sha256=info.sha256,
            text=info.text,
            uploaded_by=actor,
        )
        return Response(file_info(stored), status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        if not is_admin_or_mod(current_user(request)):
            return forbidden()
        stored = ContestFile.objects.filter(pk=pk).first() if str(pk).isdigit() else None
        if stored is None:
            return refusal("not_found", "Файла нет.", status.HTTP_404_NOT_FOUND)
        return pdf_response(stored, f"fajl-{stored.pk}.pdf")

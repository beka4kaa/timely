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
from .contest_admin import (
    AdminRefusal,
    check_locked,
    check_permission,
    contest_problems,
    delete_contest,
    parse_input,
    ready_problems,
    save_contest,
    started,
)
from .contest_payloads import (
    admin_contest,
    attempts_payload,
    contest_queryset,
    file_info,
    ordered_tasks,
    standings_payload,
    student_contest,
    with_stats,
)
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

    @action(detail=True, methods=["get"])
    def standings(self, request, pk=None):
        contest = self._published(pk)
        if contest is None:
            return not_found()
        return Response(standings_payload(contest, now=timezone.now(), viewer=current_user(request)))

    @action(detail=True, methods=["get"])
    def attempts(self, request, pk=None):
        contest = self._published(pk)
        if contest is None:
            return not_found()
        mine = (request.query_params.get("mine") or "").lower() in {"1", "true", "yes"}
        return Response(attempts_payload(contest, now=timezone.now(), viewer=current_user(request), mine=mine))

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


class AdminContestViewSet(viewsets.ViewSet):
    """Контесты в админке: черновики, публикация, правила тиров и правок после начала."""

    permission_classes = [AllowAny]

    def _actor(self, request):
        actor = current_user(request)
        return actor if is_admin_or_mod(actor) else None

    def _find(self, pk):
        if not str(pk).isdigit():
            return None
        return with_stats(contest_queryset()).filter(pk=int(pk)).first()

    def _answer(self, pk, http_status=status.HTTP_200_OK) -> Response:
        return Response(admin_contest(self._find(pk), now=timezone.now()), status=http_status)

    @staticmethod
    def _refused(refusal_error: AdminRefusal) -> Response:
        extra = {"problems": refusal_error.problems} if refusal_error.problems else {}
        return refusal(refusal_error.code, refusal_error.message, refusal_error.http_status, **extra)

    def list(self, request):
        if self._actor(request) is None:
            return forbidden()
        now = timezone.now()
        contests = with_stats(contest_queryset()).order_by("-start_time", "-id")
        return Response([admin_contest(contest, now=now) for contest in contests])

    def retrieve(self, request, pk=None):
        if self._actor(request) is None:
            return forbidden()
        contest = self._find(pk)
        if contest is None:
            return not_found()
        return Response(admin_contest(contest, now=timezone.now()))

    def create(self, request):
        actor = self._actor(request)
        if actor is None:
            return forbidden()
        wanted, problems = parse_input(request.data)
        if problems:
            return refusal("invalid", "Проверь поля.", status.HTTP_400_BAD_REQUEST, problems=problems)
        try:
            check_permission(actor, None, wanted)
        except AdminRefusal as refused:
            return self._refused(refused)
        contest = save_contest(None, wanted, actor)
        return self._answer(contest.pk, status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        actor = self._actor(request)
        if actor is None:
            return forbidden()
        contest = self._find(pk)
        if contest is None:
            return not_found()
        now = timezone.now()
        try:
            check_permission(actor, contest)
            wanted, problems = parse_input(request.data, contest)
            if problems:
                return refusal("invalid", "Проверь поля.", status.HTTP_400_BAD_REQUEST, problems=problems)
            check_permission(actor, contest, wanted)
            check_locked(contest, wanted, now)
            if contest.is_published and not started(contest, now):
                # Опубликованный контест до начала остаётся годным к публикации.
                blockers = ready_problems(contest, wanted, actor, now)
                if blockers:
                    raise AdminRefusal("not_ready", "Так контест не опубликовать.", status.HTTP_400_BAD_REQUEST, blockers)
        except AdminRefusal as refused:
            return self._refused(refused)
        save_contest(contest, wanted, actor)
        return self._answer(contest.pk)

    def destroy(self, request, pk=None):
        actor = self._actor(request)
        if actor is None:
            return forbidden()
        contest = self._find(pk)
        if contest is None:
            return not_found()
        try:
            check_permission(actor, contest)
        except AdminRefusal as refused:
            return self._refused(refused)
        if contest.submissions.exists():
            return refusal("has_answers", "В контесте уже есть ответы.", status.HTTP_409_CONFLICT)
        delete_contest(contest)
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=True, methods=["post"])
    def publish(self, request, pk=None):
        actor = self._actor(request)
        if actor is None:
            return forbidden()
        contest = self._find(pk)
        if contest is None:
            return not_found()
        try:
            check_permission(actor, contest)
        except AdminRefusal as refused:
            return self._refused(refused)
        blockers = contest_problems(contest, actor, timezone.now())
        if blockers:
            return refusal("not_ready", "Контест пока нельзя опубликовать.", status.HTTP_400_BAD_REQUEST, problems=blockers)
        contest.is_published = True
        contest.save(update_fields=["is_published"])
        return self._answer(contest.pk)

    @action(detail=True, methods=["post"])
    def unpublish(self, request, pk=None):
        actor = self._actor(request)
        if actor is None:
            return forbidden()
        contest = self._find(pk)
        if contest is None:
            return not_found()
        try:
            check_permission(actor, contest)
        except AdminRefusal as refused:
            return self._refused(refused)
        if started(contest, timezone.now()):
            return refusal("started", "Контест уже начался.", status.HTTP_409_CONFLICT)
        contest.is_published = False
        contest.save(update_fields=["is_published"])
        return self._answer(contest.pk)

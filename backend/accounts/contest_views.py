"""Адреса контестов: что видит ученик и что делает админ."""

from __future__ import annotations

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .contest_files import PdfRejected, pdf_response, read_pdf
from .contest_payloads import contest_queryset, ordered_tasks, student_contest
from .contest_rules import contest_state
from .models import ContestFile
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

"""HTTP-слой curriculum.

Идентификация пользователя — заголовок `X-User-Email`, который проставляет
`config.middleware` в `request.user_email`, как во всех остальных приложениях
проекта (см. `pomodoro/views.py`). Без него queryset пустой: доступ по умолчанию
запрещён, а не открыт.

Отдельно про решения задач: ни один endpoint здесь не отдаёт `ExtractedSolution`
и ни один не отдаёт чанки с `solution_visibility="restricted"`. Право на решения
описывается `retrieval.RetrievalPolicy.allows_solutions`, и именно оно, а не
новое локальное правило, определяет фильтрацию.
"""

from __future__ import annotations

import logging

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response

from . import storage as storage_module
from .models import (
    CourseEnrollment,
    CoursePlan,
    Document,
    DocumentFile,
    ExtractedTask,
    IngestionJob,
    KnowledgeChunk,
    LearningGoal,
)
from .retrieval import RetrievalPolicy
from .serializers import (
    CourseEnrollmentSerializer,
    CoursePlanListSerializer,
    CoursePlanSerializer,
    CoursePlanVersionSerializer,
    DocumentSectionSerializer,
    DocumentSerializer,
    DocumentUploadSerializer,
    ExtractedTaskSerializer,
    GeneratePlanSerializer,
    GoalConfirmSerializer,
    IngestionJobSerializer,
    KnowledgeChunkSerializer,
    LearningGoalSerializer,
)
from .services import goals as goals_service
from .services import plans as plans_service
from .services.ingestion import ingest_document
from .upload_validation import UploadRejected, validate_pdf_upload

logger = logging.getLogger(__name__)

# Режим, в котором работает ученик, читая свой документ через API. Он входит в
# `_INDEPENDENT_MODES`, поэтому `allows_solutions` для него False.
STUDENT_READ_MODE = "solve"


class _UserScopedViewSet(viewsets.ModelViewSet):
    """Базовый набор: всё ограничено текущим пользователем."""

    def _user_email(self) -> str | None:
        return getattr(self.request, "user_email", None)

    def _require_email(self) -> str | None:
        email = self._user_email()
        return email or None


class LearningGoalViewSet(_UserScopedViewSet):
    """Учебные цели ученика."""

    serializer_class = LearningGoalSerializer

    def get_queryset(self):
        email = self._user_email()
        if not email:
            return LearningGoal.objects.none()
        return LearningGoal.objects.filter(user_email=email)

    def perform_create(self, serializer):
        serializer.save(
            user_email=self._user_email(), status=LearningGoal.Status.DRAFT
        )

    def create(self, request, *args, **kwargs):
        if not self._user_email():
            return _no_user()
        return super().create(request, *args, **kwargs)

    @action(detail=True, methods=["post"])
    def normalize(self, request, pk=None):
        """Просит модель разобрать формулировку. `original_text` не меняется."""
        goal = self.get_object()
        goals_service.normalize_goal(goal)
        goal.refresh_from_db()
        return Response(self.get_serializer(goal).data)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        """Подтверждение нормализации учеником, с его правками."""
        goal = self.get_object()
        payload = GoalConfirmSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        try:
            goals_service.confirm_goal(goal, **payload.validated_data)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        goal.refresh_from_db()
        return Response(self.get_serializer(goal).data)


class DocumentViewSet(_UserScopedViewSet):
    """Документы ученика: загрузка PDF и его обработка."""

    serializer_class = DocumentSerializer
    parser_classes = [MultiPartParser, FormParser]

    def get_queryset(self):
        email = self._user_email()
        if not email:
            return Document.objects.none()
        return Document.objects.filter(user_email=email).select_related("file")

    def perform_create(self, serializer):
        serializer.save(user_email=self._user_email())

    @action(detail=False, methods=["post"])
    def upload(self, request):
        """Принимает PDF: валидация содержимого → storage → Document."""
        email = self._user_email()
        if not email:
            return _no_user()

        payload = DocumentUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        upload = payload.validated_data["file"]
        data = upload.read()

        try:
            validated = validate_pdf_upload(
                data=data,
                filename=upload.name,
                declared_mime=getattr(upload, "content_type", "") or "",
            )
        except UploadRejected as exc:
            return Response(
                {"error": exc.message, "code": exc.code},
                status=status.HTTP_400_BAD_REQUEST,
            )

        title = (payload.validated_data.get("title") or "").strip()
        document = Document.objects.create(
            user_email=email,
            title=(title or validated.sanitized_filename)[:400],
            language=payload.validated_data.get("language") or "ru",
            document_type=payload.validated_data.get("document_type")
            or Document.DocType.TEXTBOOK,
            source_type=Document.SourceType.UPLOAD,
            page_count=validated.page_count,
            copyright_declaration=payload.validated_data.get(
                "copyright_declaration", ""
            ),
            ingestion_status=Document.Status.UPLOADED,
        )

        store = storage_module.get_storage()
        key = storage_module.build_storage_key(
            user_email=email,
            document_id=str(document.pk),
            filename=validated.sanitized_filename,
        )
        try:
            store.save(key, data)
        except storage_module.StorageError as exc:
            document.delete()
            return Response(
                {"error": str(exc), "code": "storage_error"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        DocumentFile.objects.create(
            document=document,
            original_filename=upload.name[:400],
            sanitized_filename=validated.sanitized_filename,
            storage_backend=store.backend_name,
            storage_key=key,
            mime_type=validated.mime_type,
            byte_size=validated.byte_size,
            content_hash=validated.sha256,
        )

        return Response(
            {
                "document": DocumentSerializer(document).data,
                "warnings": list(validated.warnings),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def ingest(self, request, pk=None):
        """Запускает обработку. Синхронно: очереди задач в проекте нет."""
        document = self.get_object()
        outcome = ingest_document(document)
        document.refresh_from_db()
        body = {
            "document": DocumentSerializer(document).data,
            "job": IngestionJobSerializer(outcome.job).data,
            "stats": {
                "pages": outcome.pages,
                "ocr_pages": outcome.ocr_pages,
                "sections": outcome.sections,
                "blocks": outcome.blocks,
                "tasks": outcome.tasks,
                "solutions": outcome.solutions,
                "chunks": outcome.chunks,
            },
            "warnings": outcome.warnings,
        }
        # Провал обработки — не 500: пользователю нужен понятный статус.
        code = (
            status.HTTP_200_OK
            if outcome.succeeded
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        return Response(body, status=code)

    @action(detail=True, methods=["get"])
    def jobs(self, request, pk=None):
        document = self.get_object()
        rows = IngestionJob.objects.filter(document=document)
        return Response(IngestionJobSerializer(rows, many=True).data)

    @action(detail=True, methods=["get"])
    def sections(self, request, pk=None):
        document = self.get_object()
        rows = document.sections.all().order_by("order_index")
        return Response(DocumentSectionSerializer(rows, many=True).data)

    @action(detail=True, methods=["get"])
    def tasks(self, request, pk=None):
        """Условия задач. Решения не отдаются ни при каких параметрах."""
        document = self.get_object()
        rows = ExtractedTask.objects.filter(document=document)
        return Response(ExtractedTaskSerializer(rows, many=True).data)

    @action(detail=True, methods=["get"])
    def chunks(self, request, pk=None):
        """Фрагменты документа с учётом политики доступа к решениям."""
        document = self.get_object()
        policy = RetrievalPolicy(mode=STUDENT_READ_MODE)
        rows = KnowledgeChunk.objects.filter(document=document)
        if not policy.allows_solutions:
            rows = rows.exclude(
                solution_visibility=KnowledgeChunk.SolutionVisibility.RESTRICTED
            )
        return Response(KnowledgeChunkSerializer(rows, many=True).data)


class CoursePlanViewSet(_UserScopedViewSet):
    """Программы курса: генерация, просмотр, подтверждение."""

    def get_queryset(self):
        email = self._user_email()
        if not email:
            return CoursePlan.objects.none()
        return CoursePlan.objects.filter(user_email=email).prefetch_related(
            "modules__topics__dependencies__depends_on",
            "modules__topics__source_bindings",
            "milestones",
        )

    def get_serializer_class(self):
        if self.action == "list":
            return CoursePlanListSerializer
        return CoursePlanSerializer

    # План создаётся только через `generate`: собрать его POST'ом руками нельзя,
    # иначе в БД появится курс, не прошедший валидатор.
    def create(self, request, *args, **kwargs):
        return Response(
            {
                "error": "План создаётся только через /generate/.",
                "code": "use_generate",
            },
            status=status.HTTP_405_METHOD_NOT_ALLOWED,
        )

    @action(detail=False, methods=["post"])
    def generate(self, request):
        email = self._user_email()
        if not email:
            return _no_user()

        payload = GeneratePlanSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        goal = LearningGoal.objects.filter(
            pk=payload.validated_data["goal_id"], user_email=email
        ).first()
        document = Document.objects.filter(
            pk=payload.validated_data["document_id"], user_email=email
        ).first()
        if goal is None or document is None:
            return Response(
                {"error": "Цель или документ не найдены.", "code": "not_found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        try:
            outcome = plans_service.generate_plan(goal, document)
        except plans_service.PlanRejected as exc:
            return Response(
                {
                    "error": exc.message,
                    "code": "plan_rejected",
                    "issues": _issues_payload(exc.report),
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        return Response(
            {
                "plan": CoursePlanSerializer(outcome.plan).data,
                "warnings": outcome.warnings,
                "review_findings": outcome.review_findings,
                "planner_model": outcome.planner_model,
                "reviewer_model": outcome.reviewer_model,
                "coverage_ratio": (
                    outcome.report.coverage_ratio if outcome.report else None
                ),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def approve(self, request, pk=None):
        plan = self.get_object()
        try:
            enrollment = plans_service.approve_plan(
                plan, user_email=self._user_email()
            )
        except PermissionError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_403_FORBIDDEN)
        except ValueError as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        plan.refresh_from_db()
        return Response(
            {
                "plan": CoursePlanSerializer(plan).data,
                "enrollment": CourseEnrollmentSerializer(enrollment).data,
            }
        )

    @action(detail=True, methods=["get"])
    def versions(self, request, pk=None):
        plan = self.get_object()
        rows = plan.versions.all().order_by("-version")
        return Response(CoursePlanVersionSerializer(rows, many=True).data)

    @action(detail=True, methods=["get"])
    def study_order(self, request, pk=None):
        """Порядок изучения тем — топологическая сортировка на backend'е."""
        plan = self.get_object()
        return Response({"external_ids": plans_service.topics_in_study_order(plan)})


class CourseEnrollmentViewSet(viewsets.ReadOnlyModelViewSet):
    """Активные записи ученика на курсы."""

    serializer_class = CourseEnrollmentSerializer

    def get_queryset(self):
        email = getattr(self.request, "user_email", None)
        if not email:
            return CourseEnrollment.objects.none()
        return CourseEnrollment.objects.filter(user_email=email).select_related(
            "version"
        )


def _no_user():
    return Response(
        {
            "error": "Не передан заголовок X-User-Email.",
            "code": "user_required",
        },
        status=status.HTTP_401_UNAUTHORIZED,
    )


def _issues_payload(report) -> list[dict]:
    if report is None:
        return []
    return [
        {
            "code": issue.code,
            "message": issue.message,
            "severity": issue.severity,
            "topic_external_id": issue.topic_external_id,
        }
        for issue in report.issues
    ]

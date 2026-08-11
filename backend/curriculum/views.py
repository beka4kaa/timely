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

from django.http import Http404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from . import progress
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
    SubjectChat,
)
from .retrieval import RetrievalPolicy
from .chat_title import generate_chat_title
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
    IngestionAttemptSerializer,
    IngestionJobSerializer,
    KnowledgeChunkSerializer,
    LearningGoalSerializer,
    PlanPaceSerializer,
    PlanStructureSerializer,
    SubjectChatListSerializer,
    SubjectChatSerializer,
)
from .services import dispatch
from .services import goals as goals_service
from .services import plans as plans_service
from .services import search as search_service
from .services.dispatch import enqueue_ingestion
from .upload_validation import UploadRejected, validate_upload_stream

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

    def perform_destroy(self, instance):
        # Не `instance.delete()`: каскад упирается в `PROTECT` у версии, по
        # которой ученик занимается, и отвечает 500 на собственную кнопку
        # удаления. Подробности — в `services.plans.delete_goal`.
        plans_service.delete_goal(instance)

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
    """Документы ученика: загрузка PDF/EPUB и обработка."""

    serializer_class = DocumentSerializer

    def get_queryset(self):
        email = self._user_email()
        if not email:
            return Document.objects.none()
        queryset = Document.objects.filter(user_email=email).select_related("file")
        # Каталог спрашивает книги одного предмета. Фильтр по `goal` безопасен
        # без дополнительной проверки владельца: выборка уже сужена до книг
        # этого ученика, и чужая цель просто ничего не найдёт.
        goal_id = (self.request.query_params.get("goal") or "").strip()
        if goal_id:
            queryset = queryset.filter(goal_id=goal_id)
        return queryset

    def perform_create(self, serializer):
        serializer.save(user_email=self._user_email())

    # multipart объявлен ТОЧЕЧНО на upload, а не на классе. На классе он отбирал
    # JSON у остальных actions: `PATCH`/`PUT` по документу отвечали 415, потому что
    # сериализатор читает `request.data`. Django test client content-type не ставит,
    # поэтому старые тесты этого не видели.
    #
    # `ingest` при этом не страдал: он не читает `request.data`, а парсеры DRF
    # ленивые. Но фронтенд (`src/lib/auth-fetch.ts`) ставит
    # `Content-Type: application/json` на КАЖДЫЙ запрос, так что стоит любому action
    # обратиться к `request.data` — он тут же начнёт отвечать 415.
    @action(
        detail=False,
        methods=["post"],
        parser_classes=[MultiPartParser, FormParser],
    )
    def upload(self, request):
        """Принимает PDF/EPUB: валидация содержимого → storage → Document."""
        email = self._user_email()
        if not email:
            return _no_user()

        payload = DocumentUploadSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        upload = payload.validated_data["file"]

        # Предмет проверяется по владельцу, а не просто по существованию:
        # иначе ученик привязал бы свою книгу к чужой цели и увидел бы её
        # название в каталоге.
        goal = None
        goal_id = payload.validated_data.get("goal_id")
        if goal_id:
            goal = LearningGoal.objects.filter(pk=goal_id, user_email=email).first()
            if goal is None:
                return Response(
                    {"error": "Предмет не найден.", "code": "goal_not_found"},
                    status=status.HTTP_404_NOT_FOUND,
                )

        try:
            # Формат определяется по содержимому: расширение приходит от
            # пользователя, и `книга.pdf` с ZIP внутри — обычное дело.
            validated = validate_upload_stream(
                stream=upload,
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
            goal=goal,
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
            store.save_stream(key, upload)
        except storage_module.StorageError as exc:
            document.delete()
            return Response(
                {"error": str(exc), "code": "storage_error"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
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
        except Exception:
            # Storage и БД — разные системы, общей транзакции у них нет.
            # Если метаданные не записались, не оставляем бесхозный объект.
            try:
                store.delete(key)
            finally:
                document.delete()
            raise

        return Response(
            {
                "document": DocumentSerializer(document).data,
                "warnings": list(validated.warnings),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def ingest(self, request, pk=None):
        """Ставит документ в обработку и отвечает 202.

        Контракт асинхронный независимо от того, чем обработка выполняется
        сегодня: прогресс забирается опросом `GET .../status/`. Так фронтенд не
        придётся переписывать, когда пайплайн уедет в Celery.

        Провал обработки — это НЕ ошибка постановки: 202 отдаётся и в этом случае,
        а причина приезжает в `job.error_code` при первом же опросе статуса.
        """
        document = self.get_object()
        job = enqueue_ingestion(document)
        document.refresh_from_db()
        job.refresh_from_db()
        return Response(
            {
                "document": DocumentSerializer(document).data,
                "job": IngestionJobSerializer(job).data,
                "poll_url": f"/api/curriculum/documents/{document.pk}/status/",
            },
            status=status.HTTP_202_ACCEPTED,
        )

    # url_path задан явно: метод нельзя назвать `status`, иначе он затенит
    # одноимённый импорт `rest_framework.status` в теле класса.
    @action(detail=True, methods=["get"], url_path="status")
    def ingestion_status(self, request, pk=None):
        """Текущее состояние обработки. Дёргается опросом раз в несколько секунд.

        Счётчики считаются запросами COUNT по одному документу — это дёшево и
        честнее, чем кешировать их в документе и разъезжаться с реальностью.
        """
        document = self.get_object()
        job = (
            IngestionJob.objects.filter(document=document)
            .order_by("-created_at")
            .first()
        )
        # Зависший джоб — это мёртвый процесс, а не «идёт работа». Признак
        # считает существующий `dispatch.is_stale` (одна реализация на проект),
        # а `describe` переводит его в терминальный статус для интерфейса.
        # Без этого фронтенд опрашивает статус бесконечно: ровно так пользователь
        # просидел двадцать минут со спиннером, пока воркера убивали по памяти.
        stale = bool(
            job
            and (
                dispatch.is_stale(job)
                or job.error_code == progress.STALLED_ERROR_CODE
            )
        )
        if stale and job and job.error_code != progress.STALLED_ERROR_CODE:
            # Закрываем обычную гонку SELECT ↔ heartbeat: перед терминальным
            # ответом перечитываем обе строки и ещё раз проверяем свежесть.
            job.refresh_from_db()
            document.refresh_from_db(fields=["ingestion_status"])
            stale = (
                dispatch.is_stale(job)
                or job.error_code == progress.STALLED_ERROR_CODE
            )
        body = dict(progress.describe(document.ingestion_status, stale=stale))
        body["document_id"] = str(document.pk)
        serialized_job = IngestionJobSerializer(job).data if job else None
        if stale and serialized_job:
            # GET остаётся read-only: живой воркер мог обновиться между SELECT и
            # ответом. Для клиента при этом контракт согласован — и верхний
            # статус, и вложенный job терминальны, поэтому polling остановится.
            serialized_job = dict(serialized_job)
            serialized_job.update(
                status=Document.Status.FAILED,
                error_code=progress.STALLED_ERROR_CODE,
                error_message=progress.STALLED_MESSAGE,
            )
        body["job"] = serialized_job
        body["attempts"] = (
            IngestionAttemptSerializer(
                job.attempts.all().order_by("created_at"), many=True
            ).data
            if job
            else []
        )
        body["warnings"] = list(job.warnings) if job else []
        body["stats"] = {
            "pages": document.pages.count(),
            "sections": document.sections.count(),
            "blocks": document.blocks.count(),
            "tasks": document.tasks.count(),
            # Обратной связи `document.chunks` больше нет: чанки в другой
            # базе. Считаем явным запросом.
            "chunks": KnowledgeChunk.objects.filter(document_id=document.pk).count(),
        }
        return Response(body)

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
        rows = KnowledgeChunk.objects.filter(document_id=document.pk)
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
        queryset = CoursePlan.objects.filter(user_email=email)
        goal_id = (self.request.query_params.get("goal") or "").strip()
        if goal_id:
            queryset = queryset.filter(goal_id=goal_id)
        if self.action == "list" and self.request.query_params.get("archived") != "1":
            # Архивная программа — это вытесненная перестройкой предыдущая
            # версия. В каталоге она была бы шумом: ученик видел бы две записи
            # по одной книге и не понимал, какая из них действующая. По прямой
            # ссылке она остаётся доступной, а `?archived=1` возвращает её и в
            # список — история никуда не девается.
            queryset = queryset.exclude(status=CoursePlan.Status.ARCHIVED)
        if self.action == "list":
            # Списку модули и темы не нужны: `CoursePlanListSerializer` их не
            # читает. Каталог показывает у ученика все планы сразу, и тянуть под
            # каждый из них дерево тем с зависимостями и провенансом означало бы
            # платить за данные, которые тут же выбрасываются.
            return queryset
        return queryset.prefetch_related(
            "modules__topics__dependencies__depends_on",
            "modules__topics__source_bindings",
            "milestones",
        )

    def get_serializer_class(self):
        if self.action == "list":
            return CoursePlanListSerializer
        return CoursePlanSerializer

    def perform_destroy(self, instance):
        # См. `LearningGoalViewSet.perform_destroy`: запись о занятиях защищает
        # версию плана, и обычный каскад на ней падает.
        plans_service.delete_plan(instance)

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

        coverage = plans_service.provenance_coverage(outcome.plan)
        return Response(
            {
                "plan": CoursePlanSerializer(outcome.plan).data,
                "warnings": outcome.warnings,
                "review_findings": outcome.review_findings,
                "planner_model": outcome.planner_model,
                "reviewer_model": outcome.reviewer_model,
                "coverage_ratio": coverage.ratio,
                "provenance_coverage": coverage.to_payload(),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def rebuild(self, request, pk=None):
        """Строит программу заново по той же книге, прежнюю — в архив."""
        plan = self.get_object()
        try:
            outcome = plans_service.rebuild_plan(plan)
        except plans_service.PlanRejected as exc:
            return Response(
                {
                    "error": exc.message,
                    "code": "plan_rejected",
                    "issues": _issues_payload(exc.report),
                },
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )

        coverage = plans_service.provenance_coverage(outcome.plan)
        return Response(
            {
                "plan": CoursePlanSerializer(outcome.plan).data,
                "warnings": outcome.warnings,
                "review_findings": outcome.review_findings,
                "coverage_ratio": coverage.ratio,
                "provenance_coverage": coverage.to_payload(),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["patch"], url_path="pace")
    def pace(self, request, pk=None):
        """Меняет темп и срок. Модель не вызывается — считается только прогноз."""
        plan = self.get_object()
        payload = PlanPaceSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        warnings = plans_service.repace_plan(
            plan,
            sessions_per_week=data.get("sessions_per_week"),
            minutes_per_session=data.get("minutes_per_session"),
            desired_finish_date=(
                data["desired_finish_date"]
                if "desired_finish_date" in data
                else plans_service.UNSET
            ),
        )
        return Response(
            {"plan": CoursePlanSerializer(plan).data, "warnings": warnings}
        )

    @action(detail=True, methods=["put"], url_path="structure")
    def structure(self, request, pk=None):
        """Заменяет состав программы присланным деревом."""
        plan = self.get_object()
        payload = PlanStructureSerializer(data=request.data)
        payload.is_valid(raise_exception=True)

        try:
            warnings = plans_service.apply_structure(
                plan, payload.validated_data["modules"]
            )
        except plans_service.PlanNotEditable as exc:
            return Response(
                {"error": str(exc), "code": "plan_not_editable"},
                status=status.HTTP_409_CONFLICT,
            )
        except ValueError as exc:
            return Response(
                {"error": str(exc), "code": "invalid_structure"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        return Response(
            {"plan": CoursePlanSerializer(plan).data, "warnings": warnings}
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


class SubjectChatViewSet(viewsets.ModelViewSet):
    """Чаты внутри предмета: папка — предмет, разговоры — внутри.

    Изоляция по `user_email`, как у соседних вьюсетов раздела. Предмет
    проверяется отдельно при создании: без этого чат можно было бы завести в
    чужой цели, просто подставив её идентификатор.
    """

    def get_serializer_class(self):
        return (
            SubjectChatListSerializer
            if self.action == "list"
            else SubjectChatSerializer
        )

    def get_queryset(self):
        email = getattr(self.request, "user_email", None)
        if not email:
            return SubjectChat.objects.none()
        queryset = SubjectChat.objects.filter(user_email=email)
        goal_id = self.request.query_params.get("goal")
        if goal_id == "none":
            # Разговоры без книги. Отдельным словом, а не пустым `?goal=`:
            # пустой параметр приходит сам собой, когда предмет ещё не выбран,
            # и означал бы «все чаты», а не «чаты без предмета».
            queryset = queryset.filter(goal__isnull=True)
        elif goal_id:
            queryset = queryset.filter(goal_id=goal_id)
        return queryset

    def perform_create(self, serializer):
        email = getattr(self.request, "user_email", None)
        goal = serializer.validated_data.get("goal")
        # Предмета может не быть — это разговор без книги. А вот чужой предмет
        # по-прежнему не существует.
        if goal is not None and goal.user_email != email:
            # 404, а не 403: чужой предмет не должен подтверждать, что он есть.
            raise Http404("Предмет не найден.")
        serializer.save(user_email=email)

    @action(detail=True, methods=["post"])
    def title(self, request, pk=None):
        """Придумывает чату короткое название по началу разговора.

        Отдельным запросом, а не внутри потока ответа: иначе ученик ждал бы ещё
        и заголовок, которого в этот момент не видит.
        """
        chat = self.get_object()
        generated = generate_chat_title(chat.messages)
        if not generated:
            return Response(
                {"error": "Не удалось придумать название.", "title": chat.title},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        chat.title = generated[:200]
        chat.save(update_fields=["title", "updated_at"])
        return Response({"title": chat.title})


class KnowledgeSearchView(APIView):
    """POST /api/curriculum/search/ — поиск по книгам пользователя.

    Режим фиксирован `STUDENT_READ_MODE`: выбирать себе политику доступа
    клиент не может, иначе «режим» превратился бы в параметр обхода правила о
    решениях задач.

    Векторы в ответе не возвращаются никогда: это внутреннее представление,
    наружу оно не нужно и весит в разы больше самого фрагмента.
    """

    def post(self, request):
        email = getattr(request, "user_email", None)
        if not email:
            return _no_user()

        query = str(request.data.get("query") or "").strip()
        if not query:
            return Response(
                {"error": "Запрос пустой.", "code": "query_required"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        raw_ids = request.data.get("document_ids") or []
        document_ids = [str(value) for value in raw_ids] if isinstance(raw_ids, list) else []

        bundle = search_service.search_chunks(
            search_service.SearchRequest(
                user_email=email,
                query=query,
                document_ids=document_ids,
                limit=search_service.clamp_limit(request.data.get("limit")),
                mode=STUDENT_READ_MODE,
            )
        )
        return Response({"query": query, **search_service.bundle_to_payload(bundle)})


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

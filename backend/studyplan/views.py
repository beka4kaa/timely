"""HTTP-слой расписания.

Стиль взят у `curriculum.views`: изоляция через `request.user_email`, действия
через `@action`, структурные ошибки вместо исключений наружу. Каждый URL — со
слешем на конце: у проекта `APPEND_SLASH = False`, и без слеша DRF-роутер
ответит 404.
"""

from __future__ import annotations

import logging
from datetime import datetime, time

from django.utils.dateparse import parse_date, parse_datetime
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from curriculum.models import CoursePlan

from . import revisions as revisions_service
from . import services
from . import setup as setup_service
from .models import (
    FixedCommitment,
    LearningBlock,
    ScheduleRevision,
    StudySchedule,
    WeeklyScheduleTemplate,
)
from .serializers import (
    BlockPatchSerializer,
    FixedCommitmentSerializer,
    GenerateScheduleSerializer,
    LearningBlockSerializer,
    ProposeMovesSerializer,
    ScheduleRevisionSerializer,
    StudyScheduleListSerializer,
    StudyScheduleSerializer,
    TemplateSlotSerializer,
    WeeklyScheduleTemplateSerializer,
)
from .scheduling.slots import local_to_utc, resolve_zone

logger = logging.getLogger(__name__)

# Потолок на пакетную отмену: выделение рамкой не должно превращаться в
# «отменить весь семестр» одним промахом мыши.
MAX_BULK_BLOCKS = 200

# Что отменить уже нельзя. Выполненное и идущее — это история и текущая работа,
# а отменённое отменять второй раз незачем.
_UNCANCELLABLE = frozenset(
    {
        LearningBlock.Status.COMPLETED,
        LearningBlock.Status.PARTIALLY_COMPLETED,
        LearningBlock.Status.IN_PROGRESS,
        LearningBlock.Status.CANCELLED,
    }
)


def _no_user() -> Response:
    return Response(
        {"error": "Не определён пользователь."}, status=status.HTTP_400_BAD_REQUEST
    )


def _error(message: str, code: str = "invalid") -> Response:
    return Response(
        {"error": message, "code": code}, status=status.HTTP_400_BAD_REQUEST
    )


def _setup_error(message: str, code: str, *, blocked: bool = False) -> Response:
    return Response(
        {
            "type": "schedule_setup",
            "status": "blocked" if blocked else "error",
            "error": message,
            "code": code,
        },
        status=status.HTTP_409_CONFLICT if blocked else status.HTTP_400_BAD_REQUEST,
    )


class ScheduleSetupView(APIView):
    """One-question-at-a-time setup for an initial proposed schedule."""

    def post(self, request):
        email = getattr(request, "user_email", None)
        if not email:
            return _setup_error("Не определён пользователь.", "no_user")

        request_type = request.data.get("type") if isinstance(request.data, dict) else None
        try:
            if request_type == "schedule_setup":
                return Response(
                    setup_service.handle_schedule_setup(
                        request.data, user_email=email
                    )
                )
            if request_type == "confirm_schedule_setup":
                result = setup_service.confirm_schedule_setup(
                    request.data, user_email=email
                )
                return Response(
                    {
                        "type": "schedule_setup",
                        "status": "created",
                        "session_id": str(request.data.get("session_id") or ""),
                        "answers": result.answers,
                        "summary": result.summary,
                        "schedule": StudyScheduleSerializer(result.schedule).data,
                        "feasible": result.feasible,
                        "warnings": list(result.warnings),
                        "blocks_created": result.blocks_created,
                    },
                    status=(
                        status.HTTP_201_CREATED
                        if result.created_new
                        else status.HTTP_200_OK
                    ),
                )
            return _setup_error(
                "Неизвестный тип запроса настройки.", "invalid_setup_type"
            )
        except setup_service.ScheduleSetupBlocked as exc:
            return _setup_error(str(exc), exc.code, blocked=True)
        except setup_service.ScheduleSetupValidationError as exc:
            return _setup_error(str(exc), exc.code)
        except services.ScheduleGenerationError as exc:
            return _setup_error(str(exc), "cannot_generate")


def _boundary_in_timezone(raw: str | None, timezone_name: str) -> datetime | None:
    """Граница диапазона из query-параметра в момент времени с зоной.

    Наивную дату нельзя отдавать в фильтр как есть: при `USE_TZ = True` Django
    предупреждает и сравнивает не с тем, что имел в виду вызывающий. Голая дата
    здесь означает локальную полночь ученика.
    """
    if not raw:
        return None

    moment = parse_datetime(raw)
    if moment is not None:
        return (
            moment
            if moment.tzinfo
            else moment.replace(tzinfo=resolve_zone(timezone_name))
        )

    day = parse_date(raw)
    if day is None:
        raise ValueError(raw)
    local, _ = local_to_utc(day, time(0, 0), resolve_zone(timezone_name))
    return local


def _boundary(raw: str | None, schedule) -> datetime | None:
    return _boundary_in_timezone(raw, schedule.timezone)


class _UserScopedViewSet(viewsets.ModelViewSet):
    """Всё ограничено текущим пользователем. Чужие строки не видны и не ищутся."""

    def _user_email(self) -> str | None:
        return getattr(self.request, "user_email", None)

    def create(self, request, *args, **kwargs):
        if not self._user_email():
            return _no_user()
        return super().create(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(user_email=self._user_email())


class WeeklyScheduleTemplateViewSet(_UserScopedViewSet):
    """Недельный ритм ученика."""

    serializer_class = WeeklyScheduleTemplateSerializer

    def get_queryset(self):
        email = self._user_email()
        if not email:
            return WeeklyScheduleTemplate.objects.none()
        return WeeklyScheduleTemplate.objects.filter(user_email=email).prefetch_related(
            "slots"
        )

    def _fresh(self, template: WeeklyScheduleTemplate) -> WeeklyScheduleTemplate:
        """Перечитать шаблон после правки его окон.

        `get_object()` приходит из queryset'а с `prefetch_related("slots")`, и
        кеш этой выборки заполнен ДО изменения. Без перечитывания ответ показал
        бы состояние окон на момент открытия объекта, а не после правки, —
        только что добавленное окно не появилось бы в ответе.
        """
        return (
            WeeklyScheduleTemplate.objects.prefetch_related("slots").get(pk=template.pk)
        )

    @action(detail=True, methods=["post"])
    def slots(self, request, pk=None):
        """Добавить окно в ритм."""
        template = self.get_object()
        payload = TemplateSlotSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        payload.save(template=template)
        return Response(
            self.get_serializer(self._fresh(template)).data,
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["delete"], url_path=r"slots/(?P<slot_id>[^/.]+)")
    def delete_slot(self, request, pk=None, slot_id=None):
        template = self.get_object()
        deleted, _ = template.slots.filter(pk=slot_id).delete()
        if not deleted:
            return _error("Такого окна нет в этом ритме.", code="slot_not_found")
        return Response(self.get_serializer(self._fresh(template)).data)


class FixedCommitmentViewSet(_UserScopedViewSet):
    """Занятое время: школа, репетитор, экзамен, семейные дела.

    Заполняется вручную или разбором фразы ученика в чате (`source="chat"`).
    """

    serializer_class = FixedCommitmentSerializer

    def get_queryset(self):
        email = self._user_email()
        if not email:
            return FixedCommitment.objects.none()
        return FixedCommitment.objects.filter(user_email=email)


class StudyScheduleViewSet(viewsets.ReadOnlyModelViewSet):
    """Расписания ученика. Создаются только через `generate/`."""

    serializer_class = StudyScheduleSerializer

    def _user_email(self) -> str | None:
        return getattr(self.request, "user_email", None)

    def get_queryset(self):
        email = self._user_email()
        if not email:
            return StudySchedule.objects.none()
        queryset = StudySchedule.objects.filter(user_email=email)
        course_plan = self.request.query_params.get("course_plan")
        if course_plan:
            queryset = queryset.filter(course_plan_id=course_plan)
        return queryset

    def get_serializer_class(self):
        if self.action == "list":
            return StudyScheduleListSerializer
        return StudyScheduleSerializer

    @action(detail=False, methods=["post"])
    def generate(self, request):
        """Построить календарь по программе."""
        email = self._user_email()
        if not email:
            return _no_user()

        payload = GenerateScheduleSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        plan = CoursePlan.objects.filter(
            pk=data["course_plan"], user_email=email
        ).first()
        if plan is None:
            return _error("Программа не найдена.", code="plan_not_found")

        template = None
        if data.get("template"):
            template = WeeklyScheduleTemplate.objects.filter(
                pk=data["template"], user_email=email
            ).first()
            if template is None:
                return _error("Ритм не найден.", code="template_not_found")

        kwargs = {}
        if "buffer_percentage" in data:
            kwargs["buffer_percentage"] = data["buffer_percentage"]

        try:
            outcome = services.generate_schedule(
                plan=plan,
                start_date=data["start_date"],
                end_date=data.get("end_date"),
                timezone_name=data.get("timezone") or "UTC",
                template=template,
                **kwargs,
            )
        except services.ScheduleGenerationError as exc:
            return _error(str(exc), code="cannot_generate")

        return Response(
            {
                "schedule": StudyScheduleSerializer(outcome.schedule).data,
                "feasible": outcome.feasible,
                "warnings": list(outcome.warnings),
                "blocks_created": len(outcome.blocks),
            },
            status=status.HTTP_201_CREATED,
        )

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        """Ученик принял календарь: он становится активным."""
        schedule = self.get_object()
        try:
            services.confirm_schedule(schedule)
        except services.ScheduleNotConfirmable as exc:
            return _error(str(exc), code="not_confirmable")
        schedule.refresh_from_db()
        return Response(StudyScheduleSerializer(schedule).data)

    @action(detail=True, methods=["get"])
    def blocks(self, request, pk=None):
        """Блоки расписания. Диапазон сужает выборку для недельного вида.

        `from` и `to` принимают и дату, и полный момент времени. Голая дата
        читается как ЛОКАЛЬНАЯ полночь в зоне расписания: недельный вид
        спрашивает «неделю ученика», а не «неделю по Гринвичу».
        """
        schedule = self.get_object()
        queryset = schedule.blocks.select_related("schedule", "course_plan")

        try:
            start = _boundary(request.query_params.get("from"), schedule)
            end = _boundary(request.query_params.get("to"), schedule)
        except ValueError:
            return _error("Границы диапазона нужно задавать датой.", code="bad_range")

        if start is not None:
            queryset = queryset.filter(start_at__gte=start)
        if end is not None:
            queryset = queryset.filter(start_at__lt=end)

        return Response(LearningBlockSerializer(queryset, many=True).data)

    @action(detail=True, methods=["get", "post"], url_path="revisions")
    def revisions(self, request, pk=None):
        """Список ревизий или предложение нового изменения."""
        schedule = self.get_object()

        if request.method == "GET":
            return Response(
                ScheduleRevisionSerializer(
                    schedule.revisions.all(), many=True
                ).data
            )

        payload = ProposeMovesSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        if (
            data.get("base_version") is not None
            and data["base_version"] != schedule.version
        ):
            return _error(
                "Расписание изменилось — обнови календарь и повтори.",
                code="stale_version",
            )

        moves = [
            revisions_service.BlockMove(
                block_id=str(item["block_id"]),
                start_at=item["start_at"],
                duration_minutes=item.get("duration_minutes"),
            )
            for item in data["moves"]
        ]
        try:
            revision = revisions_service.propose_moves(
                schedule,
                moves=moves,
                request_text=data.get("request_text", ""),
                reason=data.get("reason", ""),
            )
        except revisions_service.RevisionRejected as exc:
            return _error(str(exc), code="revision_rejected")

        return Response(
            ScheduleRevisionSerializer(revision).data, status=status.HTTP_201_CREATED
        )


class LearningBlockViewSet(viewsets.ReadOnlyModelViewSet):
    """Блоки календаря. Изменение времени идёт через ревизию, а не PATCH'ем полей."""

    serializer_class = LearningBlockSerializer

    def _user_email(self) -> str | None:
        return getattr(self.request, "user_email", None)

    def get_queryset(self):
        email = self._user_email()
        if not email:
            return LearningBlock.objects.none()
        queryset = LearningBlock.objects.filter(user_email=email).select_related(
            "schedule", "course_plan"
        )
        schedule = self.request.query_params.get("schedule")
        if schedule:
            queryset = queryset.filter(schedule_id=schedule)
        elif self.action == "list":
            # Общий календарь: одна текущая версия каждого курса. Архив и
            # завершённые расписания доступны через их detail endpoint, но не
            # смешиваются с рабочей недельной сеткой.
            queryset = queryset.filter(
                schedule__in=services.calendar_schedules(email)
            )

        if self.action != "list":
            return queryset

        timezone_name = self.request.query_params.get("timezone") or "UTC"
        start = _boundary_in_timezone(
            self.request.query_params.get("from"), timezone_name
        )
        end = _boundary_in_timezone(
            self.request.query_params.get("to"), timezone_name
        )
        if start is not None and end is not None and start >= end:
            raise ValueError("range")
        # Пересечение с полуоткрытым [from, to): начавшийся раньше длинный
        # блок всё равно должен быть виден, а соседний ровно на границе — нет.
        if start is not None:
            queryset = queryset.filter(end_at__gt=start)
        if end is not None:
            queryset = queryset.filter(start_at__lt=end)
        return queryset

    def list(self, request, *args, **kwargs):
        try:
            return super().list(request, *args, **kwargs)
        except ValueError:
            return _error(
                "Границы диапазона нужно задать корректными датами, from раньше to.",
                code="bad_range",
            )

    def partial_update(self, request, pk=None):
        """Ручной перенос блока — перетаскивание в календаре.

        Изменение всё равно проходит через ревизию: проверки конфликтов,
        закреплённости и порядка тем одни и те же независимо от того, кто
        двигает блок — ученик мышью или AI по просьбе. Разница лишь в том, что
        жест ученика подтверждает изменение сразу, а предложение AI ждёт
        согласия. Undo доступен в обоих случаях по `revision`.
        """
        block = self.get_object()
        payload = BlockPatchSerializer(data=request.data)
        payload.is_valid(raise_exception=True)
        data = payload.validated_data

        schedule = block.schedule
        if (
            data.get("base_version") is not None
            and data["base_version"] != schedule.version
        ):
            return _error(
                "Расписание изменилось — обнови календарь и повтори.",
                code="stale_version",
            )

        move = revisions_service.BlockMove(
            block_id=str(block.id),
            start_at=data["start_at"],
            duration_minutes=data.get("duration_minutes"),
        )
        try:
            revision = revisions_service.propose_moves(
                schedule,
                moves=[move],
                reason="Ручной перенос в календаре",
            )
            revisions_service.confirm_revision(revision)
        except revisions_service.RevisionRejected as exc:
            return _error(str(exc), code="revision_rejected")

        block.refresh_from_db()
        revision.refresh_from_db()
        return Response(
            {
                "block": LearningBlockSerializer(block).data,
                "revision": ScheduleRevisionSerializer(revision).data,
            }
        )

    # `PUT` не поддерживается намеренно: у блока нет состояния, которое имеет
    # смысл заменять целиком, а частичный перенос выражается PATCH'ем.
    def update(self, request, *args, **kwargs):
        return _error("Используй PATCH для переноса блока.", code="method_not_allowed")

    @action(detail=False, methods=["post"], url_path="cancel")
    def cancel(self, request):
        """Отменить или вернуть занятия пачкой.

        «Удалить» занятие из учебного плана нельзя: оно пришло из программы и
        останется её частью. Отменённое занятие не исчезает, а гаснет,
        зачёркивается и перестаёт занимать время — поэтому Delete именно
        отменяет, а не стирает, и поэтому же операция обратима.

        Пачкой, а не по одному: ученик выделяет рамкой несколько занятий, и
        семь запросов подряд означали бы семь шансов разъехаться на середине.
        """
        email = self._user_email()
        if not email:
            return _no_user()

        raw_ids = request.data.get("block_ids")
        if not isinstance(raw_ids, list) or not raw_ids:
            return _error("Не сказано, какие занятия отменять.", code="ids_required")
        if len(raw_ids) > MAX_BULK_BLOCKS:
            return _error("Слишком много занятий за раз.", code="too_many")

        restore = bool(request.data.get("restore"))
        target = (
            LearningBlock.Status.SCHEDULED if restore else LearningBlock.Status.CANCELLED
        )

        blocks = list(
            LearningBlock.objects.filter(user_email=email, pk__in=raw_ids)
        )
        changed: list[str] = []
        for block in blocks:
            # Закреплённое не трогаем: «это не двигается» относится и к отмене.
            # Выполненное тоже — стирать сделанное значит терять историю.
            if block.fixed:
                continue
            if not restore and block.status in _UNCANCELLABLE:
                continue
            if restore and block.status != LearningBlock.Status.CANCELLED:
                continue
            block.status = target
            block.save(update_fields=["status"])
            changed.append(str(block.id))

        return Response({"changed": changed, "restored": restore})

    @action(detail=False, methods=["post"], url_path="pin")
    def pin(self, request):
        """Закрепить занятия или снять закрепление.

        Закреплённое занятие планировщик не переносит, и вручную оно тоже не
        перетаскивается. Раньше признак ставил только генератор расписания, и
        снять его из интерфейса было нельзя — теперь это переключатель в
        карточке занятия.

        Занятое время (школа, репетитор) сюда не попадает: это отдельная
        сущность `FixedCommitment`, и её «закреплённость» — не поле, а смысл.
        """
        email = self._user_email()
        if not email:
            return _no_user()

        raw_ids = request.data.get("block_ids")
        if not isinstance(raw_ids, list) or not raw_ids:
            return _error("Не сказано, какие занятия закреплять.", code="ids_required")
        if len(raw_ids) > MAX_BULK_BLOCKS:
            return _error("Слишком много занятий за раз.", code="too_many")

        pinned = bool(request.data.get("pinned"))
        blocks = list(LearningBlock.objects.filter(user_email=email, pk__in=raw_ids))
        changed: list[str] = []
        for block in blocks:
            if block.fixed == pinned:
                continue
            block.fixed = pinned
            block.save(update_fields=["fixed"])
            changed.append(str(block.id))

        return Response({"changed": changed, "pinned": pinned})


class ScheduleRevisionViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = ScheduleRevisionSerializer

    def _user_email(self) -> str | None:
        return getattr(self.request, "user_email", None)

    def get_queryset(self):
        email = self._user_email()
        if not email:
            return ScheduleRevision.objects.none()
        return ScheduleRevision.objects.filter(user_email=email)

    def _act(self, action_fn, revision):
        try:
            action_fn(revision)
        except revisions_service.StaleRevision as exc:
            return _error(str(exc), code="stale_revision")
        except revisions_service.RevisionRejected as exc:
            return _error(str(exc), code="revision_rejected")
        revision.refresh_from_db()
        return Response(ScheduleRevisionSerializer(revision).data)

    @action(detail=True, methods=["post"])
    def confirm(self, request, pk=None):
        return self._act(revisions_service.confirm_revision, self.get_object())

    @action(detail=True, methods=["post"])
    def reject(self, request, pk=None):
        return self._act(revisions_service.reject_revision, self.get_object())

    @action(detail=True, methods=["post"])
    def undo(self, request, pk=None):
        return self._act(revisions_service.undo_revision, self.get_object())

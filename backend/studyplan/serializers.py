"""Сериализаторы расписания.

Поля отдаются в snake_case, как их называет модель, — та же конвенция, что в
`curriculum`: она снимает целый слой преобразований вместе с его ошибками.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import (
    ActivityType,
    FixedCommitment,
    LearningBlock,
    ScheduleRevision,
    StudySchedule,
    TemplateSlot,
    WeeklyScheduleTemplate,
)
from .scheduling.contracts import MIN_PART_MINUTES


class TemplateSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = TemplateSlot
        fields = [
            "id",
            "weekday",
            "start_time",
            "duration_minutes",
            "allowed_activity_types",
            "subject_id",
            "fixed",
            "priority",
        ]
        read_only_fields = ["id"]

    def validate_weekday(self, value):
        if not 0 <= value <= 6:
            raise serializers.ValidationError("День недели — от 0 (пн) до 6 (вс).")
        return value

    def validate_duration_minutes(self, value):
        if value < MIN_PART_MINUTES:
            raise serializers.ValidationError(
                f"Окно короче {MIN_PART_MINUTES} минут бесполезно."
            )
        return value

    def validate_allowed_activity_types(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError("Ожидался список типов занятий.")
        allowed = {choice.value for choice in ActivityType}
        unknown = [item for item in value if item not in allowed]
        if unknown:
            raise serializers.ValidationError(f"Неизвестные типы занятий: {unknown}.")
        return value


class WeeklyScheduleTemplateSerializer(serializers.ModelSerializer):
    slots = TemplateSlotSerializer(many=True, read_only=True)

    class Meta:
        model = WeeklyScheduleTemplate
        fields = [
            "id",
            "title",
            "timezone",
            "active",
            "valid_from",
            "valid_until",
            "max_minutes_per_day",
            "max_minutes_per_week",
            "slots",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class FixedCommitmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = FixedCommitment
        fields = [
            "id",
            "kind",
            "title",
            "weekday",
            "start_time",
            "duration_minutes",
            "valid_from",
            "valid_until",
            "start_at",
            "end_at",
            "source",
            "source_text",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def validate(self, attrs):
        # Взаимоисключение форм проверяет сама модель: правило одно, и второе
        # его описание рано или поздно разошлось бы с первым.
        instance = FixedCommitment(**{**self._existing(), **attrs})
        instance.clean()
        return attrs

    def _existing(self) -> dict:
        if self.instance is None:
            return {}
        return {
            field: getattr(self.instance, field)
            for field in (
                "kind",
                "title",
                "weekday",
                "start_time",
                "duration_minutes",
                "valid_from",
                "valid_until",
                "start_at",
                "end_at",
            )
        }


class LearningBlockSerializer(serializers.ModelSerializer):
    # Общему календарю не нужно отдельно загружать каждое расписание перед
    # drag-and-drop: версия и зона едут рядом с блоком, а название курса нужно
    # для подписи/цвета. Идентификаторы `schedule`/`course_plan` остаются
    # прежними, поэтому контракт обратно совместим.
    schedule_version = serializers.IntegerField(
        source="schedule.version", read_only=True
    )
    schedule_status = serializers.CharField(
        source="schedule.status", read_only=True
    )
    schedule_timezone = serializers.CharField(
        source="schedule.timezone", read_only=True
    )
    course_plan_title = serializers.CharField(
        source="course_plan.title", read_only=True
    )

    class Meta:
        model = LearningBlock
        fields = [
            "id",
            "schedule",
            "schedule_version",
            "schedule_status",
            "schedule_timezone",
            "course_plan",
            "course_plan_title",
            "module",
            "topic",
            "title",
            "objective",
            "activity_type",
            "workspace_type",
            "start_at",
            "end_at",
            "duration_minutes",
            "fixed",
            "priority",
            "status",
            "detail_level",
            "source",
            "lesson_payload",
            "mastery_criteria",
            "source_section_ids",
            "source_chunk_ids",
            "prerequisite_block_ids",
            "review_of_topic",
            "review_step",
            "version",
        ]
        read_only_fields = fields


class BlockMoveSerializer(serializers.Serializer):
    """Один перенос: куда и, если меняется, на сколько."""

    block_id = serializers.UUIDField()
    start_at = serializers.DateTimeField()
    duration_minutes = serializers.IntegerField(
        required=False, min_value=MIN_PART_MINUTES, max_value=480
    )


class ProposeMovesSerializer(serializers.Serializer):
    moves = BlockMoveSerializer(many=True)
    # Версия, от которой ученик строил изменение. Без неё две вкладки молча
    # затирали бы правки друг друга.
    base_version = serializers.IntegerField(required=False)
    request_text = serializers.CharField(required=False, allow_blank=True, default="")
    reason = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_moves(self, value):
        if not value:
            raise serializers.ValidationError("Не передано ни одного переноса.")
        seen = {str(item["block_id"]) for item in value}
        if len(seen) != len(value):
            raise serializers.ValidationError("Один блок переносится дважды.")
        return value


class BlockPatchSerializer(serializers.Serializer):
    """Ручной перенос одного блока — перетаскивание в календаре."""

    start_at = serializers.DateTimeField()
    duration_minutes = serializers.IntegerField(
        required=False, min_value=MIN_PART_MINUTES, max_value=480
    )
    base_version = serializers.IntegerField(required=False)


class ScheduleRevisionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScheduleRevision
        fields = [
            "id",
            "schedule",
            "base_version",
            "proposed_version",
            "requested_by",
            "request_text",
            "reason",
            "status",
            "diff",
            "impact",
            "created_at",
            "confirmed_at",
            "reverted_at",
        ]
        read_only_fields = fields


class StudyScheduleSerializer(serializers.ModelSerializer):
    feasible = serializers.BooleanField(read_only=True)
    setup_restartable = serializers.BooleanField(read_only=True)

    class Meta:
        model = StudySchedule
        fields = [
            "id",
            "course_plan",
            "template",
            "start_date",
            "end_date",
            "timezone",
            "status",
            "version",
            "generation_source",
            "scheduling_version",
            "pacing_snapshot",
            "conflict_report",
            "warnings",
            "feasible",
            "setup_restartable",
            "confirmed_at",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class StudyScheduleListSerializer(serializers.ModelSerializer):
    """Список БЕЗ снимка ритма: он весит килобайты, а в списке не показывается."""

    feasible = serializers.BooleanField(read_only=True)
    setup_restartable = serializers.BooleanField(read_only=True)

    class Meta:
        model = StudySchedule
        fields = [
            "id",
            "course_plan",
            "template",
            "start_date",
            "end_date",
            "timezone",
            "status",
            "version",
            "conflict_report",
            "warnings",
            "feasible",
            "setup_restartable",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class GenerateScheduleSerializer(serializers.Serializer):
    course_plan = serializers.UUIDField()
    start_date = serializers.DateField()
    end_date = serializers.DateField(required=False, allow_null=True)
    timezone = serializers.CharField(required=False, default="UTC", max_length=64)
    template = serializers.UUIDField(required=False, allow_null=True)
    buffer_percentage = serializers.FloatField(
        required=False, min_value=0.0, max_value=0.5
    )

    def validate(self, attrs):
        start = attrs.get("start_date")
        end = attrs.get("end_date")
        if start and end and end <= start:
            raise serializers.ValidationError("Конец горизонта должен быть позже начала.")
        return attrs

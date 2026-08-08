"""Сериализаторы curriculum.

Главное правило этого модуля: НИ ОДИН сериализатор не отдаёт решения задач.
`ExtractedSolution` здесь не представлен вообще, а чанки с
`solution_visibility="restricted"` отфильтровываются на уровне queryset.
Разделение задач и решений — требование безопасности (см. docstring
`models.ExtractedTask`), и API — последнее место, где его можно потерять.
"""

from __future__ import annotations

from rest_framework import serializers

from .models import (
    CourseEnrollment,
    CourseMilestone,
    CourseModule,
    CoursePlan,
    CoursePlanVersion,
    CourseTopic,
    Document,
    DocumentFile,
    DocumentSection,
    ExtractedTask,
    IngestionJob,
    KnowledgeChunk,
    LearningGoal,
)

# ─────────────────────────────── Цель ────────────────────────────────────────


class LearningGoalSerializer(serializers.ModelSerializer):
    class Meta:
        model = LearningGoal
        fields = [
            "id",
            "original_text",
            "normalized_subject",
            "normalized_direction",
            "normalization_confidence",
            "normalization_confirmed",
            "normalization_model",
            "normalization_prompt_version",
            "subject",
            "topic",
            "goal_type",
            "current_level",
            "target_level",
            "preferred_language",
            "source_language_preferences",
            "theory_practice_balance",
            "access_preference",
            "desired_finish_date",
            "status",
            "created_at",
            "updated_at",
        ]
        # Всё, что заполняет нормализация, правится только своими экшенами:
        # обычный PATCH не должен уметь подделать «модель это подтвердила».
        read_only_fields = [
            "id",
            "normalized_subject",
            "normalized_direction",
            "normalization_confidence",
            "normalization_confirmed",
            "normalization_model",
            "normalization_prompt_version",
            "subject",
            "topic",
            "status",
            "created_at",
            "updated_at",
        ]


class GoalConfirmSerializer(serializers.Serializer):
    """Правки ученика при подтверждении нормализации."""

    normalized_subject = serializers.CharField(
        max_length=160, required=False, allow_blank=False
    )
    normalized_direction = serializers.CharField(
        max_length=160, required=False, allow_blank=True
    )


# ────────────────────────────── Документ ─────────────────────────────────────


class DocumentFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentFile
        # storage_key намеренно не отдаётся: это внутренний адрес в хранилище.
        fields = [
            "original_filename",
            "sanitized_filename",
            "mime_type",
            "byte_size",
            "content_hash",
            "antivirus_status",
        ]
        read_only_fields = fields


class DocumentSerializer(serializers.ModelSerializer):
    file = DocumentFileSerializer(read_only=True)

    class Meta:
        model = Document
        fields = [
            "id",
            "title",
            "authors",
            "language",
            "document_type",
            "source_type",
            "page_count",
            "ingestion_status",
            "processing_version",
            "visibility",
            "copyright_declaration",
            "file",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "id",
            "page_count",
            "ingestion_status",
            "processing_version",
            "source_type",
            "file",
            "created_at",
            "updated_at",
        ]


class DocumentUploadSerializer(serializers.Serializer):
    """Загрузка PDF. Проверку содержимого делает `upload_validation`."""

    file = serializers.FileField()
    title = serializers.CharField(max_length=400, required=False, allow_blank=True)
    language = serializers.CharField(max_length=8, required=False)
    document_type = serializers.ChoiceField(
        choices=Document.DocType.choices, required=False
    )
    copyright_declaration = serializers.CharField(
        max_length=64, required=False, allow_blank=True
    )


class DocumentSectionSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocumentSection
        fields = ["id", "kind", "title", "path", "order_index", "start_page", "end_page"]
        read_only_fields = fields


class ExtractedTaskSerializer(serializers.ModelSerializer):
    """Только условие. Поля решения здесь нет и быть не должно."""

    class Meta:
        model = ExtractedTask
        fields = [
            "id",
            "number_label",
            "statement",
            "page_start",
            "page_end",
            "difficulty_hint",
        ]
        read_only_fields = fields


class KnowledgeChunkSerializer(serializers.ModelSerializer):
    class Meta:
        model = KnowledgeChunk
        fields = [
            "id",
            "chunk_type",
            "section_path",
            "page_start",
            "page_end",
            "normalized_text",
            "token_count",
        ]
        read_only_fields = fields


class IngestionJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = IngestionJob
        fields = [
            "id",
            "status",
            "processing_version",
            "retry_count",
            "error_code",
            "error_message",
            "started_at",
            "finished_at",
        ]
        read_only_fields = fields


# ──────────────────────────────── Курс ───────────────────────────────────────


class CourseTopicSerializer(serializers.ModelSerializer):
    prerequisites = serializers.SerializerMethodField()
    sources = serializers.SerializerMethodField()

    class Meta:
        model = CourseTopic
        fields = [
            "id",
            "external_id",
            "title",
            "objective",
            "order_index",
            "difficulty",
            "estimated_minutes",
            "suggested_lesson_count",
            "theory_practice_balance",
            "mastery_criteria",
            "review_strategy",
            "prerequisites",
            "sources",
        ]
        read_only_fields = fields

    def get_prerequisites(self, topic: CourseTopic) -> list[str]:
        return sorted(
            dependency.depends_on.external_id
            for dependency in topic.dependencies.all()
        )

    def get_sources(self, topic: CourseTopic) -> list[dict]:
        """Provenance темы. Строится backend'ом, модель сюда не допускается."""
        return [
            {
                "section_path": binding.section_path,
                "page_start": binding.page_start,
                "page_end": binding.page_end,
            }
            for binding in topic.source_bindings.all()
        ]


class CourseModuleSerializer(serializers.ModelSerializer):
    topics = CourseTopicSerializer(many=True, read_only=True)

    class Meta:
        model = CourseModule
        fields = [
            "id",
            "external_id",
            "title",
            "objective",
            "order_index",
            "estimated_minutes",
            "completion_criteria",
            "topics",
        ]
        read_only_fields = fields


class CourseMilestoneSerializer(serializers.ModelSerializer):
    class Meta:
        model = CourseMilestone
        fields = ["id", "title", "description", "order_index", "module"]
        read_only_fields = fields


class CoursePlanSerializer(serializers.ModelSerializer):
    modules = CourseModuleSerializer(many=True, read_only=True)
    milestones = CourseMilestoneSerializer(many=True, read_only=True)

    class Meta:
        model = CoursePlan
        fields = [
            "id",
            "goal",
            "document",
            "title",
            "objective",
            "current_level",
            "target_level",
            "language",
            "estimated_total_minutes",
            "recommended_sessions_per_week",
            "recommended_session_minutes",
            "forecast_finish_date",
            "forecast",
            "status",
            "generation_model",
            "reviewer_model",
            "generation_prompt_version",
            "review_prompt_version",
            "source_processing_version",
            "schema_version",
            "approved_at",
            "current_version",
            "modules",
            "milestones",
            "created_at",
            "updated_at",
        ]
        read_only_fields = fields


class CoursePlanListSerializer(serializers.ModelSerializer):
    """Компактная форма для списка: без модулей и тем."""

    class Meta:
        model = CoursePlan
        fields = [
            "id",
            "goal",
            "document",
            "title",
            "status",
            "estimated_total_minutes",
            "forecast_finish_date",
            "current_version",
            "created_at",
        ]
        read_only_fields = fields


class CoursePlanVersionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CoursePlanVersion
        fields = [
            "id",
            "version",
            "reason",
            "requested_by",
            "approved_by_student",
            "approved_at",
            "generation_model",
            "diff",
            "created_at",
        ]
        read_only_fields = fields


class CourseEnrollmentSerializer(serializers.ModelSerializer):
    version_number = serializers.IntegerField(source="version.version", read_only=True)

    class Meta:
        model = CourseEnrollment
        fields = ["id", "plan", "version_number", "started_at", "is_active"]
        read_only_fields = fields


class GeneratePlanSerializer(serializers.Serializer):
    goal_id = serializers.UUIDField()
    document_id = serializers.UUIDField()

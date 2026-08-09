"""Домен: изоляция пользователей, версионирование курса, каскадное удаление."""

from django.test import TestCase
from django.utils import timezone

from curriculum.model_registry import (
    ROLE_COURSE_PLANNING,
    ROLE_EMBEDDING,
    evaluation_candidates,
    registry_snapshot,
    resolve_model,
)
from curriculum.models import (
    CourseModule,
    CoursePlan,
    CoursePlanVersion,
    CourseTopic,
    Document,
    DocumentFile,
    DocumentPage,
    ExtractedSolution,
    ExtractedTask,
    KnowledgeChunk,
    LearningGoal,
)

OWNER = "student@timelyplan.me"
STRANGER = "other@timelyplan.me"


class LearningGoalTests(TestCase):
    def test_original_text_survives_normalization(self):
        goal = LearningGoal.objects.create(
            user_email=OWNER,
            original_text="хочу научится решать механику",
            normalized_subject="Физика",
            normalized_direction="Механика",
            normalization_confidence=0.82,
        )
        goal.refresh_from_db()
        # Формулировка ученика не переписывается результатом нормализации.
        self.assertEqual(goal.original_text, "хочу научится решать механику")
        self.assertEqual(goal.normalized_subject, "Физика")
        self.assertFalse(goal.normalization_confirmed)

    def test_goals_are_isolated_per_user(self):
        LearningGoal.objects.create(user_email=OWNER, original_text="Механика")
        LearningGoal.objects.create(user_email=STRANGER, original_text="Химия")

        mine = LearningGoal.objects.filter(user_email=OWNER)
        self.assertEqual(mine.count(), 1)
        self.assertEqual(mine.first().original_text, "Механика")

    def test_defaults_are_conservative(self):
        goal = LearningGoal.objects.create(user_email=OWNER, original_text="Python")
        self.assertEqual(goal.status, LearningGoal.Status.DRAFT)
        self.assertEqual(goal.preferred_language, "ru")
        self.assertFalse(goal.normalization_confirmed)


class DocumentTests(TestCase):
    def _document(self, owner=OWNER):
        return Document.objects.create(
            user_email=owner, title="Механика, 10 класс", page_count=120
        )

    def test_document_starts_unprocessed(self):
        document = self._document()
        self.assertEqual(document.ingestion_status, Document.Status.UPLOADED)
        self.assertEqual(document.visibility, Document.Visibility.PRIVATE)

    def test_file_metadata_holds_no_binary(self):
        document = self._document()
        file = DocumentFile.objects.create(
            document=document,
            original_filename="../evil.pdf",
            sanitized_filename="evil.pdf",
            storage_key="documents/abc/doc1/evil.pdf",
            mime_type="application/pdf",
            byte_size=1024,
            content_hash="a" * 64,
        )
        # В модели нет поля с содержимым файла — только ключ.
        self.assertFalse(hasattr(file, "data"))
        self.assertTrue(file.storage_key.startswith("documents/"))

    def test_delete_cascades_to_all_derived_data(self):
        document = self._document()
        page = DocumentPage.objects.create(document=document, page_number=1)
        task = ExtractedTask.objects.create(
            document=document, statement="Задача 1", page_start=1
        )
        ExtractedSolution.objects.create(
            task=task, document=document, body="Решение", page_start=200
        )
        KnowledgeChunk.objects.create(
            document_id=document.pk, normalized_text="Текст", content_hash="b" * 64
        )
        DocumentFile.objects.create(
            document=document,
            original_filename="a.pdf",
            sanitized_filename="a.pdf",
            storage_key="documents/x/y/a.pdf",
            mime_type="application/pdf",
            byte_size=10,
            content_hash="c" * 64,
        )

        document.delete()

        self.assertEqual(DocumentPage.objects.count(), 0)
        self.assertEqual(ExtractedTask.objects.count(), 0)
        self.assertEqual(ExtractedSolution.objects.count(), 0)
        self.assertEqual(KnowledgeChunk.objects.count(), 0)
        self.assertEqual(DocumentFile.objects.count(), 0)
        self.assertEqual(DocumentPage.objects.filter(pk=page.pk).count(), 0)


class TaskSolutionSeparationTests(TestCase):
    def test_task_and_solution_are_distinct_rows(self):
        document = Document.objects.create(user_email=OWNER, title="Задачник")
        task = ExtractedTask.objects.create(
            document=document, statement="Найдите ускорение.", page_start=10
        )
        solution = ExtractedSolution.objects.create(
            task=task, document=document, body="a = 2 м/с²", page_start=210
        )

        # Условие не содержит решения ни в одном поле.
        self.assertNotIn("2 м/с²", task.statement)
        self.assertEqual(solution.task_id, task.id)
        # Решения физически в другой таблице.
        self.assertNotEqual(
            ExtractedTask._meta.db_table, ExtractedSolution._meta.db_table
        )

    def test_solution_chunk_is_restricted_by_default_flag(self):
        document = Document.objects.create(user_email=OWNER, title="Задачник")
        chunk = KnowledgeChunk.objects.create(
            document_id=document.pk,
            chunk_type=KnowledgeChunk.ChunkType.SOLUTION,
            normalized_text="Решение",
            content_hash="d" * 64,
            solution_visibility=KnowledgeChunk.SolutionVisibility.RESTRICTED,
        )
        self.assertEqual(chunk.solution_visibility, "restricted")


class CoursePlanVersioningTests(TestCase):
    def _plan(self):
        goal = LearningGoal.objects.create(user_email=OWNER, original_text="Механика")
        return CoursePlan.objects.create(
            user_email=OWNER, goal=goal, title="Курс механики"
        )

    def test_approved_version_snapshot_is_not_mutated_by_new_version(self):
        plan = self._plan()
        first = CoursePlanVersion.objects.create(
            plan=plan,
            version=1,
            snapshot={"topics": ["Скорость"]},
            approved_by_student=True,
            approved_at=timezone.now(),
        )

        # Изменение курса создаёт НОВУЮ версию, а не правит подтверждённую.
        CoursePlanVersion.objects.create(
            plan=plan,
            version=2,
            snapshot={"topics": ["Скорость", "Ускорение"]},
            diff={"added_topics": ["Ускорение"]},
            reason="Ученик попросил добавить тему",
        )

        first.refresh_from_db()
        self.assertEqual(first.snapshot, {"topics": ["Скорость"]})
        self.assertTrue(first.approved_by_student)
        self.assertEqual(plan.versions.count(), 2)

    def test_version_numbers_are_unique_per_plan(self):
        plan = self._plan()
        CoursePlanVersion.objects.create(plan=plan, version=1, snapshot={})
        with self.assertRaises(Exception):
            CoursePlanVersion.objects.create(plan=plan, version=1, snapshot={})

    def test_diff_records_what_changed(self):
        plan = self._plan()
        version = CoursePlanVersion.objects.create(
            plan=plan,
            version=2,
            snapshot={},
            diff={
                "added_topics": ["Импульс"],
                "removed_topics": [],
                "duration_changes": [{"topic": "Скорость", "from": 40, "to": 60}],
            },
            reason="Сделать интенсивнее",
            requested_by="student",
        )
        self.assertEqual(version.diff["added_topics"], ["Импульс"])
        self.assertFalse(version.approved_by_student)

    def test_plans_are_isolated_per_user(self):
        self._plan()
        other_goal = LearningGoal.objects.create(
            user_email=STRANGER, original_text="Химия"
        )
        CoursePlan.objects.create(
            user_email=STRANGER, goal=other_goal, title="Курс химии"
        )
        self.assertEqual(CoursePlan.objects.filter(user_email=OWNER).count(), 1)

    def test_modules_and_topics_keep_external_ids_unique(self):
        plan = self._plan()
        module = CourseModule.objects.create(
            plan=plan, external_id="m1", title="Кинематика"
        )
        CourseTopic.objects.create(
            module=module, external_id="t1", title="Скорость", estimated_minutes=40
        )
        with self.assertRaises(Exception):
            CourseModule.objects.create(plan=plan, external_id="m1", title="Дубль")


class ModelRegistryTests(TestCase):
    def test_role_falls_back_to_shared_text_model(self):
        with self.settings():
            import os

            os.environ.pop("COURSE_PLANNING_MODEL", None)
            os.environ["TEXT_LLM_MODEL"] = "some/shared-model"
            try:
                binding = resolve_model(ROLE_COURSE_PLANNING)
                self.assertEqual(binding.model, "some/shared-model")
                self.assertEqual(binding.source, "text_llm_fallback")
            finally:
                os.environ.pop("TEXT_LLM_MODEL", None)

    def test_explicit_role_wins_over_shared_model(self):
        import os

        os.environ["COURSE_PLANNING_MODEL"] = "vendor/strong-planner"
        os.environ["TEXT_LLM_MODEL"] = "vendor/cheap-chat"
        try:
            binding = resolve_model(ROLE_COURSE_PLANNING)
            self.assertEqual(binding.model, "vendor/strong-planner")
            self.assertEqual(binding.source, "role")
        finally:
            os.environ.pop("COURSE_PLANNING_MODEL", None)
            os.environ.pop("TEXT_LLM_MODEL", None)

    def test_embedding_role_does_not_fall_back_to_chat_model(self):
        import os

        os.environ["TEXT_LLM_MODEL"] = "vendor/cheap-chat"
        # `EMBEDDING_MODEL` снимается на время теста: он появился в `.env`, и
        # без этого тест проверял бы не отсутствие отката, а содержимое
        # окружения разработчика.
        saved = os.environ.pop("EMBEDDING_MODEL", None)
        try:
            binding = resolve_model(ROLE_EMBEDDING)
            # Чат-модель не выдаёт векторы — молчаливый откат был бы багом.
            self.assertEqual(binding.model, "")
            self.assertEqual(binding.source, "unset")
        finally:
            os.environ.pop("TEXT_LLM_MODEL", None)
            if saved is not None:
                os.environ["EMBEDDING_MODEL"] = saved

    def test_ocr_role_does_not_fall_back_to_chat_model(self):
        import os

        from curriculum.model_registry import ROLE_OCR

        os.environ["TEXT_LLM_MODEL"] = "vendor/cheap-chat"
        try:
            binding = resolve_model(ROLE_OCR)
            # Чат-модель не распознаёт страницу — откат был бы багом.
            self.assertEqual(binding.model, "")
            self.assertEqual(binding.source, "unset")
        finally:
            os.environ.pop("TEXT_LLM_MODEL", None)

    def test_goal_normalization_is_its_own_role(self):
        """Нормализация цели не должна тянуть за собой planner-модель.

        Ученик правит формулировку часто, а курс планируется редко. Общая
        переменная на две роли означала бы, что дорогая planner-модель
        вызывается на каждое уточнение цели.
        """
        import os

        from curriculum.model_registry import ROLE_GOAL_NORMALIZATION

        os.environ["GOAL_NORMALIZATION_MODEL"] = "vendor/cheap-normalizer"
        os.environ["COURSE_PLANNING_MODEL"] = "vendor/strong-planner"
        try:
            self.assertEqual(
                resolve_model(ROLE_GOAL_NORMALIZATION).model,
                "vendor/cheap-normalizer",
            )
            self.assertEqual(
                resolve_model(ROLE_COURSE_PLANNING).model, "vendor/strong-planner"
            )
        finally:
            os.environ.pop("GOAL_NORMALIZATION_MODEL", None)
            os.environ.pop("COURSE_PLANNING_MODEL", None)

    def test_goal_normalization_falls_back_to_shared_text_model(self):
        import os

        from curriculum.model_registry import ROLE_GOAL_NORMALIZATION

        os.environ.pop("GOAL_NORMALIZATION_MODEL", None)
        os.environ["TEXT_LLM_MODEL"] = "some/shared-model"
        try:
            binding = resolve_model(ROLE_GOAL_NORMALIZATION)
            self.assertEqual(binding.model, "some/shared-model")
            self.assertEqual(binding.source, "text_llm_fallback")
        finally:
            os.environ.pop("TEXT_LLM_MODEL", None)

    def test_unknown_role_is_rejected(self):
        with self.assertRaises(ValueError):
            resolve_model("NOT_A_ROLE")

    def test_snapshot_lists_all_roles(self):
        snapshot = registry_snapshot()
        self.assertIn(ROLE_COURSE_PLANNING, snapshot)
        self.assertIn(ROLE_EMBEDDING, snapshot)
        from curriculum.model_registry import ALL_ROLES

        for role in ALL_ROLES:
            self.assertIn(role, snapshot)

    def test_candidates_come_from_configuration(self):
        import os

        os.environ["COURSE_EVAL_MODELS"] = "a/one, b/two ,c/three"
        try:
            self.assertEqual(
                evaluation_candidates(), ["a/one", "b/two", "c/three"]
            )
        finally:
            os.environ.pop("COURSE_EVAL_MODELS", None)

    def test_no_candidates_without_configuration(self):
        import os

        os.environ.pop("COURSE_EVAL_MODELS", None)
        self.assertEqual(evaluation_candidates(), [])

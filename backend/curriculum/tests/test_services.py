"""Сервисы цели и курса: нормализация, генерация плана, подтверждение."""

import tempfile
from unittest import mock

from django.test import TestCase

from curriculum import storage as storage_module
from curriculum.models import (
    CourseDependency,
    CourseEnrollment,
    CoursePlan,
    CoursePlanVersion,
    CourseSourceBinding,
    CourseTopic,
    Document,
    DocumentFile,
    LearningGoal,
)
from curriculum.ocr import NullOcrProvider
from curriculum.planning.contracts import (
    CoursePlanningResult,
    ProposedModule,
    ProposedTopic,
)
from curriculum.planning.providers import (
    FakeCoursePlanningProvider,
    FakeCourseReviewProvider,
)
from curriculum.services import goals as goals_service
from curriculum.services import plans as plans_service
from curriculum.services.ingestion import ingest_document
from curriculum.tests.pdf_fixtures import textbook_pdf

EMAIL = "student@example.com"


class GoalNormalizationTests(TestCase):
    def setUp(self):
        self.provider = goals_service.FakeGoalNormalizationProvider()

    def test_create_starts_as_draft(self):
        goal = goals_service.create_goal(
            user_email=EMAIL, original_text="механика с нуля"
        )
        self.assertEqual(goal.status, LearningGoal.Status.DRAFT)
        self.assertFalse(goal.normalization_confirmed)

    def test_empty_text_rejected(self):
        with self.assertRaises(ValueError):
            goals_service.create_goal(user_email=EMAIL, original_text="   ")

    def test_normalization_never_overwrites_original_text(self):
        """Контракт `models.LearningGoal`: ученик всегда видит свою формулировку."""
        goal = goals_service.create_goal(
            user_email=EMAIL, original_text="механика кинематика с нуля"
        )
        goals_service.normalize_goal(goal, provider=self.provider)
        goal.refresh_from_db()
        self.assertEqual(goal.original_text, "механика кинематика с нуля")
        self.assertEqual(goal.normalized_subject, "Механика")

    def test_normalization_records_provenance(self):
        goal = goals_service.create_goal(user_email=EMAIL, original_text="физика")
        goals_service.normalize_goal(goal, provider=self.provider)
        goal.refresh_from_db()
        self.assertEqual(goal.normalization_model, "fake-goal-normalizer")
        self.assertEqual(
            goal.normalization_prompt_version,
            goals_service.NORMALIZATION_PROMPT_VERSION,
        )
        self.assertIsNotNone(goal.normalization_confidence)

    def test_normalization_does_not_self_confirm(self):
        """Подтверждение — право ученика, не модели."""
        goal = goals_service.create_goal(user_email=EMAIL, original_text="физика")
        goals_service.normalize_goal(goal, provider=self.provider)
        goal.refresh_from_db()
        self.assertFalse(goal.normalization_confirmed)
        self.assertEqual(goal.status, LearningGoal.Status.DRAFT)

    def test_provider_failure_does_not_break_goal(self):
        class Broken:
            name = "broken"

            def normalize(self, text):
                raise RuntimeError("нет сети")

        goal = goals_service.create_goal(user_email=EMAIL, original_text="физика")
        goals_service.normalize_goal(goal, provider=Broken())
        goal.refresh_from_db()
        self.assertEqual(goal.status, LearningGoal.Status.DRAFT)
        self.assertEqual(goal.original_text, "физика")

    def test_confirm_accepts_student_edits(self):
        goal = goals_service.create_goal(user_email=EMAIL, original_text="физика")
        goals_service.normalize_goal(goal, provider=self.provider)
        goals_service.confirm_goal(
            goal, normalized_subject="Физика", normalized_direction="Механика"
        )
        goal.refresh_from_db()
        self.assertEqual(goal.normalized_subject, "Физика")
        self.assertEqual(goal.normalized_direction, "Механика")
        self.assertTrue(goal.normalization_confirmed)
        self.assertEqual(goal.status, LearningGoal.Status.CONFIRMED)

    def test_confirm_without_subject_rejected(self):
        goal = goals_service.create_goal(user_email=EMAIL, original_text="физика")
        with self.assertRaises(ValueError):
            goals_service.confirm_goal(goal, normalized_subject="")

    def test_unmatched_domain_link_is_not_an_error(self):
        goal = goals_service.create_goal(user_email=EMAIL, original_text="физика")
        goals_service.confirm_goal(goal, normalized_subject="Небывалый предмет")
        goal.refresh_from_db()
        self.assertIsNone(goal.subject)
        self.assertIsNone(goal.topic)
        self.assertEqual(goal.status, LearningGoal.Status.CONFIRMED)

    def test_links_existing_mind_subject(self):
        from mind.models import Subject

        Subject.objects.create(user_email=EMAIL, name="Физика")
        goal = goals_service.create_goal(user_email=EMAIL, original_text="физика")
        goals_service.confirm_goal(goal, normalized_subject="физика")
        goal.refresh_from_db()
        self.assertIsNotNone(goal.subject)
        self.assertEqual(goal.subject.name, "Физика")


class ProviderSelectionTests(TestCase):
    def test_unset_role_yields_fake_and_never_calls_network(self):
        """Забытая переменная не должна приводить к платному вызову."""
        with mock.patch.dict("os.environ", {}, clear=True):
            provider = goals_service.get_normalization_provider()
        self.assertIsInstance(provider, goals_service.FakeGoalNormalizationProvider)

    def test_configured_role_yields_real_provider(self):
        with mock.patch.dict(
            "os.environ", {"GOAL_NORMALIZATION_MODEL": "vendor/model"}, clear=True
        ):
            provider = goals_service.get_normalization_provider()
        self.assertIsInstance(
            provider, goals_service.OpenRouterGoalNormalizationProvider
        )
        self.assertEqual(provider.model, "vendor/model")


class EnumNormalizationTests(TestCase):
    """Синонимы приводятся к контракту ДО валидатора."""

    def _result(self, **topic_fields):
        topic = ProposedTopic(
            external_id="t1",
            title="Тема",
            objective="Цель",
            estimated_minutes=45,
            **topic_fields,
        )
        return CoursePlanningResult(
            title="Курс",
            objective="Цель",
            modules=[
                ProposedModule(
                    external_id="m1", title="Модуль", objective="Ц", topics=[topic]
                )
            ],
        )

    def test_russian_difficulty_normalized(self):
        result = self._result(difficulty="средняя")
        plans_service.normalize_enum_fields(result)
        self.assertEqual(result.all_topics()[0].difficulty, "medium")

    def test_english_synonym_normalized(self):
        result = self._result(difficulty="Advanced")
        plans_service.normalize_enum_fields(result)
        self.assertEqual(result.all_topics()[0].difficulty, "hard")

    def test_balance_and_review_normalized(self):
        result = self._result(
            theory_practice_balance="практика", review_strategy="интервальное"
        )
        plans_service.normalize_enum_fields(result)
        topic = result.all_topics()[0]
        self.assertEqual(topic.theory_practice_balance, "practice")
        self.assertEqual(topic.review_strategy, "spaced")

    def test_unknown_value_left_for_validator(self):
        """Нормализация не подменяет валидатор: чужое значение доедет до него."""
        result = self._result(difficulty="совершенно неизвестная")
        plans_service.normalize_enum_fields(result)
        self.assertEqual(result.all_topics()[0].difficulty, "совершенно неизвестная")

    def test_empty_difficulty_gets_default(self):
        result = self._result(difficulty="")
        plans_service.normalize_enum_fields(result)
        self.assertEqual(result.all_topics()[0].difficulty, "medium")


class _PlanBase(TestCase):
    def setUp(self):
        storage_module.set_storage(
            storage_module.LocalFileStorage(tempfile.mkdtemp())
        )
        self.goal = goals_service.create_goal(
            user_email=EMAIL, original_text="механика кинематика с нуля"
        )
        goals_service.normalize_goal(
            self.goal, provider=goals_service.FakeGoalNormalizationProvider()
        )
        goals_service.confirm_goal(self.goal)
        self.document = self._ingested_document()

    def _ingested_document(self) -> Document:
        pdf = textbook_pdf()
        document = Document.objects.create(user_email=EMAIL, title="Механика")
        key = storage_module.build_storage_key(
            user_email=EMAIL, document_id=str(document.pk), filename="book.pdf"
        )
        storage_module.get_storage().save(key, pdf)
        DocumentFile.objects.create(
            document=document,
            original_filename="book.pdf",
            sanitized_filename="book.pdf",
            storage_key=key,
            mime_type="application/pdf",
            byte_size=len(pdf),
            content_hash=storage_module.content_hash(pdf),
        )
        ingest_document(document, ocr_provider=NullOcrProvider())
        document.refresh_from_db()
        return document

    def _generate(self, **kwargs):
        kwargs.setdefault("planning_provider", FakeCoursePlanningProvider())
        kwargs.setdefault("review_provider", FakeCourseReviewProvider())
        return plans_service.generate_plan(self.goal, self.document, **kwargs)


class PlanningContextTests(_PlanBase):
    def test_context_is_not_empty(self):
        """Регрессия: релевантность по цели давала ноль фрагментов.

        Запрос на русском против англоязычной книги не совпадал ни лексически
        (BM25 без морфологии), ни «плотно» (пересечение термов), и планировать
        было не из чего. Теперь добор идёт по покрытию разделов.
        """
        bundle = plans_service.retrieve_planning_context(self.goal, self.document)
        self.assertGreater(len(bundle.chunk_ids), 0)

    def test_context_covers_multiple_sections(self):
        bundle = plans_service.retrieve_planning_context(self.goal, self.document)
        paths = {result.section_path for result in bundle.results}
        self.assertGreater(len(paths), 1, f"покрыт только один раздел: {paths}")

    def test_context_never_contains_solutions(self):
        """Режим планирования не входит в `_SOLUTION_MODES`."""
        bundle = plans_service.retrieve_planning_context(self.goal, self.document)
        for result in bundle.results:
            self.assertNotEqual(result.chunk_type, "solution")
            self.assertNotIn("s = v0 t", result.excerpt)

    def test_toc_titles_passed_verbatim(self):
        bundle = plans_service.retrieve_planning_context(self.goal, self.document)
        request = plans_service.build_planning_request(
            self.goal, self.document, bundle
        )
        titles = [entry.title for entry in request.toc]
        self.assertIn("Kinematics of a point", titles)

    def test_available_chunk_ids_match_bundle(self):
        bundle = plans_service.retrieve_planning_context(self.goal, self.document)
        request = plans_service.build_planning_request(
            self.goal, self.document, bundle
        )
        self.assertEqual(list(request.available_chunk_ids), bundle.chunk_ids)

    def test_context_is_deterministic(self):
        first = plans_service.retrieve_planning_context(self.goal, self.document)
        second = plans_service.retrieve_planning_context(self.goal, self.document)
        self.assertEqual(first.chunk_ids, second.chunk_ids)


class PlanGenerationTests(_PlanBase):
    def test_generates_plan_awaiting_approval(self):
        outcome = self._generate()
        self.assertIsNotNone(outcome.plan)
        self.assertEqual(outcome.plan.status, CoursePlan.Status.AWAITING_APPROVAL)

    def test_persists_modules_and_topics(self):
        outcome = self._generate()
        self.assertGreater(outcome.plan.modules.count(), 0)
        self.assertGreater(
            CourseTopic.objects.filter(module__plan=outcome.plan).count(), 0
        )

    def test_binds_sources_to_topics(self):
        outcome = self._generate()
        self.assertGreater(
            CourseSourceBinding.objects.filter(
                topic__module__plan=outcome.plan
            ).count(),
            0,
        )

    def test_computes_forecast_on_backend(self):
        outcome = self._generate()
        plan = outcome.plan
        self.assertIsNotNone(plan.forecast_finish_date)
        self.assertIn("estimated_sessions", plan.forecast)
        self.assertGreater(plan.recommended_sessions_per_week, 0)

    def test_creates_first_version_snapshot(self):
        outcome = self._generate()
        versions = CoursePlanVersion.objects.filter(plan=outcome.plan)
        self.assertEqual(versions.count(), 1)
        self.assertEqual(versions.first().version, 1)
        self.assertIn("modules", versions.first().snapshot)

    def test_records_models_used(self):
        outcome = self._generate()
        self.assertEqual(outcome.planner_model, "fake-planner")
        self.assertEqual(outcome.reviewer_model, "fake-reviewer")

    def test_unprocessed_document_rejected(self):
        raw = Document.objects.create(
            user_email=EMAIL,
            title="Необработанный",
            ingestion_status=Document.Status.UPLOADED,
        )
        with self.assertRaises(plans_service.PlanRejected):
            plans_service.generate_plan(
                self.goal, raw, planning_provider=FakeCoursePlanningProvider()
            )

    def test_validator_blocker_persists_nothing(self):
        """Ключевое: план с галлюцинированным источником в БД не попадает."""

        class Hallucinating:
            name = "hallucinating"

            def generate_plan(self, request, context):
                return CoursePlanningResult(
                    title="Курс",
                    objective="Цель",
                    modules=[
                        ProposedModule(
                            external_id="m1",
                            title="Модуль",
                            objective="Цель",
                            topics=[
                                ProposedTopic(
                                    external_id="t1",
                                    title="Тема",
                                    objective="Цель",
                                    estimated_minutes=45,
                                    source_chunk_ids=["полностью-выдуманный-id"],
                                )
                            ],
                        )
                    ],
                )

        before = CoursePlan.objects.count()
        with self.assertRaises(plans_service.PlanRejected) as ctx:
            plans_service.generate_plan(
                self.goal, self.document, planning_provider=Hallucinating()
            )
        self.assertEqual(CoursePlan.objects.count(), before)
        codes = {issue.code for issue in ctx.exception.report.issues}
        self.assertIn("hallucinated_source", codes)

    def test_planner_failure_reported_not_crashed(self):
        class Broken:
            name = "broken"

            def generate_plan(self, request, context):
                raise RuntimeError("нет сети")

        with self.assertRaises(plans_service.PlanRejected):
            plans_service.generate_plan(
                self.goal, self.document, planning_provider=Broken()
            )
        self.assertEqual(CoursePlan.objects.count(), 0)

    def test_reviewer_blocker_marks_rejected(self):
        class Blocking:
            name = "blocking-reviewer"

            def review_plan(self, plan, request):
                from curriculum.planning.contracts import (
                    CourseReviewResult,
                    ReviewFinding,
                )

                return CourseReviewResult(
                    findings=[
                        ReviewFinding(
                            kind="goal_mismatch",
                            message="Курс не ведёт к цели",
                            severity="blocker",
                        )
                    ],
                    approved=False,
                    model="blocking-reviewer",
                )

        outcome = self._generate(review_provider=Blocking())
        self.assertEqual(outcome.plan.status, CoursePlan.Status.REJECTED)
        self.assertEqual(outcome.review_findings[0]["severity"], "blocker")

    def test_topological_study_order(self):
        outcome = self._generate()
        order = plans_service.topics_in_study_order(outcome.plan)
        externals = set(
            CourseTopic.objects.filter(module__plan=outcome.plan).values_list(
                "external_id", flat=True
            )
        )
        self.assertEqual(set(order), externals)
        # Зависимость обязана стоять раньше зависимой темы.
        for dependency in CourseDependency.objects.filter(plan=outcome.plan):
            self.assertLess(
                order.index(dependency.depends_on.external_id),
                order.index(dependency.topic.external_id),
            )


class PlanApprovalTests(_PlanBase):
    def setUp(self):
        super().setUp()
        self.plan = self._generate().plan

    def test_approval_activates_and_enrolls(self):
        enrollment = plans_service.approve_plan(self.plan, user_email=EMAIL)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.status, CoursePlan.Status.ACTIVE)
        self.assertIsNotNone(self.plan.approved_at)
        self.assertEqual(enrollment.user_email, EMAIL)
        self.assertTrue(enrollment.is_active)

    def test_enrollment_pinned_to_version(self):
        enrollment = plans_service.approve_plan(self.plan, user_email=EMAIL)
        self.assertEqual(enrollment.version.version, self.plan.current_version)
        self.assertTrue(enrollment.version.approved_by_student)

    def test_foreign_user_cannot_approve(self):
        with self.assertRaises(PermissionError):
            plans_service.approve_plan(self.plan, user_email="other@example.com")
        self.plan.refresh_from_db()
        self.assertNotEqual(self.plan.status, CoursePlan.Status.ACTIVE)

    def test_approving_twice_is_idempotent(self):
        plans_service.approve_plan(self.plan, user_email=EMAIL)
        plans_service.approve_plan(self.plan, user_email=EMAIL)
        self.assertEqual(
            CourseEnrollment.objects.filter(plan=self.plan, user_email=EMAIL).count(),
            1,
        )

    def test_rejected_plan_cannot_be_approved(self):
        self.plan.status = CoursePlan.Status.REJECTED
        self.plan.save(update_fields=["status"])
        with self.assertRaises(ValueError):
            plans_service.approve_plan(self.plan, user_email=EMAIL)

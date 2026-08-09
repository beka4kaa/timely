"""Сервисы цели и курса: нормализация, генерация плана, подтверждение."""

import tempfile
from unittest import mock

from django.test import TestCase, override_settings

from ai_engine.usage import AIUsageLimitExceeded

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
    DocumentSection,
    KnowledgeChunk,
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

    def test_quota_denial_is_not_hidden_as_goal_provider_fallback(self):
        class Denied:
            name = "denied"

            def normalize(self, text):
                raise AIUsageLimitExceeded(
                    window="five_hour",
                    reset_at="2026-08-09T12:00:00Z",
                )

        goal = goals_service.create_goal(user_email=EMAIL, original_text="физика")
        with self.assertRaises(AIUsageLimitExceeded):
            goals_service.normalize_goal(goal, provider=Denied())

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

    def test_provenance_coverage_counts_unique_known_section_paths(self):
        plan = self._generate().plan
        before = plans_service.provenance_coverage(plan)
        binding = CourseSourceBinding.objects.filter(
            topic__module__plan=plan
        ).first()
        CourseSourceBinding.objects.create(
            topic=binding.topic,
            document=self.document,
            section_path=binding.section_path,
        )
        CourseSourceBinding.objects.create(
            topic=binding.topic,
            document=self.document,
            section_path="unknown.section",
        )

        after = plans_service.provenance_coverage(plan)

        self.assertGreater(after.total_sections, 0)
        self.assertEqual(after.covered_sections, before.covered_sections)
        self.assertEqual(after.ratio, before.ratio)

    def test_provenance_coverage_is_stale_after_document_reprocessing(self):
        plan = self._generate().plan
        self.document.processing_version = "future"
        self.document.save(update_fields=["processing_version"])

        coverage = plans_service.provenance_coverage(plan)

        self.assertTrue(coverage.stale)
        self.assertIsNone(coverage.ratio)

    def test_provenance_coverage_without_toc_is_unknown_not_zero(self):
        plan = self._generate().plan
        DocumentSection.objects.filter(document=self.document).delete()

        coverage = plans_service.provenance_coverage(plan)

        self.assertEqual(coverage.total_sections, 0)
        self.assertIsNone(coverage.ratio)

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

    def test_reingestion_completed_during_llm_calls_persists_nothing(self):
        document = self.document

        class ReingestingReviewer(FakeCourseReviewProvider):
            def review_plan(self, plan, context):
                # Между validation и финальной транзакцией ingestion уже успел
                # заменить строки и опубликовать новую processing version.
                KnowledgeChunk.objects.filter(document_id=document.pk).delete()
                Document.objects.filter(pk=document.pk).update(
                    ingestion_status=Document.Status.READY,
                    processing_version="future",
                )
                return super().review_plan(plan, context)

        before_plans = CoursePlan.objects.count()
        before_bindings = CourseSourceBinding.objects.count()

        with self.assertRaises(plans_service.PlanSourceChanged) as ctx:
            self._generate(review_provider=ReingestingReviewer())

        self.assertIn("переобработан", ctx.exception.message.lower())
        self.assertEqual(CoursePlan.objects.count(), before_plans)
        self.assertEqual(CourseSourceBinding.objects.count(), before_bindings)

    def test_disappeared_validated_chunks_with_same_version_persist_nothing(self):
        document = self.document

        class DeletingReviewer(FakeCourseReviewProvider):
            def review_plan(self, plan, context):
                # Даже если внешний код не сменил status/version, исчезновение
                # любого chunk из validated allowlist обязано разорвать CAS.
                KnowledgeChunk.objects.filter(document_id=document.pk).delete()
                return super().review_plan(plan, context)

        before_plans = CoursePlan.objects.count()

        with self.assertRaises(plans_service.PlanSourceChanged):
            self._generate(review_provider=DeletingReviewer())

        self.assertEqual(CoursePlan.objects.count(), before_plans)
        self.assertFalse(CourseSourceBinding.objects.exists())

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

    def test_planner_quota_denial_is_not_converted_to_plan_rejected(self):
        class Denied:
            name = "denied"

            def generate_plan(self, request, context):
                raise AIUsageLimitExceeded(
                    window="five_hour",
                    reset_at="2026-08-09T12:00:00Z",
                )

        with self.assertRaises(AIUsageLimitExceeded):
            self._generate(planning_provider=Denied())
        self.assertEqual(CoursePlan.objects.count(), 0)

    def test_reviewer_quota_denial_is_not_hidden_as_optional_review_failure(self):
        class Denied:
            name = "denied"

            def review_plan(self, plan, request):
                raise AIUsageLimitExceeded(
                    window="weekly",
                    reset_at="2026-08-10T00:00:00Z",
                )

        with self.assertRaises(AIUsageLimitExceeded):
            self._generate(review_provider=Denied())
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


class PlanRepairTests(_PlanBase):
    """Одна попытка починки при блокерах валидатора.

    Без неё одна забытая моделью `objective` или `estimated_minutes: 0`
    превращались в 422 и тупик для ученика.
    """

    class _FirstAttemptBroken:
        """Первый раз возвращает план с блокером, второй — исправленный."""

        name = "repairable"

        def __init__(self, chunk_id_source=None):
            self.calls: list[tuple[str, ...]] = []
            self._chunk_id_source = chunk_id_source

        def generate_plan(self, request, context):
            self.calls.append(tuple(request.repair_issues))
            chunk_id = (request.available_chunk_ids or ("c1",))[0]
            # Блокер только на первой попытке: пустой objective у темы.
            objective = "" if len(self.calls) == 1 else "Понять скорость"
            return CoursePlanningResult(
                title="Курс механики",
                objective="Освоить механику",
                modules=[
                    ProposedModule(
                        external_id="m1",
                        title="Кинематика",
                        objective="Освоить",
                        estimated_minutes=45,
                        topics=[
                            ProposedTopic(
                                external_id="t1",
                                title="Скорость",
                                objective=objective,
                                estimated_minutes=45,
                                source_chunk_ids=[chunk_id],
                            )
                        ],
                    )
                ],
            )

    def test_blocker_triggers_one_repair_and_succeeds(self):
        planner = self._FirstAttemptBroken()
        outcome = plans_service.generate_plan(
            self.goal,
            self.document,
            planning_provider=planner,
            review_provider=FakeCourseReviewProvider(),
        )
        self.assertEqual(len(planner.calls), 2)
        self.assertEqual(outcome.plan.status, CoursePlan.Status.AWAITING_APPROVAL)
        self.assertIn("plan_repaired_after_validation", outcome.warnings)

    def test_repair_call_receives_blocker_codes(self):
        planner = self._FirstAttemptBroken()
        plans_service.generate_plan(
            self.goal,
            self.document,
            planning_provider=planner,
            review_provider=FakeCourseReviewProvider(),
        )
        self.assertEqual(planner.calls[0], ())
        self.assertTrue(
            any("missing_objective" in issue for issue in planner.calls[1]),
            planner.calls[1],
        )

    def test_valid_plan_does_not_trigger_repair(self):
        """Цена починки — второй платный вызов. Зря его делать нельзя."""

        class Counting(FakeCoursePlanningProvider):
            def __init__(self):
                super().__init__()
                self.calls = 0

            def generate_plan(self, request, context):
                self.calls += 1
                return super().generate_plan(request, context)

        planner = Counting()
        outcome = plans_service.generate_plan(
            self.goal,
            self.document,
            planning_provider=planner,
            review_provider=FakeCourseReviewProvider(),
        )
        self.assertEqual(planner.calls, 1)
        self.assertNotIn("plan_repaired_after_validation", outcome.warnings)

    def test_repair_is_attempted_only_once(self):
        """Вторая попытка не добавляет успеха, зато удваивает счёт."""

        class AlwaysBroken:
            name = "always-broken"

            def __init__(self):
                self.calls = 0

            def generate_plan(self, request, context):
                self.calls += 1
                return CoursePlanningResult(title="", objective="", modules=[])

        planner = AlwaysBroken()
        with self.assertRaises(plans_service.PlanRejected):
            plans_service.generate_plan(
                self.goal, self.document, planning_provider=planner
            )
        self.assertEqual(planner.calls, 2)
        self.assertEqual(CoursePlan.objects.count(), 0)

    def test_planner_dying_on_repair_keeps_first_report(self):
        """Ученику нужны претензии валидатора, а не «модель недоступна»."""

        class DiesOnRetry:
            name = "dies-on-retry"

            def __init__(self):
                self.calls = 0

            def generate_plan(self, request, context):
                self.calls += 1
                if self.calls > 1:
                    raise RuntimeError("нет сети")
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
                                    source_chunk_ids=["выдуманный-id"],
                                )
                            ],
                        )
                    ],
                )

        planner = DiesOnRetry()
        with self.assertRaises(plans_service.PlanRejected) as ctx:
            plans_service.generate_plan(
                self.goal, self.document, planning_provider=planner
            )
        self.assertEqual(planner.calls, 2)
        self.assertIsNotNone(ctx.exception.report)
        codes = {issue.code for issue in ctx.exception.report.issues}
        self.assertIn("hallucinated_source", codes)

    def test_repair_issues_excluded_from_input_hash(self):
        """`input_hash` отвечает на вопрос «одинаковый ли вход у моделей».

        Починка — свойство попытки, а не входных данных, иначе benchmark решит,
        что моделям дали разное.
        """
        from dataclasses import replace

        bundle = plans_service.retrieve_planning_context(self.goal, self.document)
        request = plans_service.build_planning_request(
            self.goal, self.document, bundle
        )
        repaired = replace(request, repair_issues=("missing_objective: нет цели",))
        self.assertEqual(request.input_hash(), repaired.input_hash())


class PlanDeadlineTests(_PlanBase):
    """Деградация по общему дедлайну вместо падения.

    Генерация идёт внутри HTTP-запроса и делает до трёх последовательных вызовов
    модели. Сумма их таймаутов не влезает в `gunicorn --timeout`, а убитый по
    SIGABRT воркер не оставляет ученику ничего. Поэтому необязательные шаги
    пропускаются — заметно, с записью в `warnings`.
    """

    @staticmethod
    def _expired():
        """Дедлайн, истёкший к первой же проверке."""
        return mock.patch.object(plans_service, "_plan_deadline_seconds", lambda: 0)

    def test_deadline_skips_review_and_reports_it(self):
        class Counting(FakeCourseReviewProvider):
            def __init__(self):
                super().__init__()
                self.calls = 0

            def review_plan(self, plan, request):
                self.calls += 1
                return super().review_plan(plan, request)

        reviewer = Counting()
        with self._expired():
            outcome = plans_service.generate_plan(
                self.goal,
                self.document,
                planning_provider=FakeCoursePlanningProvider(),
                review_provider=reviewer,
            )

        self.assertEqual(reviewer.calls, 0)
        self.assertIn("plan_review_skipped_deadline", outcome.warnings)
        # План всё равно есть и ждёт подтверждения — это и есть деградация.
        self.assertEqual(outcome.plan.status, CoursePlan.Status.AWAITING_APPROVAL)
        # Имя непроработавшего рецензента читалось бы как «план проверен».
        self.assertEqual(outcome.reviewer_model, "")

    def test_deadline_skips_repair_and_explains_the_refusal(self):
        planner = PlanRepairTests._FirstAttemptBroken()
        with self._expired():
            with self.assertRaises(plans_service.PlanRejected) as ctx:
                plans_service.generate_plan(
                    self.goal,
                    self.document,
                    planning_provider=planner,
                    review_provider=FakeCourseReviewProvider(),
                )

        # Ровно один вызов: второй — это и есть починка, на которую нет времени.
        self.assertEqual(len(planner.calls), 1)
        self.assertIn("повторную попытку", ctx.exception.message)
        self.assertEqual(CoursePlan.objects.count(), 0)

    def test_broken_reviewer_is_no_longer_silent(self):
        """Раньше падение рецензента не оставляло следа нигде, кроме лога."""

        class Broken(FakeCourseReviewProvider):
            def review_plan(self, plan, request):
                raise RuntimeError("рецензент недоступен")

        outcome = plans_service.generate_plan(
            self.goal,
            self.document,
            planning_provider=FakeCoursePlanningProvider(),
            review_provider=Broken(),
        )
        self.assertIn("plan_review_unavailable", outcome.warnings)
        self.assertEqual(outcome.reviewer_model, "")
        self.assertEqual(outcome.plan.status, CoursePlan.Status.AWAITING_APPROVAL)

    def test_ample_deadline_skips_nothing(self):
        outcome = self._generate()
        self.assertNotIn("plan_review_skipped_deadline", outcome.warnings)
        self.assertNotIn("plan_review_unavailable", outcome.warnings)
        self.assertEqual(outcome.reviewer_model, "fake-reviewer")

    @override_settings(CURRICULUM_PLAN_DEADLINE_SECONDS=42)
    def test_deadline_is_configurable(self):
        self.assertEqual(plans_service._plan_deadline_seconds(), 42)


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

"""Планировщик: провайдеры, парсер ответа, строгая валидация, benchmark."""

import json
from unittest import mock

from django.test import SimpleTestCase

from curriculum.benchmark import (
    BenchmarkDisabled,
    guard_real_run,
    run_benchmark,
)
from curriculum.planning.contracts import (
    BookMetadata,
    CoursePlanningRequest,
    PlanningConstraints,
    TocEntry,
)
from curriculum.planning.enrichment import (
    FakeChapterEnrichmentProvider,
    get_enrichment_provider,
)
from curriculum.planning.providers import (
    _MODULE_FIELDS,
    _ROOT_FIELDS,
    _TOPIC_FIELDS,
    FakeCoursePlanningProvider,
    FakeCourseReviewProvider,
    FixtureCoursePlanningProvider,
    MalformedPlanResponse,
    OpenRouterCourseReviewProvider,
    ProviderNotConfigured,
    SkeletonCoursePlanningProvider,
    get_planning_provider,
    get_review_provider,
    parse_planning_response,
    parse_review_response,
)
from curriculum.planning.schema import COURSE_PLAN_SCHEMA
from curriculum.planning.validation import (
    ALLOWED_BALANCE,
    ALLOWED_DIFFICULTY,
    ALLOWED_REVIEW,
    topological_order,
    validate_plan,
)
from curriculum.retrieval import RetrievalBundle

TOC = (
    TocEntry(path="1", title="Кинематика", page_start=5, page_end=40),
    TocEntry(path="1.1", title="Скорость", page_start=5, page_end=20),
    TocEntry(path="1.2", title="Ускорение", page_start=21, page_end=40),
    TocEntry(path="2", title="Динамика", page_start=41, page_end=90),
    TocEntry(path="2.1", title="Законы Ньютона", page_start=41, page_end=70),
)
CHUNKS = ("c1", "c2", "c3", "c4")


def make_request(**overrides) -> CoursePlanningRequest:
    defaults = dict(
        goal_text="Хочу научиться решать задачи по механике",
        normalized_subject="Физика",
        normalized_direction="Механика",
        current_level="beginner",
        target_level="school_confident",
        language="ru",
        theory_practice_balance="balanced",
        desired_finish_date=None,
        book=BookMetadata(title="Механика, 10 класс", authors=("Иванов",)),
        toc=TOC,
        available_chunk_ids=CHUNKS,
        constraints=PlanningConstraints(),
    )
    defaults.update(overrides)
    return CoursePlanningRequest(**defaults)


class RequestContractTests(SimpleTestCase):
    def test_input_hash_is_stable_and_sensitive(self):
        first = make_request()
        second = make_request()
        self.assertEqual(first.input_hash(), second.input_hash())

        changed = make_request(current_level="advanced")
        self.assertNotEqual(first.input_hash(), changed.input_hash())


class FakeProviderTests(SimpleTestCase):
    def test_fake_plan_passes_validation(self):
        request = make_request()
        plan = FakeCoursePlanningProvider().generate_plan(request, RetrievalBundle())
        report = validate_plan(plan, request)

        self.assertTrue(report.is_valid, report.blockers)
        self.assertEqual(report.hallucinated_source_count, 0)
        self.assertEqual(report.prerequisite_cycle_count, 0)
        self.assertGreater(report.topic_count, 0)

    def test_fake_plan_is_deterministic(self):
        request = make_request()
        provider = FakeCoursePlanningProvider()
        first = provider.generate_plan(request, RetrievalBundle())
        second = provider.generate_plan(request, RetrievalBundle())
        self.assertEqual(
            [t.external_id for t in first.all_topics()],
            [t.external_id for t in second.all_topics()],
        )

    def test_fake_only_references_allowed_chunks(self):
        request = make_request()
        plan = FakeCoursePlanningProvider().generate_plan(request, RetrievalBundle())
        for topic in plan.all_topics():
            for chunk_id in topic.source_chunk_ids:
                self.assertIn(chunk_id, CHUNKS)

    def test_default_provider_builds_structure_from_the_book(self):
        """Структуру строит оглавление, поэтому провайдер по умолчанию — скелет.

        Модель больше не выбирает, что считать модулем: по «Механике» она
        выбирала части книги и давала пять модулей на девять глав.
        """
        with mock.patch.dict("os.environ", {}, clear=True):
            provider = get_planning_provider()
        self.assertIsInstance(provider, SkeletonCoursePlanningProvider)

    def test_no_paid_call_without_configured_role(self):
        """Гарантия та же, что и раньше, но теперь на уровне обогащения.

        Скелет в сеть не ходит вовсе; платить может только заполнение смысла, и
        без настроенной роли оно берёт детерминированный fake. Забытая
        переменная окружения по-прежнему не приводит к платному вызову.
        """
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertIsInstance(
                get_enrichment_provider(), FakeChapterEnrichmentProvider
            )

    def test_reviewer_flags_unsourced_topic(self):
        request = make_request(available_chunk_ids=())
        plan = FakeCoursePlanningProvider().generate_plan(request, RetrievalBundle())
        review = FakeCourseReviewProvider().review_plan(plan, RetrievalBundle())
        self.assertTrue(any(f.kind == "unsourced_topic" for f in review.findings))

    def test_default_reviewer_is_fake_without_configured_role(self):
        """До появления реального рецензента фейк был ЕДИНСТВЕННЫМ вариантом.

        Теперь их два, и выбор обязан остаться консервативным: забытая переменная
        окружения не должна приводить к платному вызову.
        """
        with mock.patch.dict("os.environ", {}, clear=True):
            self.assertIsInstance(get_review_provider(), FakeCourseReviewProvider)

    def test_configured_role_yields_real_reviewer(self):
        with mock.patch.dict(
            "os.environ", {"COURSE_REVIEW_MODEL": "vendor/reviewer"}, clear=True
        ):
            provider = get_review_provider()
        self.assertIsInstance(provider, OpenRouterCourseReviewProvider)
        self.assertEqual(provider.model, "vendor/reviewer")

    def test_unknown_reviewer_key_rejected(self):
        with self.assertRaises(ProviderNotConfigured):
            get_review_provider("нет-такого")


class ReviewResponseParsingTests(SimpleTestCase):
    """Разбор ответа рецензента. Право забраковать план даётся неохотно."""

    def test_parses_findings_and_severity(self):
        raw = json.dumps(
            {
                "approved": False,
                "findings": [
                    {
                        "kind": "goal_mismatch",
                        "message": "Курс не ведёт к цели",
                        "topic_external_id": "t1",
                        "severity": "blocker",
                    }
                ],
            }
        )
        review = parse_review_response(raw, model="vendor/m")
        self.assertFalse(review.approved)
        self.assertEqual(len(review.blockers), 1)
        self.assertEqual(review.blockers[0].topic_external_id, "t1")
        self.assertEqual(review.model, "vendor/m")

    def test_unknown_severity_downgraded_to_warning(self):
        """Мусор в severity не должен давать права забраковать план."""
        raw = json.dumps(
            {"findings": [{"kind": "x", "message": "текст", "severity": "КРИТИЧНО"}]}
        )
        review = parse_review_response(raw)
        self.assertEqual(review.findings[0].severity, "warning")
        self.assertEqual(review.blockers, [])
        self.assertTrue(review.approved)

    def test_missing_approved_is_derived_from_blockers(self):
        """Молчание — не одобрение и не отказ: решают блокеры."""
        with_blocker = parse_review_response(
            json.dumps(
                {"findings": [{"kind": "x", "message": "т", "severity": "blocker"}]}
            )
        )
        self.assertFalse(with_blocker.approved)

        clean = parse_review_response(json.dumps({"findings": []}))
        self.assertTrue(clean.approved)

    def test_findings_without_message_dropped(self):
        raw = json.dumps({"findings": [{"kind": "x", "message": "   "}, "мусор"]})
        self.assertEqual(parse_review_response(raw).findings, [])

    def test_fenced_json_accepted(self):
        raw = '```json\n{"approved": true, "findings": []}\n```'
        self.assertTrue(parse_review_response(raw).approved)

    def test_non_object_rejected(self):
        with self.assertRaises(MalformedPlanResponse):
            parse_review_response("[1, 2, 3]")

    def test_real_reviewer_requires_a_model(self):
        with mock.patch.dict("os.environ", {}, clear=True):
            with self.assertRaises(ProviderNotConfigured):
                OpenRouterCourseReviewProvider()


class ResponseParsingTests(SimpleTestCase):
    def _payload(self, **overrides):
        data = {
            "title": "Механика с нуля",
            "objective": "Научиться решать задачи",
            "modules": [
                {
                    "external_id": "m1",
                    "title": "Кинематика",
                    "objective": "Освоить кинематику",
                    "estimated_minutes": 90,
                    "topics": [
                        {
                            "external_id": "t1",
                            "title": "Скорость",
                            "objective": "Понять скорость",
                            "estimated_minutes": 45,
                            "difficulty": "easy",
                            "prerequisites": [],
                            "source_chunk_ids": ["c1"],
                        },
                        {
                            "external_id": "t2",
                            "title": "Ускорение",
                            "objective": "Понять ускорение",
                            "estimated_minutes": 45,
                            "difficulty": "medium",
                            "prerequisites": ["t1"],
                            "source_chunk_ids": ["c2"],
                        },
                    ],
                }
            ],
        }
        data.update(overrides)
        return data

    def test_parses_plain_json(self):
        plan = parse_planning_response(json.dumps(self._payload()))
        self.assertEqual(plan.title, "Механика с нуля")
        self.assertEqual(len(plan.all_topics()), 2)
        self.assertEqual(plan.total_minutes(), 90)

    def test_parses_markdown_fenced_json(self):
        raw = "Вот программа:\n```json\n" + json.dumps(self._payload()) + "\n```\nГотово."
        plan = parse_planning_response(raw)
        self.assertEqual(len(plan.all_topics()), 2)

    def test_collects_unknown_fields_instead_of_ignoring(self):
        payload = self._payload(surprise="что-то лишнее")
        payload["modules"][0]["topics"][0]["weird"] = 1
        plan = parse_planning_response(json.dumps(payload))
        self.assertIn("surprise", plan.unknown_fields)
        self.assertIn("topics[].weird", plan.unknown_fields)

    def test_truncated_json_raises(self):
        with self.assertRaises(MalformedPlanResponse):
            parse_planning_response('{"title": "Обрыв", "modules": [')

    def test_empty_response_raises(self):
        with self.assertRaises(MalformedPlanResponse):
            parse_planning_response("   ")

    def test_non_object_response_raises(self):
        with self.assertRaises(MalformedPlanResponse):
            parse_planning_response("[1, 2, 3]")

    def test_fixture_provider_round_trip(self):
        provider = FixtureCoursePlanningProvider(self._payload())
        plan = provider.generate_plan(make_request(), RetrievalBundle())
        self.assertEqual(len(plan.all_topics()), 2)


class ValidationTests(SimpleTestCase):
    def _plan_from(self, payload):
        return parse_planning_response(json.dumps(payload))

    def _valid_payload(self):
        return {
            "title": "Механика",
            "objective": "Цель",
            "modules": [
                {
                    "external_id": "m1",
                    "title": "Кинематика",
                    "objective": "Освоить",
                    "estimated_minutes": 90,
                    "topics": [
                        {
                            "external_id": "t1",
                            "title": "Скорость",
                            "objective": "Понять",
                            "estimated_minutes": 45,
                            "difficulty": "easy",
                            "theory_practice_balance": "balanced",
                            "prerequisites": [],
                            "source_chunk_ids": ["c1"],
                        },
                        {
                            "external_id": "t2",
                            "title": "Ускорение",
                            "objective": "Понять",
                            "estimated_minutes": 45,
                            "difficulty": "medium",
                            "theory_practice_balance": "balanced",
                            "prerequisites": ["t1"],
                            "source_chunk_ids": ["c2"],
                        },
                    ],
                }
            ],
        }

    def test_valid_plan_has_no_blockers(self):
        report = validate_plan(self._plan_from(self._valid_payload()), make_request())
        self.assertTrue(report.is_valid, report.blockers)

    def test_oversized_plan_is_a_warning_not_a_blocker(self):
        """Толстый учебник честно даёт много модулей.

        Раньше превышение потолка выбрасывало ВЕСЬ план, и ученик после трёх
        минут ожидания не получал ничего. На «Механике» Мякишева это случалось
        каждый раз. Лишний модуль не делает план неверным — в отличие от
        выдуманного источника или цикла, — поэтому теперь это предупреждение.
        """
        payload = self._valid_payload()
        template = payload["modules"][0]
        payload["modules"] = []
        for index in range(1, 31):
            module = json.loads(json.dumps(template))
            module["external_id"] = f"m{index}"
            for position, topic in enumerate(module["topics"], start=1):
                topic["external_id"] = f"t{index}_{position}"
                topic["title"] = f"Тема {index}.{position}"
                topic["prerequisites"] = []
            payload["modules"].append(module)

        report = validate_plan(self._plan_from(payload), make_request())
        codes = {issue.code for issue in report.issues}
        self.assertIn("too_many_modules", codes)
        self.assertNotIn(
            "too_many_modules", {issue.code for issue in report.blockers}
        )
        self.assertTrue(report.is_valid, report.blockers)

    def test_absurd_total_duration_is_still_a_blocker(self):
        # Потолок длительности остался блокером: это признак сломанных чисел,
        # по которым потом считается прогноз сроков, а не «многовато».
        payload = self._valid_payload()
        for topic in payload["modules"][0]["topics"]:
            topic["estimated_minutes"] = 500_000
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertIn(
            "total_duration_too_large", {issue.code for issue in report.blockers}
        )

    def test_hallucinated_chunk_id_is_a_blocker(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][0]["source_chunk_ids"] = ["c999"]
        report = validate_plan(self._plan_from(payload), make_request())

        self.assertFalse(report.is_valid)
        self.assertEqual(report.hallucinated_source_count, 1)
        self.assertTrue(any(i.code == "hallucinated_source" for i in report.blockers))

    def test_prerequisite_cycle_is_detected(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][0]["prerequisites"] = ["t2"]
        report = validate_plan(self._plan_from(payload), make_request())

        self.assertFalse(report.is_valid)
        self.assertEqual(report.prerequisite_cycle_count, 1)

    def test_self_prerequisite_is_rejected(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][0]["prerequisites"] = ["t1"]
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertTrue(any(i.code == "self_prerequisite" for i in report.issues))

    def test_unknown_prerequisite_is_rejected(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][1]["prerequisites"] = ["t42"]
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertTrue(any(i.code == "unknown_prerequisite" for i in report.blockers))

    def test_negative_duration_is_a_blocker(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][0]["estimated_minutes"] = -5
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertTrue(any(i.code == "non_positive_duration" for i in report.blockers))

    def test_missing_objective_is_a_blocker(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][0]["objective"] = "   "
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertEqual(report.missing_objective_count, 1)
        self.assertFalse(report.is_valid)

    def test_duplicate_topic_id_is_a_blocker(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][1]["external_id"] = "t1"
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertTrue(any(i.code == "duplicate_topic_id" for i in report.blockers))

    def test_duplicate_title_is_a_warning_not_a_blocker(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][1]["title"] = "Скорость"
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertEqual(report.duplicate_topic_count, 1)
        self.assertTrue(report.is_valid)

    def test_invalid_enum_is_a_blocker(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][0]["difficulty"] = "невозможная"
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertTrue(any(i.code == "invalid_difficulty" for i in report.blockers))

    def test_unsafe_content_is_rejected(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][0]["objective"] = "<script>alert(1)</script>"
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertTrue(any(i.code == "unsafe_content" for i in report.blockers))

    def test_topic_without_source_is_a_warning(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"][0]["source_chunk_ids"] = []
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertEqual(report.unsourced_topic_count, 1)
        self.assertTrue(report.is_valid)

    def test_low_coverage_is_reported(self):
        payload = self._valid_payload()
        payload["modules"][0]["topics"] = payload["modules"][0]["topics"][:1]
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertLess(report.coverage_ratio, 0.5)
        self.assertTrue(any(i.code == "low_coverage" for i in report.issues))

    def test_coverage_survives_paraphrased_titles(self):
        """Главное, зачем метрика переписана: модель перефразирует заголовки.

        Темы плана — «Скорость» и «Ускорение». При точном сравнении строк такой
        план давал 0% покрытия и получал `low_coverage`, хотя покрывает книгу
        целиком.
        """
        report = validate_plan(
            self._plan_from(self._valid_payload()),
            make_request(
                toc=(
                    TocEntry(
                        path="1.1",
                        title="§1.1 Скорость материальной точки",
                        page_start=5,
                        page_end=20,
                    ),
                    TocEntry(
                        path="1.2", title="1.2. Ускорение тела", page_start=21, page_end=40
                    ),
                )
            ),
        )
        self.assertEqual(report.covered_sections, 2)
        self.assertEqual(report.coverage_ratio, 1.0)
        self.assertFalse(any(i.code == "low_coverage" for i in report.issues))

    def test_coverage_does_not_match_unrelated_titles(self):
        """Порог не должен превращаться в «совпадает со всем»."""
        report = validate_plan(
            self._plan_from(self._valid_payload()),
            make_request(
                toc=(
                    TocEntry(
                        path="1", title="Термодинамика", page_start=1, page_end=10
                    ),
                    TocEntry(
                        path="2", title="Преломление света", page_start=11, page_end=20
                    ),
                )
            ),
        )
        self.assertEqual(report.covered_sections, 0)

    def test_coverage_ignores_section_word_only_overlap(self):
        """«Глава 1» и «Глава 2» не должны совпадать с произвольной темой.

        Иначе достаточно слова «глава», чтобы покрытие стало 100%.
        """
        report = validate_plan(
            self._plan_from(self._valid_payload()),
            make_request(
                toc=(
                    TocEntry(path="1", title="Глава 1", page_start=1, page_end=10),
                    TocEntry(path="2", title="Глава 2", page_start=11, page_end=20),
                )
            ),
        )
        self.assertEqual(report.covered_sections, 0)

    def test_module_duration_mismatch_is_a_warning(self):
        payload = self._valid_payload()
        payload["modules"][0]["estimated_minutes"] = 999
        report = validate_plan(self._plan_from(payload), make_request())
        self.assertTrue(
            any(i.code == "module_duration_mismatch" for i in report.issues)
        )
        self.assertTrue(report.is_valid)

    def test_topological_order_respects_prerequisites(self):
        plan = self._plan_from(self._valid_payload())
        order = topological_order(plan)
        self.assertLess(order.index("t1"), order.index("t2"))


class BenchmarkTests(SimpleTestCase):
    """Benchmark обязан быть выключен и честен по условиям."""

    def test_guard_is_disabled_by_default(self):
        status = guard_real_run()
        self.assertFalse(status.enabled)
        self.assertTrue(status.reasons)

    def test_real_run_refuses_without_guard(self):
        with self.assertRaises(BenchmarkDisabled):
            run_benchmark(
                request=make_request(),
                context=RetrievalBundle(),
                provider_factory=lambda model: FakeCoursePlanningProvider(),
                candidates=["model-a", "model-b"],
                enforce_guard=True,
            )

    def test_empty_candidate_list_refuses(self):
        with self.assertRaises(BenchmarkDisabled):
            run_benchmark(
                request=make_request(),
                context=RetrievalBundle(),
                provider_factory=lambda model: FakeCoursePlanningProvider(),
                candidates=[],
                enforce_guard=False,
            )

    def test_offline_run_makes_exactly_one_call_per_model(self):
        calls: list[str] = []

        def factory(model: str):
            calls.append(model)
            return FakeCoursePlanningProvider()

        run = run_benchmark(
            request=make_request(),
            context=RetrievalBundle(),
            provider_factory=factory,
            candidates=["model-a", "model-b", "model-c"],
            enforce_guard=False,
        )

        self.assertEqual(calls, ["model-a", "model-b", "model-c"])
        self.assertTrue(run.one_call_each())
        self.assertTrue(run.inputs_identical())
        self.assertEqual(len(run.results), 3)

    def test_all_models_receive_identical_input(self):
        seen: set[str] = set()

        class Recorder(FakeCoursePlanningProvider):
            def generate_plan(self, request, context):
                seen.add(request.input_hash())
                return super().generate_plan(request, context)

        run_benchmark(
            request=make_request(),
            context=RetrievalBundle(),
            provider_factory=lambda model: Recorder(),
            candidates=["a", "b", "c", "d"],
            enforce_guard=False,
        )
        self.assertEqual(len(seen), 1)

    def test_failing_candidate_does_not_break_the_run(self):
        class Broken:
            name = "broken"

            def generate_plan(self, request, context):
                raise RuntimeError("провайдер недоступен")

        run = run_benchmark(
            request=make_request(),
            context=RetrievalBundle(),
            provider_factory=lambda model: (
                Broken() if model == "bad" else FakeCoursePlanningProvider()
            ),
            candidates=["good", "bad"],
            enforce_guard=False,
        )

        bad = next(r for r in run.results if r.model == "bad")
        good = next(r for r in run.results if r.model == "good")
        self.assertFalse(bad.succeeded)
        self.assertIn("провайдер недоступен", bad.error)
        self.assertTrue(good.succeeded)
        # Даже упавший кандидат считается за один вызов: иначе сравнение
        # «сколько запросов потратили» будет неверным.
        self.assertTrue(run.one_call_each())

    def test_report_does_not_declare_a_winner(self):
        run = run_benchmark(
            request=make_request(),
            context=RetrievalBundle(),
            provider_factory=lambda model: FakeCoursePlanningProvider(),
            candidates=["a", "b"],
            enforce_guard=False,
        )
        report = run.render_report()
        self.assertIn("Победитель НЕ выбирается автоматически", report)
        self.assertIn("вход одинаков: да", report)
        self.assertNotIn("winner", report.lower())

    def test_metrics_are_deterministic_checks_only(self):
        run = run_benchmark(
            request=make_request(),
            context=RetrievalBundle(),
            provider_factory=lambda model: FakeCoursePlanningProvider(),
            candidates=["a"],
            enforce_guard=False,
        )
        metrics = run.results[0].deterministic_metrics()
        self.assertIn("hallucinated_source_count", metrics)
        self.assertIn("coverage_ratio", metrics)
        self.assertIn("prerequisite_cycle_count", metrics)
        # Экспертных оценок в автоматических метриках быть не должно.
        self.assertNotIn("pedagogical_coherence", metrics)


class CoursePlanSchemaTests(SimpleTestCase):
    """Схема — это контракт, продублированный в трёх местах.

    Она обязана совпадать с тем, что читает парсер, и с тем, что пропускает
    валидатор. Разъехавшись, схема начнёт разрешать значение, за которое
    валидатор выдаст блокер, — и модель будет получать отказ за ответ, о котором
    её сами попросили. Эти тесты ловят расхождение при правке любой из сторон.
    """

    def _objects(self):
        """Все объектные узлы схемы: корень, модуль, тема."""
        module = COURSE_PLAN_SCHEMA["properties"]["modules"]["items"]
        topic = module["properties"]["topics"]["items"]
        return {"root": COURSE_PLAN_SCHEMA, "module": module, "topic": topic}

    def test_enums_match_the_validator(self):
        topic = self._objects()["topic"]["properties"]
        self.assertEqual(set(topic["difficulty"]["enum"]), set(ALLOWED_DIFFICULTY))
        self.assertEqual(
            set(topic["theory_practice_balance"]["enum"]), set(ALLOWED_BALANCE)
        )
        self.assertEqual(set(topic["review_strategy"]["enum"]), set(ALLOWED_REVIEW))

    def test_fields_match_the_parser(self):
        objects = self._objects()
        self.assertEqual(set(objects["root"]["properties"]), _ROOT_FIELDS)
        self.assertEqual(set(objects["module"]["properties"]), _MODULE_FIELDS)
        self.assertEqual(set(objects["topic"]["properties"]), _TOPIC_FIELDS)

    def test_every_object_is_closed_and_fully_required(self):
        # Требование strict-режима: `additionalProperties: false` и `required`,
        # перечисляющий ВСЕ ключи. Необязательное поле провайдер не примет.
        for name, node in self._objects().items():
            with self.subTest(node=name):
                self.assertFalse(node["additionalProperties"])
                self.assertEqual(set(node["required"]), set(node["properties"]))

    def test_schema_is_json_serializable(self):
        # Схема уходит в тело HTTP-запроса: несериализуемый узел (frozenset из
        # валидатора вместо списка) сломал бы вызов уже в проде.
        json.dumps(COURSE_PLAN_SCHEMA)


class GroupingRegressionTests(SimpleTestCase):
    """Планировщик не должен переписывать оглавление в модули.

    Регресс снят с живого прогона: по «Механике» Мякишева модель вернула 38
    модулей ровно по одной теме, и каждое название совпадало с разделом книги.
    Формально план был безупречен — ссылки на месте, циклов нет, enum'ы верные.
    Именно поэтому нужны отдельные метрики: без них такой результат проходит
    валидацию молча.
    """

    def _book_request(self, chapters: int = 4, per_chapter: int = 5):
        """Книга из глав, у каждой несколько параграфов."""
        toc: list[TocEntry] = []
        sections: list[str] = []
        for chapter in range(1, chapters + 1):
            chapter_path = f"Глава {chapter}"
            toc.append(
                TocEntry(
                    path=chapter_path,
                    title=f"Глава {chapter}. Механика",
                    page_start=chapter * 10,
                    page_end=chapter * 10 + 9,
                    level=2,
                    role="chapter",
                    section_id=f"s-ch{chapter}",
                )
            )
            sections.append(f"s-ch{chapter}")
            for item in range(1, per_chapter + 1):
                section_id = f"s-{chapter}-{item}"
                toc.append(
                    TocEntry(
                        path=f"§ {chapter}.{item}",
                        title=f"Параграф {chapter}.{item}",
                        page_start=chapter * 10 + item,
                        page_end=chapter * 10 + item,
                        level=3,
                        role="section",
                        parent_path=chapter_path,
                        section_id=section_id,
                    )
                )
                sections.append(section_id)
        return make_request(
            toc=tuple(toc), available_section_ids=tuple(sections)
        )

    def test_fake_planner_groups_sections_under_chapters(self):
        """Опора теста: группировка по уровню, а не по точкам в пути.

        Пути теперь несут номер из книги («§ 1.14»), и вложенность из них не
        читается — раньше fake резал именно по точкам.
        """
        request = self._book_request()
        plan = FakeCoursePlanningProvider().generate_plan(request, RetrievalBundle())

        self.assertEqual(len(plan.modules), 4)
        self.assertTrue(all(len(m.topics) == 5 for m in plan.modules), plan.modules)

    def test_single_topic_modules_are_reported(self):
        request = self._book_request()
        payload = {
            "title": "Курс",
            "objective": "Цель",
            "modules": [
                {
                    "external_id": f"m{i}",
                    "title": f"Параграф 1.{i}",
                    "objective": "Освоить",
                    "topics": [
                        {
                            "external_id": f"t{i}",
                            "title": f"Параграф 1.{i}",
                            "objective": "Понять",
                            "estimated_minutes": 45,
                            "difficulty": "medium",
                            "theory_practice_balance": "balanced",
                            "prerequisites": [],
                            "source_chunk_ids": [],
                            "source_section_ids": [f"s-1-{i}"],
                        }
                    ],
                }
                for i in range(1, 6)
            ],
        }
        report = validate_plan(parse_planning_response(json.dumps(payload)), request)

        codes = {issue.code for issue in report.issues}
        self.assertIn("modules_are_single_topics", codes)
        self.assertIn("titles_copied_from_book", codes)
        self.assertEqual(report.single_topic_module_ratio, 1.0)
        self.assertEqual(report.copied_title_ratio, 1.0)
        # Это предупреждения, а не блокеры: бывают книги, где глава равна теме.
        self.assertTrue(report.is_valid, report.blockers)

    def test_grouped_plan_is_not_flagged(self):
        request = self._book_request()
        payload = {
            "title": "Курс",
            "objective": "Цель",
            "modules": [
                {
                    "external_id": "m1",
                    "title": "Кинематика прямолинейного движения",
                    "objective": "Освоить",
                    "topics": [
                        {
                            "external_id": "t1",
                            "title": "Скорость и её измерение",
                            "objective": "Понять",
                            "estimated_minutes": 45,
                            "difficulty": "medium",
                            "theory_practice_balance": "balanced",
                            "prerequisites": [],
                            "source_chunk_ids": [],
                            # Тема собрана из трёх параграфов — ровно то, ради
                            # чего затевалась группировка.
                            "source_section_ids": ["s-1-1", "s-1-2", "s-1-3"],
                        },
                        {
                            "external_id": "t2",
                            "title": "Ускорение",
                            "objective": "Понять",
                            "estimated_minutes": 45,
                            "difficulty": "medium",
                            "theory_practice_balance": "balanced",
                            "prerequisites": ["t1"],
                            "source_chunk_ids": [],
                            "source_section_ids": ["s-1-4", "s-1-5"],
                        },
                    ],
                }
            ],
        }
        report = validate_plan(parse_planning_response(json.dumps(payload)), request)

        codes = {issue.code for issue in report.issues}
        self.assertNotIn("modules_are_single_topics", codes)
        self.assertNotIn("titles_copied_from_book", codes)
        self.assertTrue(report.is_valid, report.blockers)

    def test_unknown_source_section_is_a_blocker(self):
        request = self._book_request()
        payload = {
            "title": "Курс",
            "objective": "Цель",
            "modules": [
                {
                    "external_id": "m1",
                    "title": "Модуль",
                    "objective": "Освоить",
                    "topics": [
                        {
                            "external_id": "t1",
                            "title": "Тема",
                            "objective": "Понять",
                            "estimated_minutes": 45,
                            "difficulty": "medium",
                            "theory_practice_balance": "balanced",
                            "prerequisites": [],
                            "source_chunk_ids": [],
                            "source_section_ids": ["выдуманный-раздел"],
                        }
                    ],
                }
            ],
        }
        report = validate_plan(parse_planning_response(json.dumps(payload)), request)

        self.assertIn(
            "unknown_source_section", {issue.code for issue in report.blockers}
        )

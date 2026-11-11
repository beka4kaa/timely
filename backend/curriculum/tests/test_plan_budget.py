"""Программа резервирует свою цену раньше разбора глав (решение 14).

Порядок в `generate_plan`: сначала резерв самой программы (планировщик и
проверка), потом разбор ещё не разобранных разделов, сколько поместится в
остаток. Так параллельный чат не оставит ученика с оплаченным
разбором и без программы. Не помещается даже программа, тогда не запускается
ничего.

Фейки здесь с ценой: планировщик 1000, проверка 500, разбор 400 на раздел.
Программа стоит 1000 + 500 = 1500. Починка, если случится, идёт под той же
предоплатой и сверх неё не тормозится. Код в `profile()` идёт в потоке пула и
к базе не ходит: под `TestCase` SQLite не пускает туда второе соединение
(R-U5-2). Настоящую запись расхода из потоков проверяет `test_plan_budget_pg`
на Postgres.
"""

from __future__ import annotations

import os
import threading
import time
import uuid
from datetime import datetime
from types import SimpleNamespace
from unittest import mock, skipUnless

from django.db import connection
from django.test import SimpleTestCase, TestCase, override_settings

from ai_engine import usage as usage_module
from ai_engine.models import AIUsageEvent, AIUsageQuotaState
from ai_engine.usage import (
    AIUsageLimitExceeded,
    UsageReservation,
    build_usage_summary,
    current_usage_context,
    provider_call_reservation,
    provider_call_token_estimate,
    record_model_usage,
    reserve_usage_capacity,
    usage_scope,
)
from curriculum.models import CoursePlan, SectionProfile
from curriculum.planning import providers as planning_providers
from curriculum.planning.enrichment import (
    ChapterEnrichment,
    ChapterRequest,
    FakeChapterEnrichmentProvider,
    OpenRouterChapterEnrichmentProvider,
)
from curriculum.planning.providers import (
    PLAN_REVIEW_PLAN_TOKENS,
    FakeCoursePlanningProvider,
    FakeCourseReviewProvider,
    OpenRouterCoursePlanningProvider,
    OpenRouterCourseReviewProvider,
    SkeletonCoursePlanningProvider,
)
from curriculum.planning.structure import build_skeleton
from curriculum.profiles.contracts import ProfilingRequest
from curriculum.profiles.providers import (
    FakeSectionProfilingProvider,
    OpenRouterSectionProfilingProvider,
)
from curriculum.retrieval import RetrievalBundle
from curriculum.services import goals as goals_service
from curriculum.services import plans as plans_service
from curriculum.services import section_profiles as section_profiles_module
from curriculum.services.section_profiles import plan_section_profiling
from curriculum.tests.test_planning import make_request
from curriculum.tests.test_section_profiles import chunk, section
from curriculum.tests.test_services import EMAIL, _PlanBase

PLANNER_PRICE = 1000
REVIEW_PRICE = 500
SECTION_PRICE = 400
# Решение 14: планировщик и проверка. Починку резерв не считает.
PROGRAM_PRICE = PLANNER_PRICE + REVIEW_PRICE


def _limits(tokens: int) -> dict:
    return {"free": {"context": tokens, "five_hour": tokens, "weekly": tokens}}


def _spend(tokens: int) -> None:
    """Расход ученика мимо программы, например чат."""
    AIUsageEvent.objects.create(
        user_email=EMAIL,
        model_name="chat",
        feature="chat",
        total_tokens=tokens,
        billable_tokens=tokens,
    )


def _live_reservations() -> dict:
    state = AIUsageQuotaState.objects.filter(user_email=EMAIL).first()
    return state.reservations if state is not None else {}


def _add_sections(document) -> None:
    """У учебника из фикстуры меньше трёх разделов для разбора: добавляем главы."""
    for index, title in enumerate(("Энергия", "Импульс", "Колебания"), start=1):
        added = section(
            document,
            path=f"9.{index}",
            title=title,
            level=2,
            start=10 + index,
            end=10 + index,
        )
        chunk(
            document,
            added,
            text=f"{title}: определение, закон и пример.",
            content_hash=f"{index:064d}",
        )


class PricedPlanner(FakeCoursePlanningProvider):
    """Планировщик-фейк, который стоит 1000 за вызов."""

    def __init__(self):
        super().__init__()
        self.calls = 0

    def estimate_tokens(self, request, context):
        return PLANNER_PRICE

    def generate_plan(self, request, context):
        self.calls += 1
        return super().generate_plan(request, context)


class PricedReviewer(FakeCourseReviewProvider):
    def estimate_tokens(self, context):
        return REVIEW_PRICE


class PricedProfiler(FakeSectionProfilingProvider):
    """Разбор-фейк по 400 за раздел. В потоке пула к базе не ходит."""

    def __init__(self):
        self.calls: list[str] = []

    def estimate_tokens(self, request):
        return SECTION_PRICE

    def profile(self, request):
        self.calls.append(request.section_id)
        return super().profile(request)


class PlanBudgetTests(_PlanBase):
    def setUp(self):
        super().setUp()
        _add_sections(self.document)

    def _priced(self, **kwargs):
        kwargs.setdefault("planning_provider", PricedPlanner())
        kwargs.setdefault("review_provider", PricedReviewer())
        kwargs.setdefault("profiling_provider", PricedProfiler())
        return self._generate(**kwargs)

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True, AI_PLAN_LIMITS=_limits(3000))
    def test_nothing_starts_when_the_program_does_not_fit(self):
        # Свободно 1000 из нужных программе 1500.
        _spend(2000)
        planner, profiler = PricedPlanner(), PricedProfiler()

        with self.assertRaises(AIUsageLimitExceeded):
            self._priced(planning_provider=planner, profiling_provider=profiler)

        self.assertEqual(planner.calls, 0)
        self.assertEqual(profiler.calls, [])
        self.assertFalse(CoursePlan.objects.exists())
        self.assertEqual(_live_reservations(), {})

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True, AI_PLAN_LIMITS=_limits(1200))
    def test_a_program_larger_than_the_window_says_so(self):
        # Окно 1200, программа стоит 1500: ждать восстановления лимита незачем.
        planner, profiler = PricedPlanner(), PricedProfiler()

        with self.assertRaises(plans_service.PlanDoesNotFitLimit) as ctx:
            self._priced(planning_provider=planner, profiling_provider=profiler)

        self.assertEqual(ctx.exception.code, "plan_exceeds_window")
        self.assertEqual(
            ctx.exception.message,
            "Программа по этой книге не помещается в лимит твоего тарифа, "
            "даже когда он полностью свободен.",
        )
        self.assertEqual(planner.calls, 0)
        self.assertEqual(profiler.calls, [])
        self.assertEqual(_live_reservations(), {})

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        AI_PLAN_LIMITS=_limits(PROGRAM_PRICE + SECTION_PRICE // 2),
    )
    def test_program_is_reserved_before_profiling(self):
        # Свободно 1700: программа помещается, на раздел (400) не остаётся.
        planner, profiler = PricedPlanner(), PricedProfiler()

        outcome = self._priced(planning_provider=planner, profiling_provider=profiler)

        self.assertIsNotNone(outcome.plan)
        self.assertEqual(planner.calls, 1)
        self.assertEqual(profiler.calls, [])
        self.assertIn("plan_profiling_skipped", outcome.warnings)
        outcome.plan.refresh_from_db()
        self.assertEqual(outcome.plan.generation_warnings, ["plan_profiling_skipped"])

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        AI_PLAN_LIMITS=_limits(PROGRAM_PRICE + 2 * SECTION_PRICE),
    )
    def test_profiling_takes_only_what_fits(self):
        items = plan_section_profiling(self.document, provider=PricedProfiler()).items
        self.assertGreaterEqual(len(items), 3)
        profiler = PricedProfiler()

        outcome = self._priced(profiling_provider=profiler)

        self.assertEqual(
            sorted(profiler.calls), sorted(str(item[0].pk) for item in items[:2])
        )
        self.assertEqual(SectionProfile.objects.filter(document=self.document).count(), 2)
        self.assertIn("plan_profiling_partial", outcome.warnings)
        outcome.plan.refresh_from_db()
        self.assertEqual(outcome.plan.generation_warnings, ["plan_profiling_partial"])
        self.assertEqual(_live_reservations(), {})

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        AI_PLAN_LIMITS={"free": {"context": 100000, "five_hour": 100000, "weekly": 100000}},
    )
    def test_profiling_threads_draw_on_the_profiling_reserve(self):
        # Review Focus 3: потоки пула тратят резерв разбора и сверх него не берут.
        class Probe(FakeSectionProfilingProvider):
            def __init__(self):
                self.seen = []

            def estimate_tokens(self, request):
                return 400

            def profile(self, request):
                with usage_scope(feature="section_profiling"):
                    with provider_call_reservation(
                        input_payload={"payload": request.context},
                        max_output_tokens=10,
                        feature="section_profiling",
                    ) as reservation:
                        self.seen.append(
                            (
                                threading.get_ident(),
                                reservation,
                                current_usage_context().user_email,
                            )
                        )
                return super().profile(request)

        probe = Probe()
        planner, reviewer = PricedPlanner(), PricedReviewer()
        expected = len(plan_section_profiling(self.document, provider=probe).items)
        self.assertGreaterEqual(expected, 3)
        main = threading.get_ident()
        real = usage_module.reserve_usage_capacity
        from_threads = []

        def spy(*args, **kwargs):
            if threading.get_ident() != main:
                from_threads.append(kwargs.get("feature"))
                return UsageReservation()  # из потока пула в базу не ходим
            return real(*args, **kwargs)

        with mock.patch("ai_engine.usage.reserve_usage_capacity", side_effect=spy):
            outcome = self._generate(
                planning_provider=planner, review_provider=reviewer, profiling_provider=probe
            )

        self.assertIsNotNone(outcome.plan)
        self.assertEqual(len(probe.seen), expected)
        self.assertNotIn(main, {thread for thread, _, _ in probe.seen})
        self.assertEqual(from_threads, [])
        reservations = [reservation for _, reservation, _ in probe.seen]
        self.assertEqual(len({reservation.key for reservation in reservations}), 1)
        for reservation in reservations:
            self.assertTrue(reservation.active)
            # Резерв разбора: у резерва программы 1500.
            self.assertEqual(reservation.reserved_tokens, 400 * expected)
            self.assertEqual(reservation.user_email, EMAIL)
        # Эту почту `record_model_usage` пишет в `AIUsageEvent.user_email`.
        self.assertEqual({email for _, _, email in probe.seen}, {EMAIL})
        self.assertEqual(AIUsageQuotaState.objects.get(user_email=EMAIL).reservations, {})

    @override_settings(CURRICULUM_PLAN_PROFILING_SECONDS=0)
    def test_profiling_stops_starting_sections_after_its_time(self):
        profiler = PricedProfiler()

        outcome = self._priced(profiling_provider=profiler)

        self.assertEqual(profiler.calls, [])
        self.assertIsNotNone(outcome.plan)
        self.assertIn("plan_profiling_skipped", outcome.warnings)

    def test_second_plan_does_not_pay_for_profiles_again(self):
        first = PricedProfiler()
        self._priced(profiling_provider=first)
        self.assertGreaterEqual(len(first.calls), 3)

        second = PricedProfiler()
        outcome = self._priced(profiling_provider=second)

        self.assertEqual(second.calls, [])
        self.assertNotIn("plan_profiling_skipped", outcome.warnings)
        self.assertNotIn("plan_profiling_partial", outcome.warnings)
        self.assertEqual(outcome.plan.generation_warnings, [])

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        AI_PLAN_LIMITS=_limits(PROGRAM_PRICE),
    )
    def test_parallel_chat_does_not_leave_the_student_without_a_program(self):
        # Окно 1500 вмещает ровно программу (1000 + 500), на разбор места нет.
        seen = []

        class ChatDuringPlanning(PricedPlanner):
            def generate_plan(self, request, context):
                if not seen:
                    try:
                        reserve_usage_capacity(EMAIL, reserved_tokens=1, feature="chat")
                        seen.append("granted")
                    except AIUsageLimitExceeded:
                        seen.append("denied")
                    # Чат выбрал окно целиком. Без предоплаты программы вызов
                    # ниже получил бы отказ: 1500 + 1500 + 758 > 1500.
                    AIUsageEvent.objects.create(
                        user_email=EMAIL,
                        model_name="chat",
                        feature="chat",
                        total_tokens=PROGRAM_PRICE,
                        billable_tokens=PROGRAM_PRICE,
                    )
                    with provider_call_reservation(input_payload="x", max_output_tokens=500):
                        pass
                return super().generate_plan(request, context)

        outcome = self._generate(
            planning_provider=ChatDuringPlanning(),
            review_provider=PricedReviewer(),
            profiling_provider=PricedProfiler(),
        )

        self.assertEqual(seen, ["denied"])
        self.assertIsNotNone(outcome.plan)
        self.assertEqual(AIUsageQuotaState.objects.get(user_email=EMAIL).reservations, {})

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        AI_PLAN_LIMITS={"free": {"context": 100000, "five_hour": 100000, "weekly": 100000}},
    )
    def test_plan_reserve_lives_only_as_long_as_the_request(self):
        created = {}
        original_save = AIUsageQuotaState.save

        def recording_save(state, *args, **kwargs):
            # Новый резерв попадает в строку квоты через save: запоминаем его при первом появлении.
            for key, value in (state.reservations or {}).items():
                created.setdefault(key, dict(value))
            return original_save(state, *args, **kwargs)

        started = time.time()
        with mock.patch.object(AIUsageQuotaState, "save", recording_save):
            outcome = self._generate(
                planning_provider=PricedPlanner(),
                review_provider=PricedReviewer(),
                profiling_provider=PricedProfiler(),
            )

        self.assertIsNotNone(outcome.plan)
        self.assertEqual(
            sorted(value["feature"] for value in created.values()),
            ["curriculum_plan", "curriculum_section_profiling"],
        )
        ttl = plans_service._plan_deadline_seconds() + plans_service.PLAN_RESERVE_GRACE_SECONDS
        for value in created.values():
            self.assertGreaterEqual(value["expires_at"], started + ttl - 1)
            self.assertLessEqual(value["expires_at"], started + ttl + 30)
        self.assertEqual(AIUsageQuotaState.objects.get(user_email=EMAIL).reservations, {})

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True, AI_PLAN_LIMITS=_limits(100_000))
    def test_program_reserve_is_the_planner_and_the_review(self):
        # Резерв программы P + R, без запаса на починку.
        seen = []

        class Peeking(PricedPlanner):
            def generate_plan(self, request, context):
                state = AIUsageQuotaState.objects.get(user_email=EMAIL)
                seen.extend(
                    claim["tokens"]
                    for claim in state.reservations.values()
                    if claim["feature"] == "curriculum_plan"
                )
                return super().generate_plan(request, context)

        self._priced(planning_provider=Peeking())

        self.assertEqual(seen, [PLANNER_PRICE + REVIEW_PRICE])

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True, AI_PLAN_LIMITS=_limits(PROGRAM_PRICE))
    def test_repair_runs_on_the_spent_program_reserve_and_is_recorded(self):
        # Окно 1500 вмещает ровно программу. Первая попытка выбирает её резерв
        # до нуля и не проходит проверку. Починка идёт под той же предоплатой и
        # не получает отказа, а перерасход окна виден в учёте, как у
        # распознавания (13.2).
        spent = {1: PROGRAM_PRICE, 2: 700}
        before_repair = []

        class RepairedOnTheSpentReserve(PricedPlanner):
            def generate_plan(self, request, context):
                attempt = self.calls + 1
                if attempt == 2:
                    state = AIUsageQuotaState.objects.get(user_email=EMAIL)
                    before_repair.append(dict(state.reservations))
                # Как настоящий провайдер: бронь вызова и запись расхода.
                with usage_scope(feature="course_planning"):
                    with provider_call_reservation(
                        input_payload={"fix_these_issues": list(request.repair_issues)},
                        max_output_tokens=500,
                        feature="course_planning",
                    ):
                        record_model_usage(
                            SimpleNamespace(
                                id=f"plan-{attempt}",
                                model="m",
                                usage={"total_tokens": spent[attempt]},
                            ),
                            model="m",
                            provider="p",
                            feature="course_planning",
                        )
                plan = super().generate_plan(request, context)
                if attempt == 1:
                    # Блокер валидатора: у темы нет цели.
                    plan.modules[0].topics[0].objective = ""
                return plan

        planner = RepairedOnTheSpentReserve()

        outcome = self._priced(planning_provider=planner)

        self.assertEqual(planner.calls, 2)
        self.assertIsNotNone(outcome.plan)
        self.assertIn("plan_repaired_after_validation", outcome.warnings)
        # К началу починки резерв программы выбран до нуля, других броней нет.
        self.assertEqual(before_repair, [{}])
        events = AIUsageEvent.objects.filter(feature="course_planning").order_by(
            "request_id"
        )
        self.assertEqual(
            [(event.request_id, event.billable_tokens, event.user_email) for event in events],
            [("plan-1", PROGRAM_PRICE, EMAIL), ("plan-2", 700, EMAIL)],
        )
        # Перерасход учтён в конце: окно показывает больше лимита.
        self.assertEqual(
            build_usage_summary(EMAIL)["windows"]["five_hour"]["used"],
            PROGRAM_PRICE + 700,
        )
        self.assertEqual(_live_reservations(), {})

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        AI_PLAN_LIMITS=_limits(PROGRAM_PRICE + 2 * SECTION_PRICE),
    )
    def test_refused_profiling_reserve_is_retried_once_with_what_is_left(self):
        items = plan_section_profiling(self.document, provider=PricedProfiler()).items
        asked = []
        real = plans_service.reserve_usage_capacity

        def racing(email, *, reserved_tokens, feature="unknown", **kwargs):
            if feature == "curriculum_section_profiling":
                asked.append(reserved_tokens)
                if len(asked) == 1:
                    # Остаток прочитан без блокировки, а чат успел потратить 400.
                    _spend(SECTION_PRICE)
            return real(email, reserved_tokens=reserved_tokens, feature=feature, **kwargs)

        profiler = PricedProfiler()
        with mock.patch.object(plans_service, "reserve_usage_capacity", side_effect=racing):
            outcome = self._priced(profiling_provider=profiler)

        self.assertEqual(asked, [2 * SECTION_PRICE, SECTION_PRICE])
        self.assertEqual(profiler.calls, [str(items[0][0].pk)])
        self.assertIn("plan_profiling_partial", outcome.warnings)
        self.assertEqual(_live_reservations(), {})

    @override_settings(
        AI_USAGE_ENFORCE_LIMITS=True,
        AI_PLAN_LIMITS=_limits(PROGRAM_PRICE + 2 * SECTION_PRICE),
    )
    def test_second_refusal_of_the_profiling_reserve_skips_profiling(self):
        asked = []
        real = plans_service.reserve_usage_capacity

        def refusing(email, *, reserved_tokens, feature="unknown", **kwargs):
            if feature == "curriculum_section_profiling":
                asked.append(reserved_tokens)
                # Остаток по-прежнему есть, но резерв каждый раз проигрывает гонку.
                raise AIUsageLimitExceeded(
                    window="five_hour", reset_at="2026-11-10T20:00:00Z"
                )
            return real(email, reserved_tokens=reserved_tokens, feature=feature, **kwargs)

        profiler = PricedProfiler()
        with mock.patch.object(plans_service, "reserve_usage_capacity", side_effect=refusing):
            outcome = self._priced(profiling_provider=profiler)

        # Ровно одна повторная попытка.
        self.assertEqual(asked, [2 * SECTION_PRICE, 2 * SECTION_PRICE])
        self.assertEqual(profiler.calls, [])
        self.assertIsNotNone(outcome.plan)
        self.assertIn("plan_profiling_skipped", outcome.warnings)
        self.assertEqual(_live_reservations(), {})

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True, AI_PLAN_LIMITS=_limits(2000))
    def test_refused_program_shows_when_live_claims_let_go(self):
        # Окно пустое, но чужая бронь держит 1000 из 2000 ещё 600 с, и
        # программе (1500) не хватает места.
        claim = reserve_usage_capacity(
            EMAIL, reserved_tokens=1000, feature="chat", ttl_seconds=600
        )
        expires_at = _live_reservations()[claim.key]["expires_at"]
        planner = PricedPlanner()

        with self.assertRaises(AIUsageLimitExceeded) as ctx:
            self._priced(planning_provider=planner)

        self.assertTrue(ctx.exception.reset_at.endswith("Z"), ctx.exception.reset_at)
        reset_at = datetime.fromisoformat(ctx.exception.reset_at)
        # Не сброс окна через 5 часов, а конец мешающей брони.
        self.assertAlmostEqual(reset_at.timestamp(), expires_at, delta=1)
        self.assertEqual(planner.calls, 0)


    @override_settings(AI_USAGE_ENFORCE_LIMITS=True, AI_PLAN_LIMITS=_limits(PROGRAM_PRICE))
    def test_a_program_as_large_as_the_window_waits_for_it(self):
        # Окно ровно в цену программы: она поместится, когда окно освободится.
        # Это отказ со временем, а не «не помещается никогда».
        _spend(1)

        with self.assertRaises(AIUsageLimitExceeded):
            self._priced()

    def test_without_a_program_estimate_profiling_is_skipped(self):
        # Без цены программы нет её резерва, и разбор занял бы окно раньше неё.
        class Unpriced:
            name = "unpriced"

            def generate_plan(self, request, context):
                return FakeCoursePlanningProvider().generate_plan(request, context)

        profiler = PricedProfiler()

        with self.assertLogs("curriculum.services.plans", level="WARNING"):
            outcome = self._priced(planning_provider=Unpriced(), profiling_provider=profiler)

        self.assertIsNotNone(outcome.plan)
        self.assertEqual(profiler.calls, [])
        self.assertIn("plan_profiling_skipped", outcome.warnings)
        self.assertEqual(_live_reservations(), {})

    @override_settings(AI_USAGE_ENFORCE_LIMITS=True, AI_PLAN_LIMITS=_limits(100_000))
    def test_a_failing_profiling_run_leaves_the_program_without_profiles(self):
        with mock.patch.object(
            plans_service, "run_section_profiling", side_effect=RuntimeError("пул упал")
        ):
            with self.assertLogs("curriculum.services.plans", level="WARNING"):
                outcome = self._priced()

        self.assertIsNotNone(outcome.plan)
        self.assertIn("plan_profiling_skipped", outcome.warnings)
        self.assertEqual(_live_reservations(), {})

    def test_a_failing_profiling_plan_still_says_so(self):
        with mock.patch.object(
            plans_service, "plan_section_profiling", side_effect=RuntimeError("база недоступна")
        ):
            with self.assertLogs("curriculum.services.plans", level="WARNING"):
                outcome = self._priced()

        self.assertIsNotNone(outcome.plan)
        self.assertIn("plan_profiling_skipped", outcome.warnings)

    def test_sections_saved_before_a_failure_still_count(self):
        real_save = section_profiles_module._save
        saved = []

        def save_then_fail(*args, **kwargs):
            if saved:
                raise RuntimeError("запись упала")
            saved.append(args[0].pk)
            return real_save(*args, **kwargs)

        # Один раздел за раз: ошибка записи случается, когда других в работе нет.
        with mock.patch.object(
            section_profiles_module, "_save", side_effect=save_then_fail
        ), mock.patch.object(section_profiles_module, "MAX_CONCURRENCY", 1):
            with self.assertLogs("curriculum.services.plans", level="WARNING"):
                outcome = self._priced()

        self.assertEqual(len(saved), 1)
        self.assertIn("plan_profiling_partial", outcome.warnings)

    def test_the_program_deadline_reaches_the_skeleton(self):
        class Counting(FakeChapterEnrichmentProvider):
            def __init__(self):
                self.calls = []

            def enrich(self, request):
                self.calls.append(request.module.external_id)
                return super().enrich(request)

        enrichment = Counting()
        with mock.patch.object(plans_service, "_plan_deadline_seconds", lambda: 0):
            outcome = self._priced(
                planning_provider=SkeletonCoursePlanningProvider(enrichment_provider=enrichment)
            )

        self.assertIsNotNone(outcome.plan)
        self.assertEqual(enrichment.calls, [])

    def test_a_special_token_in_the_goal_does_not_break_the_program(self):
        # Строка, которую tiktoken считает служебной, встречается в книгах о
        # языковых моделях и в целях, вставленных из них.
        self.goal.original_text = "хочу понять <|endoftext|> в GPT"
        self.goal.save(update_fields=["original_text"])

        with mock.patch.dict(os.environ, {"COURSE_PLANNING_MODEL": "m"}):
            # Ключа модели в тестах нет: главы остаются с текстом скелета.
            with self.assertLogs("curriculum.planning.providers", level="WARNING"):
                outcome = plans_service.generate_plan(
                    self.goal,
                    self.document,
                    review_provider=PricedReviewer(),
                    profiling_provider=PricedProfiler(),
                )

        self.assertIsNotNone(outcome.plan)

    def test_a_special_token_in_a_section_is_estimated_like_any_text(self):
        odd = section(self.document, path="9.9", title="GPT", level=2, start=30, end=31)
        chunk(
            self.document,
            odd,
            text="Конец текста модель видит как <|endoftext|>.",
            content_hash="f" * 64,
        )
        with mock.patch.dict(os.environ, {"SECTION_PROFILING_MODEL": "m"}):
            provider = OpenRouterSectionProfilingProvider()

        work = plan_section_profiling(self.document, provider=provider)

        self.assertIn(odd.pk, [item[0].pk for item in work.items])

    def test_a_fully_cached_book_does_not_read_the_window_for_profiling(self):
        self._priced()

        with mock.patch.object(
            plans_service,
            "available_usage_tokens",
            wraps=usage_module.available_usage_tokens,
        ) as available:
            outcome = self._priced()

        self.assertIsNotNone(outcome.plan)
        available.assert_not_called()

    def test_rebuild_forwards_the_profiling_provider(self):
        with self.settings(CURRICULUM_PLAN_PROFILING_SECONDS=0):
            first = self._priced()
        profiler = PricedProfiler()

        plans_service.rebuild_plan(
            first.plan,
            planning_provider=PricedPlanner(),
            review_provider=PricedReviewer(),
            profiling_provider=profiler,
        )

        self.assertGreaterEqual(len(profiler.calls), 3)


class SkeletonDeadlineTests(SimpleTestCase):
    """Скелет не начинает обогащать новую главу после дедлайна программы."""

    def test_no_new_chapter_starts_after_the_program_deadline(self):
        request = make_request()
        deterministic = build_skeleton(request.toc)
        self.assertGreaterEqual(len(deterministic), 2)

        class SlowChapter:
            name = "slow"

            def __init__(self):
                self.calls = []

            def estimate_tokens(self, chapter):
                return 0

            def enrich(self, chapter):
                self.calls.append(chapter.module.external_id)
                # Глава идёт дольше, чем осталось до дедлайна программы.
                time.sleep(1.2)
                return ChapterEnrichment(objective="Обогащено")

        class OneAtATime(SkeletonCoursePlanningProvider):
            max_concurrency = 1

        enrichment = SlowChapter()
        with planning_providers.plan_deadline(time.monotonic() + 1.0):
            plan = OneAtATime(enrichment_provider=enrichment).generate_plan(
                request, RetrievalBundle()
            )

        self.assertEqual(enrichment.calls, [plan.modules[0].external_id])
        self.assertEqual(plan.modules[0].objective, "Обогащено")
        # Остальные главы остаются с детерминированным текстом скелета.
        self.assertEqual(
            [module.objective for module in plan.modules[1:]],
            [module.objective for module in deterministic[1:]],
        )


ROLES = {
    "COURSE_PLANNING_MODEL": "m",
    "COURSE_PLANNING_MAX_TOKENS": "8000",
    "SECTION_PROFILING_MODEL": "m",
    "SECTION_PROFILING_MAX_TOKENS": "8000",
}


class Trapped(Exception):
    pass


class EstimatesMatchTheirCallsTests(SimpleTestCase):
    """Оценка настоящего провайдера равна цене вызова, который он резервирует."""

    def _trap(self):
        seen = {}

        def trap(**kwargs):
            seen.update(kwargs)
            raise Trapped()

        return seen, mock.patch(
            "ai_engine.usage.provider_call_reservation", side_effect=trap
        )

    def test_enrichment_estimate_is_the_price_of_its_call(self):
        with mock.patch.dict("os.environ", ROLES):
            provider = OpenRouterChapterEnrichmentProvider()
        request = ChapterRequest(
            module=build_skeleton(make_request().toc)[0],
            chapter=None,
            entries_by_section={},
            goal_text="механика",
            current_level="beginner",
        )
        seen, trap = self._trap()

        with trap:
            with self.assertRaises(Trapped):
                provider.enrich(request)

        self.assertEqual(
            provider.estimate_tokens(request),
            provider_call_token_estimate(
                seen["input_payload"], max_output_tokens=seen["max_output_tokens"]
            ),
        )
        self.assertEqual(seen["max_output_tokens"], 8000)

    def test_profiling_estimate_is_the_price_of_its_call(self):
        with mock.patch.dict("os.environ", ROLES):
            provider = OpenRouterSectionProfilingProvider()
        request = ProfilingRequest(
            section_id="s1",
            title="Скорость",
            number_label="§ 1",
            structural_role="section",
            level=3,
            page_start=5,
            page_end=20,
            context="Скорость — путь за единицу времени.",
        )
        seen, trap = self._trap()

        with trap:
            with self.assertRaises(Trapped):
                provider.profile(request)

        self.assertEqual(
            provider.estimate_tokens(request),
            provider_call_token_estimate(
                seen["input_payload"], max_output_tokens=seen["max_output_tokens"]
            ),
        )
        self.assertEqual(seen["max_output_tokens"], 8000)

    def test_planner_estimate_is_the_price_of_its_call(self):
        with mock.patch.dict("os.environ", ROLES):
            provider = OpenRouterCoursePlanningProvider()
        request, bundle = make_request(), RetrievalBundle()
        seen, trap = self._trap()

        with trap:
            with self.assertRaises(Trapped):
                provider.generate_plan(request, bundle)

        self.assertEqual(
            provider.estimate_tokens(request, bundle),
            provider_call_token_estimate(
                seen["input_payload"], max_output_tokens=seen["max_output_tokens"]
            ),
        )
        self.assertEqual(seen["max_output_tokens"], 8000)

    def test_review_estimate_is_its_call_without_the_plan(self):
        with mock.patch.dict(
            "os.environ", {"COURSE_REVIEW_MODEL": "m", "COURSE_REVIEW_MAX_TOKENS": "4000"}
        ):
            provider = OpenRouterCourseReviewProvider()
        plan = FakeCoursePlanningProvider().generate_plan(make_request(), RetrievalBundle())
        bundle = RetrievalBundle()
        seen, trap = self._trap()

        with trap:
            with self.assertRaises(Trapped):
                provider.review_plan(plan, bundle)

        # До программы её нет: та же обёртка, только с пустой программой и
        # постоянной долей за неё.
        call = seen["input_payload"]
        without_plan = {**call, "payload": {**call["payload"], "plan": {}}}
        self.assertEqual(
            provider.estimate_tokens(bundle),
            provider_call_token_estimate(
                without_plan, max_output_tokens=seen["max_output_tokens"]
            )
            + PLAN_REVIEW_PLAN_TOKENS,
        )
        self.assertEqual(seen["max_output_tokens"], 4000)

    def test_skeleton_estimate_sums_its_chapters(self):
        class Stub:
            name = "stub"

            def estimate_tokens(self, request):
                return 10

            def enrich(self, request):
                raise AssertionError("оценка не вызывает модель")

        request = make_request()
        chapters = len(build_skeleton(request.toc))

        self.assertGreater(chapters, 0)
        self.assertEqual(
            SkeletonCoursePlanningProvider(enrichment_provider=Stub()).estimate_tokens(
                request, RetrievalBundle()
            ),
            10 * chapters,
        )


class ProfilingCallTimeoutTests(SimpleTestCase):
    """Начатый вызов разбора не обрывается окном разбора: таймаут его роли.

    Окно разбора решает только, какие разделы ещё стартуют. Начатый раздел
    дочитывается: его профиль оплачен, и бросить его значило бы заплатить за
    него снова.
    """

    def _timeout(self, *, role_timeout: str) -> int:
        with mock.patch.dict(
            "os.environ",
            {"SECTION_PROFILING_MODEL": "m", "SECTION_PROFILING_TIMEOUT": role_timeout},
        ):
            provider = OpenRouterSectionProfilingProvider()
        request = ProfilingRequest(
            section_id="s1",
            title="Скорость",
            number_label="§ 1",
            structural_role="section",
            level=3,
            page_start=5,
            page_end=20,
            context="Скорость — путь за единицу времени.",
        )
        with mock.patch("ai_engine.text_llm.TextModel") as model:
            model.return_value.generate_json_content.return_value = SimpleNamespace(
                text="{}"
            )
            provider.profile(request)
        return model.return_value.generate_json_content.call_args.kwargs["timeout"]

    @override_settings(CURRICULUM_PLAN_PROFILING_SECONDS=60)
    def test_a_started_profiling_call_keeps_its_role_timeout(self):
        self.assertEqual(self._timeout(role_timeout="180"), 180)


@skipUnless(connection.vendor == "postgresql", "нужен Postgres")
class GenerationWarningsColumnDefaultTests(TestCase):
    """Миграцию применяет новый веб-контейнер, пока старый ещё создаёт программы."""

    def test_old_code_insert_without_generation_warnings_gets_an_empty_list(self):
        goal = goals_service.create_goal(user_email=EMAIL, original_text="механика")
        plan_id = uuid.uuid4()
        table = connection.ops.quote_name(CoursePlan._meta.db_table)
        # Ровно те колонки, что пишет ORM старого кода: о предупреждениях он не знает.
        with connection.cursor() as cursor:
            cursor.execute(
                f"""
                INSERT INTO {table} (
                    id, created_at, updated_at, user_email, goal_id, document_id,
                    material_id, title, objective, current_level, target_level,
                    language, estimated_total_minutes, recommended_sessions_per_week,
                    recommended_session_minutes, forecast_finish_date, forecast,
                    status, generation_model, reviewer_model,
                    generation_prompt_version, review_prompt_version,
                    source_processing_version, schema_version, approved_at,
                    current_version
                ) VALUES (
                    %s, now(), now(), %s, %s, NULL,
                    NULL, 'Программа', '', '', '',
                    'ru', 0, 3,
                    40, NULL, '{{}}',
                    'draft', '', '',
                    '', '',
                    '', '1.0.0', NULL,
                    0
                )
                """,
                [str(plan_id), EMAIL, str(goal.pk)],
            )

        self.assertEqual(CoursePlan.objects.get(pk=plan_id).generation_warnings, [])

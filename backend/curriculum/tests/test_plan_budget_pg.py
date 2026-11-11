"""Разбор глав, когда потоки пула пишут в базу: Review Focus 3 и поздние разделы.

Только на Postgres и в `TransactionTestCase`: поток пула пишет своим
соединением и видит только зафиксированные строки, как на сервере. Под
`TestCase` SQLite не пускает такую запись (блокировка таблицы), а на Postgres
она ушла бы мимо отката теста. Поэтому в `test_plan_budget` код в `profile()`
к базе не ходит (R-U5-2), а здесь ходит. Каждый поток, который тронул базу,
закрывает своё соединение, иначе база теста не уйдёт чисто.
"""

from __future__ import annotations

import os
import threading
import time
from types import SimpleNamespace
from unittest import mock, skipUnless

from django.db import connection
from django.test import TransactionTestCase, override_settings

from ai_engine import text_llm
from ai_engine import usage as usage_module
from ai_engine.models import AIUsageEvent, AIUsageQuotaState
from ai_engine.usage import (
    build_usage_summary,
    provider_call_reservation,
    record_model_usage,
    release_usage_reservation,
    reserve_usage_capacity,
    usage_scope,
)
from curriculum.models import SectionProfile
from curriculum.profiles.contracts import ProfilingRequest
from curriculum.profiles.providers import OpenRouterSectionProfilingProvider
from curriculum.services import section_profiles as section_profiles_module
from curriculum.services.section_profiles import plan_section_profiling
from curriculum.tests.test_plan_budget import (
    PROGRAM_PRICE,
    SECTION_PRICE,
    PricedPlanner,
    PricedProfiler,
    PricedReviewer,
    _add_sections,
    _limits,
)
from curriculum.tests.test_services import EMAIL, PlanFixtures

# Столько пишет каждый вызов разбора в этих тестах.
SECTION_SPENT = 300
ONLY_POSTGRES = "нужен Postgres: под SQLite запись из потока пула упирается в блокировку таблицы"


def _live_reservations() -> dict:
    state = AIUsageQuotaState.objects.filter(user_email=EMAIL).first()
    return state.reservations if state is not None else {}


def _spend_in_this_thread(request: ProfilingRequest) -> None:
    """Расход раздела, как у настоящего вызова: бронь вызова и запись в журнал."""
    with usage_scope(feature="section_profiling"):
        with provider_call_reservation(
            input_payload={"payload": request.context},
            max_output_tokens=10,
            feature="section_profiling",
        ):
            record_model_usage(
                SimpleNamespace(
                    id=f"profile-{request.section_id}",
                    model="m",
                    usage={"total_tokens": SECTION_SPENT},
                ),
                model="m",
                provider="p",
                feature="section_profiling",
            )


@skipUnless(connection.vendor == "postgresql", ONLY_POSTGRES)
@override_settings(AI_USAGE_ENFORCE_LIMITS=True, AI_PLAN_LIMITS=_limits(100_000))
class ProfilingThreadsOnPostgresTests(PlanFixtures, TransactionTestCase):
    def setUp(self):
        super().setUp()
        _add_sections(self.document)

    def test_profiling_threads_write_the_students_usage_and_draw_the_reserve_down(self):
        main = threading.get_ident()
        drawn = []  # (поток, ключ резерва, списано, осталось)
        real_consume = usage_module.consume_usage_reservation

        def consume(reservation, tokens):
            real_consume(reservation, tokens)
            state = AIUsageQuotaState.objects.get(user_email=EMAIL)
            left = (state.reservations.get(reservation.key) or {}).get("tokens")
            drawn.append((threading.get_ident(), reservation.key, tokens, left))

        class Spending(PricedProfiler):
            """Каждый раздел пишет расход, как настоящий вызов модели."""

            def profile(self, request):
                try:
                    _spend_in_this_thread(request)
                    return super().profile(request)
                finally:
                    connection.close()

        probe = Spending()
        expected = len(plan_section_profiling(self.document, provider=probe).items)
        self.assertGreaterEqual(expected, 3)

        with mock.patch("ai_engine.usage.consume_usage_reservation", side_effect=consume):
            outcome = self._generate(
                planning_provider=PricedPlanner(),
                review_provider=PricedReviewer(),
                profiling_provider=probe,
            )

        self.assertIsNotNone(outcome.plan)
        events = AIUsageEvent.objects.filter(feature="section_profiling")
        self.assertEqual(events.count(), expected)
        self.assertEqual(set(events.values_list("user_email", flat=True)), {EMAIL})
        self.assertEqual(len(drawn), expected)
        self.assertNotIn(main, {thread for thread, _, _, _ in drawn})
        self.assertEqual(len({key for _, key, _, _ in drawn}), 1)
        # Резерв разбора 400 на раздел, каждый раздел списал 300.
        self.assertEqual(
            min(left for _, _, _, left in drawn),
            (SECTION_PRICE - SECTION_SPENT) * expected,
        )
        self.assertEqual(AIUsageQuotaState.objects.get(user_email=EMAIL).reservations, {})


@skipUnless(connection.vendor == "postgresql", ONLY_POSTGRES)
@override_settings(AI_USAGE_ENFORCE_LIMITS=True, CURRICULUM_PLAN_PROFILING_SECONDS=1)
class LateProfilingSectionTests(PlanFixtures, TransactionTestCase):
    """Начатый раздел не бросается: досчитавшись после программы, он сохраняет себя сам."""

    def setUp(self):
        super().setUp()
        _add_sections(self.document)

    def _plan_with_a_late_section(self):
        """Программа, у которой один раздел досчитывается позже, чем она ждёт.

        Остальные разделы быстрые. Медленный ждёт `proceed`, а тест отпускает
        его только после того, как программа вернулась.
        """
        items = plan_section_profiling(self.document, provider=PricedProfiler()).items
        self.assertGreaterEqual(len(items), 3)
        slow_id = str(items[0][0].pk)
        proceed = threading.Event()

        class OneSlowSection(PricedProfiler):
            def profile(self, request):
                try:
                    if request.section_id == slow_id:
                        proceed.wait(timeout=20)
                    _spend_in_this_thread(request)
                    return super().profile(request)
                finally:
                    connection.close()

        # Окно вмещает программу и резерв на все разделы, и не больше. Оно
        # действует до конца теста: после программы его делит чат.
        window = PROGRAM_PRICE + SECTION_PRICE * len(items)
        self.enterContext(self.settings(AI_PLAN_LIMITS=_limits(window)))
        try:
            with mock.patch.object(
                section_profiles_module, "LATE_RESULT_GRACE_SECONDS", 0.2
            ):
                outcome = self._generate(
                    planning_provider=PricedPlanner(),
                    review_provider=PricedReviewer(),
                    profiling_provider=OneSlowSection(),
                )
        except BaseException:
            proceed.set()
            raise
        return outcome, items, slow_id, proceed, window

    def _wait_for_the_late_profile(self, section_id: str) -> None:
        deadline = time.monotonic() + 15
        while not SectionProfile.objects.filter(section_id=section_id).exists():
            self.assertLess(time.monotonic(), deadline, "поздний профиль так и не сохранился")
            time.sleep(0.05)

    def test_a_late_section_saves_itself_and_draws_the_reserve_left_for_it(self):
        outcome, items, slow_id, proceed, window = self._plan_with_a_late_section()
        try:
            self.assertIsNotNone(outcome.plan)
            # Программа не ждала медленный раздел и не считает его разобранным.
            self.assertIn("plan_profiling_partial", outcome.warnings)
            self.assertFalse(SectionProfile.objects.filter(section_id=slow_id).exists())
            # Резерв разбора ужат до оценки ещё идущего раздела.
            live = list(_live_reservations().values())
            self.assertEqual(
                [(claim["feature"], claim["tokens"]) for claim in live],
                [("curriculum_section_profiling", SECTION_PRICE)],
            )

            # Чат забирает всё, что окно отдаёт, пока раздел ещё идёт.
            free = usage_module.available_usage_tokens(EMAIL)
            chat = reserve_usage_capacity(EMAIL, reserved_tokens=free, feature="chat")
            AIUsageEvent.objects.create(
                user_email=EMAIL,
                model_name="chat",
                feature="chat",
                total_tokens=free,
                billable_tokens=free,
            )
            release_usage_reservation(chat)
        finally:
            proceed.set()

        self._wait_for_the_late_profile(slow_id)
        late = AIUsageEvent.objects.get(request_id=f"profile-{slow_id}")
        self.assertEqual((late.user_email, late.billable_tokens), (EMAIL, SECTION_SPENT))
        # Поздний расход списан из оставленного ему резерва.
        self.assertEqual(
            [claim["tokens"] for claim in _live_reservations().values()],
            [SECTION_PRICE - SECTION_SPENT],
        )
        # И окно не ушло за лимит, хотя чат выбрал всё свободное.
        self.assertLessEqual(build_usage_summary(EMAIL)["windows"]["five_hour"]["used"], window)

    def test_the_next_plan_does_not_pay_for_a_late_saved_profile(self):
        outcome, items, slow_id, proceed, window = self._plan_with_a_late_section()
        proceed.set()
        self._wait_for_the_late_profile(slow_id)

        again = PricedProfiler()
        second = self._generate(
            planning_provider=PricedPlanner(),
            review_provider=PricedReviewer(),
            profiling_provider=again,
        )

        self.assertEqual(again.calls, [])
        self.assertNotIn("plan_profiling_skipped", second.warnings)
        self.assertNotIn("plan_profiling_partial", second.warnings)


@skipUnless(connection.vendor == "postgresql", ONLY_POSTGRES)
@override_settings(AI_USAGE_ENFORCE_LIMITS=True, AI_PLAN_LIMITS=_limits(100_000))
class QueuedProfilingCallTests(TransactionTestCase):
    def test_a_profiling_call_that_never_got_a_slot_is_cancelled_and_writes_no_usage(self):
        started = threading.Event()
        real_record = text_llm.record_model_usage

        class Client:
            def __init__(self, **kwargs):
                self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

            def create(self, **kwargs):
                started.set()
                return SimpleNamespace(
                    id="late",
                    model="m",
                    usage={"total_tokens": SECTION_SPENT},
                    choices=[SimpleNamespace(message=SimpleNamespace(content="{}"))],
                )

        def recording(*args, **kwargs):
            try:
                return real_record(*args, **kwargs)
            finally:
                connection.close()

        with mock.patch.dict(
            os.environ, {"SECTION_PROFILING_MODEL": "m", "SECTION_PROFILING_TIMEOUT": "1"}
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
        executor = text_llm._JSON_MODEL_EXECUTOR
        release = threading.Event()
        # Все слоты исполнителя заняты другими запросами процесса.
        blockers = [executor.submit(release.wait, 30) for _ in range(executor._max_workers)]
        try:
            with mock.patch.object(text_llm, "TEXT_LLM_API_KEY", "k"), mock.patch.object(
                text_llm, "OpenAI", Client
            ), mock.patch.object(
                text_llm, "record_model_usage", side_effect=recording
            ), mock.patch.object(text_llm, "_WALL_CLOCK_GRACE_SECONDS", 0):
                with usage_scope(user_email=EMAIL):
                    with self.assertRaises(TimeoutError), self.assertLogs(
                        "ai_engine.text_llm", level="INFO"
                    ):
                        provider.profile(request)
                release.set()
                for blocker in blockers:
                    blocker.result()
                # Очередь исполнителя общая и по порядку: всё, что стояло перед
                # этой пустышкой, уже взято в работу.
                executor.submit(lambda: None).result()
                self.assertFalse(started.wait(1))
        finally:
            release.set()

        self.assertFalse(AIUsageEvent.objects.exists())
        self.assertEqual(_live_reservations(), {})

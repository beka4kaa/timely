"""
Тесты Этапа 1: режимы тьютора, политика помощи, журнал событий и student state.

Критерий стадии из PRODUCT.md §21 — «тьютор ведёт разные сценарии по разным
правилам, а не отвечает одним общим промптом». Проверяем именно это, причём
структурно: не «в промпте есть слово», а «в контесте модели физически не выдан
инструмент» и «backend отказал в готовом решении до попыток».
"""

from __future__ import annotations

from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.test import APIRequestFactory

from ai_engine.help_policy import (
    FULL_SOLUTION_RUNG,
    HELP_PROFILES,
    HINT_LADDER,
    HelpPolicy,
    check_help_allowed,
    resolve_policy,
    resolve_profile,
)
from ai_engine.learning_events import (
    LearningEventFacts,
    normalize_error_type,
    recompute_skill_state,
    resolve_display_status,
)
from ai_engine.models import ERROR_TYPES, LearningEvent, SkillState
from ai_engine.tutor_modes import (
    DEFAULT_MODE,
    PRIMARY_MODE_SLUGS,
    TUTOR_MODES,
    get_mode,
    primary_modes,
)


class TutorModeRegistryTests(SimpleTestCase):
    """Реестр режимов (§5.2) — полнота и согласованность."""

    def test_all_nine_modes_from_the_spec_exist(self) -> None:
        expected = {
            "explain",
            "analyze_task",
            "solve_together",
            "practice",
            "review",
            "exam_prep",
            "quick_answer",
            "contest",
            "post_contest",
        }
        self.assertEqual(set(TUTOR_MODES), expected)

    def test_every_mode_is_fully_specified(self) -> None:
        """Режим без промпта, цели или критерия завершения бесполезен."""
        for slug, mode in TUTOR_MODES.items():
            self.assertEqual(mode.slug, slug, f"{slug}: slug не совпадает с ключом")
            self.assertTrue(mode.title.strip(), f"{slug}: нет заголовка")
            self.assertTrue(mode.goal.strip(), f"{slug}: нет цели")
            self.assertTrue(mode.prompt.strip(), f"{slug}: нет правил поведения")
            self.assertTrue(mode.completion.strip(), f"{slug}: нет критерия завершения")
            self.assertIsInstance(mode.policy, HelpPolicy)

    def test_modes_differ_in_rules_not_only_in_wording(self) -> None:
        """Смысл стадии: у режимов РАЗНЫЕ правила.

        Если все политики совпадут, «режимы» останутся девятью формулировками
        одного и того же поведения — ровно тем, что стадия должна устранить.
        """
        distinct = {mode.policy for mode in TUTOR_MODES.values()}
        self.assertGreater(len(distinct), 1)

    def test_primary_modes_are_real_and_are_the_four_from_the_spec(self) -> None:
        self.assertEqual(len(PRIMARY_MODE_SLUGS), 4)
        for slug in PRIMARY_MODE_SLUGS:
            self.assertIn(slug, TUTOR_MODES)
        self.assertEqual(
            [mode.slug for mode in primary_modes()], list(PRIMARY_MODE_SLUGS)
        )

    def test_unknown_or_missing_mode_falls_back_to_default(self) -> None:
        """Slug приходит от клиента: опечатка не должна ронять чат."""
        for value in (None, "", "   ", "no_such_mode", 42):
            self.assertEqual(get_mode(value).slug, DEFAULT_MODE)

    def test_contest_mode_withholds_every_form_of_help(self) -> None:
        policy = TUTOR_MODES["contest"].policy
        self.assertFalse(policy.allow_full_solution)
        self.assertFalse(policy.hints_allowed)
        self.assertFalse(policy.sources_allowed)
        self.assertEqual(policy.max_hint_level, 0)
        self.assertTrue(policy.rated)
        self.assertEqual(TUTOR_MODES["contest"].allowed_skills, ())


class ToolGatingTests(SimpleTestCase):
    """Инструменты как структурная граница режима, а не как просьба в промпте."""

    def test_contest_mode_gets_no_tools_at_all(self) -> None:
        from ai_engine.skills.router import tools_for_mode

        self.assertEqual(tools_for_mode(TUTOR_MODES["contest"]), [])

    def test_review_mode_has_no_board(self) -> None:
        """Схема до ответа — подсказка, а режим построен на попытке вспомнить."""
        from ai_engine.skills.router import tools_for_mode

        names = [t["function"]["name"] for t in tools_for_mode(TUTOR_MODES["review"])]
        self.assertNotIn("draw_board", names)

    def test_explain_mode_keeps_board_and_clarification(self) -> None:
        from ai_engine.skills.router import tools_for_mode

        names = [t["function"]["name"] for t in tools_for_mode(TUTOR_MODES["explain"])]
        self.assertIn("draw_board", names)
        self.assertIn("ask_clarification", names)

    def test_chat_is_never_offered_as_a_tool(self) -> None:
        """«Просто ответить» — поведение по умолчанию, а не выбор из списка."""
        from ai_engine.skills.router import tools_for_mode

        for mode in TUTOR_MODES.values():
            names = [t["function"]["name"] for t in tools_for_mode(mode)]
            self.assertNotIn("chat", names, f"{mode.slug} предлагает тул chat")

    def test_default_mode_tools_match_the_legacy_constant(self) -> None:
        """ROUTABLE_TOOLS остаётся честным описанием запроса без режима."""
        from ai_engine.skills.router import ROUTABLE_TOOLS, tools_for_mode

        self.assertEqual(ROUTABLE_TOOLS, tools_for_mode(get_mode(None)))


class HelpPolicyTests(SimpleTestCase):
    """Права на помощь считает backend, а не модель (§3.3, §5.5, §5.6)."""

    def test_ladder_has_eight_rungs_and_full_solution_is_the_seventh(self) -> None:
        self.assertEqual(len(HINT_LADDER), 8)
        self.assertEqual(FULL_SOLUTION_RUNG, 7)

    def test_full_solution_is_refused_before_the_required_attempts(self) -> None:
        policy = TUTOR_MODES["solve_together"].policy
        self.assertEqual(policy.required_attempts, 2)

        blocked = check_help_allowed(policy, attempts=1, wants_full_solution=True)
        self.assertFalse(blocked.allowed)
        self.assertTrue(blocked.reason.strip())

        allowed = check_help_allowed(policy, attempts=2, wants_full_solution=True)
        self.assertTrue(allowed.allowed)
        self.assertEqual(allowed.granted_rung, FULL_SOLUTION_RUNG)

    def test_contest_never_grants_a_solution_however_many_attempts(self) -> None:
        policy = TUTOR_MODES["contest"].policy
        for attempts in (0, 1, 5, 99):
            decision = check_help_allowed(policy, attempts=attempts, wants_full_solution=True)
            self.assertFalse(decision.allowed, f"attempts={attempts}")

    def test_hints_walk_the_ladder_one_rung_at_a_time(self) -> None:
        policy = TUTOR_MODES["solve_together"].policy
        for current in range(0, 4):
            decision = check_help_allowed(policy, hint_level=current)
            self.assertTrue(decision.allowed)
            self.assertEqual(decision.granted_rung, current + 1)
            self.assertTrue(decision.rung_title)

    def test_ladder_cannot_be_used_to_reach_a_forbidden_solution(self) -> None:
        """Иначе запрет обходится нажатием «подсказка» семь раз подряд."""
        policy = HelpPolicy(
            allow_full_solution=False,
            required_attempts=0,
            hints_allowed=True,
            # max_hint_level формально пускает до восьмой ступени...
            max_hint_level=8,
            sources_allowed=True,
            calculator_allowed=True,
            rated=False,
        )
        decision = check_help_allowed(policy, hint_level=FULL_SOLUTION_RUNG - 1)
        self.assertFalse(decision.allowed)

    def test_exhausted_ladder_stops_granting_hints(self) -> None:
        policy = TUTOR_MODES["review"].policy
        decision = check_help_allowed(policy, hint_level=policy.max_hint_level)
        self.assertFalse(decision.allowed)

    def test_mode_without_hints_refuses_them(self) -> None:
        decision = check_help_allowed(TUTOR_MODES["quick_answer"].policy, hint_level=0)
        self.assertFalse(decision.allowed)

    # ── §5.6: предпочтения могут только ужесточать ───────────────────────────

    def test_preferences_cannot_widen_a_contest_policy(self) -> None:
        """«Ученик управляет стилем, но не может отменить правила контеста»."""
        contest = TUTOR_MODES["contest"].policy
        greedy = {
            "allow_full_solution": True,
            "hints_allowed": True,
            "max_hint_level": 8,
            "sources_allowed": True,
            "calculator_allowed": True,
            "required_attempts": 0,
        }
        resolved = resolve_policy(contest, greedy)

        self.assertFalse(resolved.allow_full_solution)
        self.assertFalse(resolved.hints_allowed)
        self.assertFalse(resolved.sources_allowed)
        self.assertFalse(resolved.calculator_allowed)
        self.assertEqual(resolved.max_hint_level, 0)
        self.assertTrue(resolved.rated)

        self.assertFalse(
            check_help_allowed(resolved, attempts=10, wants_full_solution=True).allowed
        )

    def test_preferences_can_tighten(self) -> None:
        base = TUTOR_MODES["solve_together"].policy
        resolved = resolve_policy(base, {"allow_full_solution": False, "max_hint_level": 2})
        self.assertFalse(resolved.allow_full_solution)
        self.assertEqual(resolved.max_hint_level, 2)

    def test_required_attempts_can_only_grow(self) -> None:
        base = TUTOR_MODES["solve_together"].policy
        self.assertEqual(resolve_policy(base, {"required_attempts": 0}).required_attempts, 2)
        self.assertEqual(resolve_policy(base, {"required_attempts": 5}).required_attempts, 5)

    def test_rated_is_not_user_controllable(self) -> None:
        """Иначе «потренируюсь без рейтинга, если не получилось»."""
        contest = TUTOR_MODES["contest"].policy
        self.assertTrue(resolve_policy(contest, {"rated": False}).rated)

    def test_named_profiles_resolve_and_never_widen(self) -> None:
        contest = TUTOR_MODES["contest"].policy
        for name in HELP_PROFILES:
            resolved = resolve_profile(contest, name)
            self.assertFalse(resolved.allow_full_solution, name)
            self.assertFalse(resolved.hints_allowed, name)

    def test_unknown_profile_and_empty_prefs_leave_policy_untouched(self) -> None:
        base = TUTOR_MODES["explain"].policy
        self.assertEqual(resolve_profile(base, "no_such_profile"), base)
        self.assertEqual(resolve_profile(base, None), base)
        self.assertEqual(resolve_policy(base, {}), base)

    def test_garbage_preference_values_are_ignored(self) -> None:
        base = TUTOR_MODES["solve_together"].policy
        resolved = resolve_policy(
            base,
            {"max_hint_level": "много", "required_attempts": None, "hints_allowed": "да"},
        )
        self.assertEqual(resolved, base)


class RouterModeCompositionTests(SimpleTestCase):
    """Промпт собирается в ОДНОМ месте и режим в него действительно попадает."""

    def test_system_prompt_layers_base_then_mode(self) -> None:
        from ai_engine.skills.chat import CHAT_SYSTEM_PROMPT
        from ai_engine.skills.router import build_router_messages

        mode = TUTOR_MODES["review"]
        messages = build_router_messages(user_message="привет", history=[], mode=mode)
        system = messages[0]["content"]

        self.assertTrue(system.startswith(CHAT_SYSTEM_PROMPT))
        self.assertIn(mode.prompt, system)
        self.assertEqual(messages[-1], {"role": "user", "content": "привет"})

    def test_lesson_instruction_is_appended_last(self) -> None:
        from ai_engine.skills.router import build_router_messages

        messages = build_router_messages(
            user_message="Объясни",
            history=[],
            mode=TUTOR_MODES["explain"],
            lesson_instruction="Текущий этап: Наглядная схема",
        )
        system = messages[0]["content"]
        self.assertIn("Текущий этап: Наглядная схема", system)
        self.assertLess(
            system.index(TUTOR_MODES["explain"].prompt),
            system.index("Текущий этап: Наглядная схема"),
        )

    def test_different_modes_produce_different_system_prompts(self) -> None:
        from ai_engine.skills.router import build_router_messages

        prompts = {
            slug: build_router_messages(user_message="x", history=[], mode=mode)[0]["content"]
            for slug, mode in TUTOR_MODES.items()
        }
        self.assertEqual(len(set(prompts.values())), len(TUTOR_MODES))

    def test_route_and_run_uses_the_shared_builder(self) -> None:
        """Регрессия-страж: у роутера не должно быть своей копии сборки промпта.

        Пока сборка была инлайном, каждый новый путь чата заводил вторую копию,
        и режимы разъезжались между путями молча.
        """
        from ai_engine.skills import router

        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="ok", tool_calls=None))]
        )
        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = response
            router.route_and_run(user_message="Объясни", history=[], mode="review")

        sent = client.chat.completions.create.call_args.kwargs["messages"]
        expected = router.build_router_messages(
            user_message="Объясни", history=[], mode=TUTOR_MODES["review"]
        )
        self.assertEqual(sent, expected)

    def test_every_chat_path_shares_one_prompt_builder(self) -> None:
        """Тот же страж для стримингового пути, когда он появится в этой ветке.

        Стриминг живёт в незакоммиченной работе пользователя, поэтому здесь его
        может не быть — тогда тест пропускается, а не падает. Как только функция
        появится, она обязана строить промпт тем же билдером.
        """
        from ai_engine.skills import router

        streaming = getattr(router, "route_and_run_streaming", None)
        if streaming is None:
            self.skipTest("route_and_run_streaming ещё нет в этой ветке")

        chunk = SimpleNamespace(choices=[], usage=None)
        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = iter([chunk])
            list(streaming(user_message="Объясни", history=[], mode="review"))

        sent = client.chat.completions.create.call_args.kwargs["messages"]
        expected = router.build_router_messages(
            user_message="Объясни", history=[], mode=TUTOR_MODES["review"]
        )
        self.assertEqual(sent, expected)

    def test_contest_request_carries_no_tools_key(self) -> None:
        """`tools: []` провайдеры отвергают — ключа не должно быть вовсе."""
        from ai_engine.skills import router

        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="ok", tool_calls=None))]
        )
        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = response
            router.route_and_run(user_message="реши за меня", history=[], mode="contest")

        self.assertNotIn("tools", client.chat.completions.create.call_args.kwargs)

    def test_tool_call_outside_the_mode_is_refused(self) -> None:
        """GLM-4.6V умеет позвать тул, которого в запросе не было."""
        from ai_engine.skills import router

        call = SimpleNamespace(
            function=SimpleNamespace(name="draw_board", arguments='{"topic": "силы"}')
        )
        response = SimpleNamespace(
            choices=[
                SimpleNamespace(message=SimpleNamespace(content="сейчас нарисую", tool_calls=[call]))
            ]
        )
        with patch.object(router.SKILLS["draw_board"], "run") as board_run:
            with patch.object(router, "openrouter_client") as client:
                client.chat.completions.create.return_value = response
                result = router.route_and_run(
                    user_message="нарисуй решение", history=[], mode="contest"
                )
        board_run.assert_not_called()
        self.assertEqual(result.skill, "chat")

    def test_style_shortcut_is_blocked_when_the_mode_forbids_the_board(self) -> None:
        """Иначе «do sketch» рисует схему в режиме, где доски нет."""
        from ai_engine.skills import router

        history = [{"role": "user", "content": "нарисуй брусок на наклонной плоскости"}]
        response = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="ok", tool_calls=None))]
        )
        with patch.object(router.SKILLS["draw_board"], "run") as board_run:
            with patch.object(router, "openrouter_client") as client:
                client.chat.completions.create.return_value = response
                router.route_and_run(
                    user_message="do sketch", history=history, mode="contest"
                )
        board_run.assert_not_called()

    def test_no_mode_reproduces_previous_behaviour(self) -> None:
        """Обратная совместимость: запрос без режима — прежний путь с доской."""
        from ai_engine.skills import router

        history = [{"role": "user", "content": "нарисуй брусок"}]
        with patch.object(router.SKILLS["draw_board"], "run") as board_run:
            board_run.return_value = router.SkillResult(reply="ok", skill="draw_board")
            with patch.object(router, "openrouter_client") as client:
                result = router.route_and_run(user_message="do sketch", history=history)
                client.chat.completions.create.assert_not_called()
        self.assertEqual(result.skill, "draw_board")
        board_run.assert_called_once()


class SolveEndpointPolicyTests(SimpleTestCase):
    """`/api/ai/solve/` — главная дырка в педагогике до этой стадии."""

    def setUp(self) -> None:
        self.factory = APIRequestFactory()

    def _post(self, payload: dict):
        from ai_engine.solve_views import SolveTaskView

        request = self.factory.post("/api/ai/solve/", payload, format="json")
        return SolveTaskView.as_view()(request)

    def test_contest_mode_refuses_without_calling_the_model(self) -> None:
        from ai_engine import solve_views

        with patch.object(solve_views, "openrouter_client") as client:
            response = self._post({"message": "Реши задачу 5", "mode": "contest"})

        client.chat.completions.create.assert_not_called()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["policy_blocked"])
        self.assertEqual(response.data["mode"], "contest")
        self.assertTrue(response.data["reply"].strip())

    def test_solve_mode_refuses_until_the_student_has_tried(self) -> None:
        from ai_engine import solve_views

        with patch.object(solve_views, "openrouter_client") as client:
            blocked = self._post(
                {"message": "Реши задачу", "mode": "solve_together", "attempts": 0}
            )
        client.chat.completions.create.assert_not_called()
        self.assertTrue(blocked.data["policy_blocked"])

    def test_solve_mode_allows_after_enough_attempts(self) -> None:
        from ai_engine import solve_views

        response_obj = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="Решение: 42"))],
            usage=None,
        )
        with patch.object(solve_views, "openrouter_client") as client:
            client.chat.completions.create.return_value = response_obj
            allowed = self._post(
                {"message": "Реши задачу", "mode": "solve_together", "attempts": 2}
            )

        client.chat.completions.create.assert_called_once()
        self.assertNotIn("policy_blocked", allowed.data)
        self.assertEqual(allowed.data["reply"], "Решение: 42")

    def test_mode_rules_reach_the_solve_prompt(self) -> None:
        from ai_engine import solve_views

        response_obj = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="разбор"))], usage=None
        )
        with patch.object(solve_views, "openrouter_client") as client:
            client.chat.completions.create.return_value = response_obj
            self._post({"message": "Разбери мою работу", "mode": "post_contest"})

        system = client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn(TUTOR_MODES["post_contest"].prompt, system)

    def test_request_without_mode_still_solves(self) -> None:
        """Обратная совместимость: старый клиент не присылает mode."""
        from ai_engine import solve_views

        response_obj = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="Решение"))], usage=None
        )
        with patch.object(solve_views, "openrouter_client") as client:
            client.chat.completions.create.return_value = response_obj
            response = self._post({"message": "Реши задачу"})

        client.chat.completions.create.assert_called_once()
        self.assertEqual(response.data["reply"], "Решение")

    def test_bad_attempts_value_does_not_crash(self) -> None:
        with patch.object(__import__("ai_engine.solve_views", fromlist=["x"]), "openrouter_client"):
            response = self._post(
                {"message": "Реши", "mode": "solve_together", "attempts": "много"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["policy_blocked"])


class ErrorTypeValidationTests(SimpleTestCase):
    """Типология ошибок §6.8 — закрытый перечень на границе LLM → backend."""

    def test_spec_lists_ten_types_plus_unknown(self) -> None:
        self.assertEqual(len(ERROR_TYPES), 11)
        for expected in (
            "misread_problem",
            "wrong_formula",
            "missing_prerequisite",
            "arithmetic",
            "sign_error",
            "units",
            "incomplete",
            "guessed",
            "copied",
            "out_of_time",
        ):
            self.assertIn(expected, ERROR_TYPES)

    def test_known_types_pass_through(self) -> None:
        self.assertEqual(normalize_error_type("sign_error"), "sign_error")
        self.assertEqual(normalize_error_type("  SIGN_ERROR "), "sign_error")

    def test_empty_is_legal_not_every_event_is_an_error(self) -> None:
        self.assertEqual(normalize_error_type(""), "")
        self.assertEqual(normalize_error_type(None), "")

    def test_invented_type_becomes_unknown_instead_of_leaking(self) -> None:
        for bogus in ("ученик устал", "SIGN", "ошибка_знака", 17):
            self.assertEqual(normalize_error_type(bogus), "unknown", repr(bogus))


class RecomputeSkillStateTests(SimpleTestCase):
    """`recompute_skill_state` — чистая функция, проверяется таблицей."""

    @staticmethod
    def _fact(result: str, hint_level: int = 0, error_type: str = "") -> LearningEventFacts:
        return LearningEventFacts(result=result, hint_level=hint_level, error_type=error_type)

    def test_no_events_means_not_started(self) -> None:
        state = recompute_skill_state([])
        self.assertEqual(state.status, "NOT_STARTED")
        self.assertEqual(state.mastery_probability, 0.0)
        self.assertEqual(state.evidence_count, 0)

    def test_is_deterministic(self) -> None:
        facts = [self._fact("correct"), self._fact("incorrect", error_type="units")]
        self.assertEqual(recompute_skill_state(facts), recompute_skill_state(facts))

    def test_reading_an_explanation_does_not_prove_mastery(self) -> None:
        """§6.3: тема усвоена по доказательствам, а не по факту просмотра."""
        facts = [self._fact("completed") for _ in range(10)]
        state = recompute_skill_state(facts)
        self.assertEqual(state.status, "LEARNING")
        self.assertEqual(state.mastery_probability, 0.0)
        self.assertEqual(state.confidence, 0.0)

    def test_three_unaided_successes_reach_mastery(self) -> None:
        state = recompute_skill_state([self._fact("correct") for _ in range(3)])
        self.assertEqual(state.status, "MASTERED")
        self.assertEqual(state.mastery_probability, 1.0)
        self.assertEqual(state.success_count, 3)

    def test_successes_with_hints_do_not_reach_mastery(self) -> None:
        """Помощь и была смыслом подсказки — это не самостоятельность."""
        state = recompute_skill_state([self._fact("correct", hint_level=3) for _ in range(3)])
        self.assertNotEqual(state.status, "MASTERED")
        self.assertEqual(state.hint_count, 3)
        self.assertEqual(state.avg_hint_level, 3.0)

    def test_recurring_systemic_error_blocks_mastery(self) -> None:
        facts = [self._fact("correct") for _ in range(8)] + [
            self._fact("incorrect", error_type="sign_error") for _ in range(3)
        ]
        state = recompute_skill_state(facts)
        self.assertNotEqual(state.status, "MASTERED")
        self.assertEqual(state.common_errors["sign_error"], 3)

    def test_mostly_wrong_needs_practice(self) -> None:
        facts = [self._fact("incorrect") for _ in range(4)] + [self._fact("correct")]
        self.assertEqual(recompute_skill_state(facts).status, "NEEDS_PRACTICE")
        self.assertEqual(recompute_skill_state(facts).fail_count, 4)

    def test_confidence_grows_with_evidence_and_is_capped(self) -> None:
        low = recompute_skill_state([self._fact("correct")])
        high = recompute_skill_state([self._fact("correct") for _ in range(20)])
        self.assertLess(low.confidence, high.confidence)
        self.assertEqual(high.confidence, 1.0)

    def test_last_practiced_is_the_latest_timestamp(self) -> None:
        now = timezone.now()
        facts = [
            LearningEventFacts(result="correct", created_at=now - timedelta(days=3)),
            LearningEventFacts(result="correct", created_at=now),
            LearningEventFacts(result="correct", created_at=now - timedelta(days=1)),
        ]
        self.assertEqual(recompute_skill_state(facts).last_practiced_at, now)

    def test_display_status_marks_a_due_mastered_skill(self) -> None:
        now = timezone.now()
        self.assertEqual(
            resolve_display_status("MASTERED", now - timedelta(days=1), now), "DUE_REVIEW"
        )
        self.assertEqual(
            resolve_display_status("MASTERED", now + timedelta(days=1), now), "MASTERED"
        )
        self.assertEqual(resolve_display_status("MASTERED", None, now), "MASTERED")

    def test_display_status_does_not_hide_work_in_progress(self) -> None:
        """«Нужна практика» информативнее напоминания о повторении."""
        now = timezone.now()
        self.assertEqual(
            resolve_display_status("NEEDS_PRACTICE", now - timedelta(days=5), now),
            "NEEDS_PRACTICE",
        )


class LearningEventJournalTests(TestCase):
    """Журнал и производное состояние в БД."""

    def setUp(self) -> None:
        from mind.models import Subject, Topic

        self.subject = Subject.objects.create(name="Физика", user_email="student@example.com")
        self.topic = Topic.objects.create(subject=self.subject, name="Второй закон Ньютона")

    def test_event_is_written_with_a_normalized_error_type(self) -> None:
        from ai_engine.learning_events import record_learning_event

        event = record_learning_event(
            user_email="student@example.com",
            topic=self.topic,
            activity="task_attempt",
            result="incorrect",
            error_type="совершенно новый тип",
            mode="solve_together",
        )
        self.assertIsNotNone(event)
        self.assertEqual(event.error_type, "unknown")
        # Значение должно быть валидным для поля с choices.
        event.full_clean()

    def test_skill_ref_defaults_to_the_topic_name(self) -> None:
        from ai_engine.learning_events import record_learning_event

        event = record_learning_event(
            user_email="student@example.com", topic=self.topic, result="correct", activity="practice"
        )
        self.assertEqual(event.skill_ref, "Второй закон Ньютона")

    def test_history_survives_topic_deletion(self) -> None:
        """Журнал — история, а не проекция текущего состояния."""
        from ai_engine.learning_events import record_learning_event

        record_learning_event(user_email="student@example.com", topic=self.topic, result="correct")
        self.topic.delete()

        event = LearningEvent.objects.get(user_email="student@example.com")
        self.assertIsNone(event.topic_id)
        self.assertEqual(event.skill_ref, "Второй закон Ньютона")

    def test_event_without_user_is_rejected(self) -> None:
        """Ровно та ошибка, из-за которой mind.ReviewLog бесполезен."""
        from ai_engine.learning_events import record_learning_event

        self.assertIsNone(record_learning_event(user_email="", topic=self.topic))
        self.assertEqual(LearningEvent.objects.count(), 0)

    def test_apply_event_updates_derived_state(self) -> None:
        from ai_engine.learning_events import apply_learning_event

        for _ in range(3):
            apply_learning_event(
                user_email="student@example.com",
                topic=self.topic,
                activity="task_attempt",
                result="correct",
                mode="practice",
            )

        state = SkillState.objects.get(user_email="student@example.com", topic=self.topic)
        self.assertEqual(state.status, "MASTERED")
        self.assertEqual(state.success_count, 3)
        self.assertEqual(state.evidence_count, 3)

    def test_state_is_rebuildable_from_the_journal(self) -> None:
        """Источник истины — события; расхождение лечится пересчётом."""
        from ai_engine.learning_events import apply_learning_event, refresh_skill_state

        apply_learning_event(
            user_email="student@example.com", topic=self.topic, activity="task_attempt", result="incorrect"
        )
        state = SkillState.objects.get(user_email="student@example.com", topic=self.topic)
        SkillState.objects.filter(pk=state.pk).update(
            status="MASTERED", mastery_probability=1.0, success_count=99
        )

        rebuilt = refresh_skill_state(user_email="student@example.com", topic=self.topic)
        self.assertEqual(rebuilt.status, "NEEDS_PRACTICE")
        self.assertEqual(rebuilt.success_count, 0)

    def test_one_state_row_per_user_and_skill(self) -> None:
        from ai_engine.learning_events import apply_learning_event

        for result in ("correct", "incorrect", "correct"):
            apply_learning_event(
                user_email="student@example.com", topic=self.topic, activity="practice", result=result
            )
        self.assertEqual(
            SkillState.objects.filter(user_email="student@example.com", topic=self.topic).count(), 1
        )

    def test_students_do_not_share_state(self) -> None:
        from ai_engine.learning_events import apply_learning_event

        apply_learning_event(user_email="student@example.com", topic=self.topic, result="correct")
        apply_learning_event(user_email="other@example.com", topic=self.topic, result="incorrect")
        self.assertEqual(SkillState.objects.count(), 2)


class ChatSessionModeTests(TestCase):
    """Режим и права живут на сессии, но заполняет их сервер."""

    def test_legacy_session_defaults_to_the_default_mode(self) -> None:
        from ai_engine.models import ChatSession

        session = ChatSession.objects.create(id="s1", user_email="student@example.com")
        self.assertEqual(session.mode, "")
        self.assertEqual(get_mode(session.mode).slug, DEFAULT_MODE)
        self.assertEqual(session.hint_level, 0)
        self.assertEqual(session.attempt_count, 0)
        self.assertEqual(session.status, "ACTIVE")

    def test_serializer_normalizes_an_unknown_mode(self) -> None:
        from ai_engine.serializers import ChatSessionSerializer

        serializer = ChatSessionSerializer(
            data={"id": "s2", "messages": [], "mode": "no_such_mode"}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["mode"], DEFAULT_MODE)

    def test_serializer_keeps_a_known_mode(self) -> None:
        from ai_engine.serializers import ChatSessionSerializer

        serializer = ChatSessionSerializer(data={"id": "s3", "messages": [], "mode": "contest"})
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["mode"], "contest")

    def test_client_cannot_write_the_policy(self) -> None:
        """Права выдаёт сервер — иначе клиент включит себе готовые ответы."""
        from ai_engine.serializers import ChatSessionSerializer

        serializer = ChatSessionSerializer(
            data={
                "id": "s4",
                "messages": [],
                "mode": "contest",
                "policy": {"allow_full_solution": True},
            }
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertNotIn("policy", serializer.validated_data)

    def test_unknown_help_profile_is_dropped(self) -> None:
        from ai_engine.serializers import ChatSessionSerializer

        serializer = ChatSessionSerializer(
            data={"id": "s5", "messages": [], "help_profile": "give_me_answers"}
        )
        self.assertTrue(serializer.is_valid(), serializer.errors)
        self.assertEqual(serializer.validated_data["help_profile"], "")


class HintLadderEndpointTests(SimpleTestCase):
    """Лестница помощи через /api/ai/chat/ — ступень выдаёт backend (§5.5)."""

    def setUp(self) -> None:
        self.factory = APIRequestFactory()

    def _post(self, payload: dict):
        from ai_engine.chat_views import BoardChatView

        request = self.factory.post("/api/ai/chat/", payload, format="json")
        return BoardChatView.as_view()(request)

    @staticmethod
    def _model_reply(text: str = "Подсказка"):
        return SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content=text, tool_calls=None))]
        )

    def test_contest_refuses_a_hint_without_calling_the_model(self) -> None:
        from ai_engine.skills import router

        with patch.object(router, "openrouter_client") as client:
            response = self._post(
                {"message": "подскажи", "mode": "contest", "request_hint": True}
            )
        client.chat.completions.create.assert_not_called()
        self.assertTrue(response.data["policy_blocked"])
        self.assertEqual(response.data["mode"], "contest")

    def test_first_hint_grants_the_first_rung_only(self) -> None:
        from ai_engine.skills import router

        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = self._model_reply()
            response = self._post(
                {
                    "message": "подскажи",
                    "mode": "solve_together",
                    "request_hint": True,
                    "hint_level": 0,
                }
            )

        self.assertEqual(response.data["hint_level"], 1)
        system = client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn("подсказку уровня 1", system)
        self.assertIn(HINT_LADDER[0], system)
        self.assertIn("не решай задачу целиком", system)

    def test_ladder_advances_one_rung_per_request(self) -> None:
        from ai_engine.skills import router

        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = self._model_reply()
            response = self._post(
                {
                    "message": "ещё подсказку",
                    "mode": "solve_together",
                    "request_hint": True,
                    "hint_level": 3,
                }
            )
        self.assertEqual(response.data["hint_level"], 4)
        system = client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertIn(HINT_LADDER[3], system)

    def test_hints_cannot_walk_into_a_forbidden_solution(self) -> None:
        """analyze_task обязан выдать план, а не ответ — лестница обрывается."""
        from ai_engine.skills import router

        with patch.object(router, "openrouter_client") as client:
            response = self._post(
                {
                    "message": "подскажи",
                    "mode": "analyze_task",
                    "request_hint": True,
                    "hint_level": 5,
                }
            )
        client.chat.completions.create.assert_not_called()
        self.assertTrue(response.data["policy_blocked"])

    def test_ordinary_message_carries_no_hint_instruction(self) -> None:
        from ai_engine.skills import router

        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = self._model_reply("Ответ")
            response = self._post({"message": "Объясни", "mode": "solve_together"})

        system = client.chat.completions.create.call_args.kwargs["messages"][0]["content"]
        self.assertNotIn("ЗАПРОС ПОДСКАЗКИ", system)
        self.assertNotIn("hint_level", response.data)

    def test_policy_is_returned_so_the_client_can_render_the_button(self) -> None:
        from ai_engine.skills import router

        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = self._model_reply("Ответ")
            response = self._post({"message": "Объясни", "mode": "quick_answer"})

        self.assertEqual(response.data["mode"], "quick_answer")
        self.assertFalse(response.data["policy"]["hints_allowed"])

    def test_garbage_counters_do_not_crash(self) -> None:
        from ai_engine.skills import router

        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = self._model_reply()
            response = self._post(
                {
                    "message": "подскажи",
                    "mode": "solve_together",
                    "request_hint": True,
                    "hint_level": "три",
                    "attempts": None,
                }
            )
        self.assertEqual(response.data["hint_level"], 1)

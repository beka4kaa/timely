"""
Тесты типизированных инструментов тьютора (PRODUCT.md §5.7).

Главное, что здесь проверяется, — граница LLM → backend. Модель заполняет
аргументы сама и делает это неаккуратно, поэтому валидатор обязан отклонять
мусор, а не приводить его к чему-то похожему; и инструмент обязан возвращать
ошибку результатом, а не исключением, иначе неверно заполненное поле оборвёт
ответ ученику.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from ai_engine.models import SkillState
from ai_engine.tutor_modes import TUTOR_MODES
from ai_engine.tutor_tools import (
    MAX_TOOL_ROUNDS,
    TUTOR_TOOLS,
    ToolContext,
    ToolValidationError,
    answers_match,
    normalize_answer,
    resolve_topic,
    run_tutor_tool,
    tool_schemas,
    validate_args,
)


class ToolRegistryTests(SimpleTestCase):
    def test_the_five_planned_tools_exist(self) -> None:
        self.assertEqual(
            set(TUTOR_TOOLS),
            {
                "get_topic_state",
                "save_learning_event",
                "classify_error",
                "schedule_review",
                "check_answer",
            },
        )

    def test_every_tool_has_a_schema_and_a_description_for_the_model(self) -> None:
        for name, tool in TUTOR_TOOLS.items():
            schema = tool.as_tool()
            self.assertEqual(schema["function"]["name"], name)
            self.assertTrue(schema["function"]["description"].strip(), name)
            self.assertEqual(schema["function"]["parameters"]["type"], "object")

    def test_tool_schemas_skips_unknown_names(self) -> None:
        self.assertEqual(tool_schemas(("check_answer", "no_such_tool")), tool_schemas(("check_answer",)))

    def test_contest_and_quick_answer_expose_no_tools(self) -> None:
        """Во время зачётной работы тьютор не читает состояние и не пишет в журнал."""
        self.assertEqual(TUTOR_MODES["contest"].allowed_tools, ())
        self.assertEqual(TUTOR_MODES["quick_answer"].allowed_tools, ())

    def test_modes_only_reference_real_tools(self) -> None:
        for mode in TUTOR_MODES.values():
            for name in mode.allowed_tools:
                self.assertIn(name, TUTOR_TOOLS, f"{mode.slug} ссылается на {name}")

    def test_practice_can_check_and_classify(self) -> None:
        tools = TUTOR_MODES["practice"].allowed_tools
        self.assertIn("check_answer", tools)
        self.assertIn("classify_error", tools)

    def test_review_can_schedule_the_next_repetition(self) -> None:
        self.assertIn("schedule_review", TUTOR_MODES["review"].allowed_tools)


class ValidateArgsTests(SimpleTestCase):
    SCHEMA = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "count": {"type": "integer", "minimum": 0},
            "ratio": {"type": "number"},
            "kind": {"type": "string", "enum": ["a", "b"]},
        },
        "required": ["name"],
    }

    def test_accepts_valid_arguments_and_trims_strings(self) -> None:
        cleaned = validate_args({"name": "  тема  ", "count": 3}, self.SCHEMA)
        self.assertEqual(cleaned, {"name": "тема", "count": 3})

    def test_empty_args_are_fine_when_nothing_is_required(self) -> None:
        self.assertEqual(validate_args(None, {"type": "object", "properties": {}}), {})

    def test_rejects_unknown_fields(self) -> None:
        """Молча выброшенное поле — это расхождение, которое потом ищут в логах."""
        with self.assertRaises(ToolValidationError) as ctx:
            validate_args({"name": "x", "surprise": 1}, self.SCHEMA)
        self.assertIn("surprise", str(ctx.exception))

    def test_rejects_missing_required_field(self) -> None:
        with self.assertRaises(ToolValidationError):
            validate_args({"count": 1}, self.SCHEMA)

    def test_rejects_empty_required_field(self) -> None:
        with self.assertRaises(ToolValidationError):
            validate_args({"name": ""}, self.SCHEMA)

    def test_rejects_wrong_types(self) -> None:
        with self.assertRaises(ToolValidationError):
            validate_args({"name": 42}, self.SCHEMA)
        with self.assertRaises(ToolValidationError):
            validate_args({"name": "x", "count": "три"}, self.SCHEMA)

    def test_rejects_bool_for_an_integer_field(self) -> None:
        """bool — подкласс int, поэтому True прошёл бы как «уровень 1»."""
        with self.assertRaises(ToolValidationError):
            validate_args({"name": "x", "count": True}, self.SCHEMA)

    def test_enforces_enum(self) -> None:
        with self.assertRaises(ToolValidationError):
            validate_args({"name": "x", "kind": "c"}, self.SCHEMA)

    def test_enforces_minimum(self) -> None:
        with self.assertRaises(ToolValidationError):
            validate_args({"name": "x", "count": -1}, self.SCHEMA)

    def test_rejects_non_object_payload(self) -> None:
        with self.assertRaises(ToolValidationError):
            validate_args(["name"], self.SCHEMA)


class AnswerComparisonTests(SimpleTestCase):
    """`check_answer` — та проверка, которую §3.3 запрещает отдавать модели."""

    def test_decimal_comma_equals_decimal_point(self) -> None:
        matched, method = answers_match("0,5", "0.5")
        self.assertTrue(matched)
        self.assertEqual(method, "числовое сравнение")

    def test_unicode_minus_equals_hyphen(self) -> None:
        self.assertTrue(answers_match("−3", "-3")[0])

    def test_surrounding_whitespace_is_ignored(self) -> None:
        self.assertTrue(answers_match("  42 ", "42")[0])

    def test_trailing_punctuation_is_ignored(self) -> None:
        self.assertTrue(answers_match("42.", "42")[0])

    def test_scientific_notation_matches_plain(self) -> None:
        self.assertTrue(answers_match("1e3", "1000")[0])

    def test_numbers_that_differ_do_not_match(self) -> None:
        self.assertFalse(answers_match("0.6", "0.5")[0])

    def test_tolerance_is_relative_to_magnitude(self) -> None:
        self.assertTrue(answers_match("1000000.0001", "1000000", tolerance=1e-6)[0])
        self.assertFalse(answers_match("1.5", "1.0", tolerance=1e-6)[0])

    def test_text_answers_compare_case_insensitively(self) -> None:
        matched, method = answers_match("Ускорение", "ускорение")
        self.assertTrue(matched)
        self.assertEqual(method, "текстовое сравнение")

    def test_missing_expected_answer_is_not_a_match(self) -> None:
        matched, reason = answers_match("42", "")
        self.assertFalse(matched)
        self.assertIn("эталон", reason)

    def test_normalize_handles_none(self) -> None:
        self.assertEqual(normalize_answer(None), "")


class DispatcherTests(SimpleTestCase):
    """Диспетчер никогда не бросает — ошибка возвращается моделью-читаемым JSON."""

    def test_unknown_tool_is_reported_not_raised(self) -> None:
        result = run_tutor_tool("no_such_tool", {})
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "unknown_tool")

    def test_invalid_arguments_do_not_reach_the_handler(self) -> None:
        result = run_tutor_tool("check_answer", {"student_answer": "1"})  # нет expected_answer
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "invalid_arguments")

    def test_handler_failure_is_caught(self) -> None:
        def boom(args, context):
            raise RuntimeError("инструмент сломался")

        with patch.dict(
            TUTOR_TOOLS,
            {"check_answer": TUTOR_TOOLS["check_answer"].__class__(
                name="check_answer",
                description="x",
                parameters={"type": "object", "properties": {}},
                handler=boom,
            )},
        ):
            result = run_tutor_tool("check_answer", {})
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "tool_failed")

    def test_check_answer_runs_without_a_database(self) -> None:
        result = run_tutor_tool(
            "check_answer", {"student_answer": "0,5", "expected_answer": "0.5"}
        )
        self.assertTrue(result["ok"])
        self.assertTrue(result["correct"])

    def test_tools_needing_a_topic_say_so_instead_of_failing(self) -> None:
        for name in ("get_topic_state", "schedule_review", "save_learning_event"):
            args = {
                "schedule_review": {"rating": "GOOD"},
                "save_learning_event": {"activity": "practice", "result": "correct"},
            }.get(name, {})
            result = run_tutor_tool(name, args, ToolContext(user_email="s@example.com"))
            self.assertFalse(result["ok"], name)
            self.assertEqual(result["error"], "no_topic", name)


class ToolsAgainstTheDatabaseTests(TestCase):
    def setUp(self) -> None:
        from mind.models import Subject, Topic

        self.subject = Subject.objects.create(name="Физика", user_email="student@example.com")
        self.topic = Topic.objects.create(
            subject=self.subject, name="Второй закон Ньютона", status="MEDIUM", interval_days=3
        )
        self.context = ToolContext(
            user_email="student@example.com", topic=self.topic, mode="practice"
        )

    def test_get_topic_state_reports_not_started_before_any_evidence(self) -> None:
        result = run_tutor_tool("get_topic_state", {}, self.context)
        self.assertTrue(result["ok"])
        self.assertEqual(result["status"], "NOT_STARTED")
        self.assertEqual(result["evidence_count"], 0)

    def test_save_learning_event_writes_and_returns_new_state(self) -> None:
        result = run_tutor_tool(
            "save_learning_event",
            {"activity": "task_attempt", "result": "correct"},
            self.context,
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["success_count"], 1)
        self.assertEqual(
            SkillState.objects.filter(
                user_email="student@example.com", topic=self.topic
            ).count(),
            1,
        )

    def test_save_learning_event_rejects_an_invented_error_type(self) -> None:
        """Enum в схеме — первая линия; normalize_error_type — вторая."""
        result = run_tutor_tool(
            "save_learning_event",
            {"activity": "task_attempt", "result": "incorrect", "error_type": "устал"},
            self.context,
        )
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "invalid_arguments")

    def test_classify_error_flags_a_recurring_mistake_as_systemic(self) -> None:
        for _ in range(2):
            run_tutor_tool(
                "save_learning_event",
                {
                    "activity": "task_attempt",
                    "result": "incorrect",
                    "error_type": "sign_error",
                },
                self.context,
            )
        result = run_tutor_tool("classify_error", {"error_type": "sign_error"}, self.context)
        self.assertTrue(result["ok"])
        self.assertEqual(result["error_type"], "sign_error")
        self.assertEqual(result["times_seen"], 2)
        self.assertTrue(result["systemic"])

    def test_classify_error_does_not_flag_a_first_mistake(self) -> None:
        result = run_tutor_tool("classify_error", {"error_type": "arithmetic"}, self.context)
        self.assertFalse(result["systemic"])

    def test_schedule_review_uses_the_shared_srs_calculation(self) -> None:
        from mind.srs import next_review

        expected = next_review(
            rating="GOOD",
            status=self.topic.status,
            interval_days=self.topic.interval_days,
            ease_factor=self.topic.ease_factor,
        )
        result = run_tutor_tool("schedule_review", {"rating": "GOOD"}, self.context)

        self.assertTrue(result["ok"])
        self.assertEqual(result["interval_days"], expected.interval_days)
        self.topic.refresh_from_db()
        self.assertEqual(self.topic.interval_days, expected.interval_days)
        self.assertEqual(self.topic.status, expected.status)

    def test_schedule_review_keeps_topic_and_skill_state_in_sync(self) -> None:
        """Страница слабых тем читает Topic, тьютор — SkillState."""
        run_tutor_tool("schedule_review", {"rating": "GOOD"}, self.context)
        self.topic.refresh_from_db()
        state = SkillState.objects.get(user_email="student@example.com", topic=self.topic)
        self.assertIsNotNone(state.next_review_at)
        self.assertEqual(state.next_review_at, self.topic.next_review_at)

    def test_schedule_review_rejects_an_unknown_rating(self) -> None:
        result = run_tutor_tool("schedule_review", {"rating": "SUPER"}, self.context)
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "invalid_arguments")

    def test_resolve_topic_finds_the_students_own_topic(self) -> None:
        found = resolve_topic("student@example.com", "второй закон ньютона")
        # str() с двух сторон: Topic.pk — CharField с default=uuid.uuid4, поэтому
        # у объекта из памяти там UUID, а у поднятого из БД — строка.
        self.assertEqual(str(found.pk), str(self.topic.pk))

    def test_resolve_topic_never_returns_another_students_topic(self) -> None:
        """Topic висит на Subject.user_email, одноимённые темы — разные строки."""
        from mind.models import Subject, Topic

        other = Subject.objects.create(name="Физика", user_email="other@example.com")
        Topic.objects.create(subject=other, name="Второй закон Ньютона")

        found = resolve_topic("other@example.com", "Второй закон Ньютона")
        self.assertIsNotNone(found)
        self.assertNotEqual(str(found.pk), str(self.topic.pk))
        self.assertIsNone(resolve_topic("nobody@example.com", "Второй закон Ньютона"))

    def test_resolve_topic_handles_missing_input(self) -> None:
        self.assertIsNone(resolve_topic("student@example.com", ""))
        self.assertIsNone(resolve_topic("", "Второй закон Ньютона"))


class RouterToolLoopTests(TestCase):
    """Инструмент исполняется, результат возвращается модели, ответ продолжается."""

    def setUp(self) -> None:
        from mind.models import Subject, Topic

        self.subject = Subject.objects.create(name="Физика", user_email="student@example.com")
        Topic.objects.create(subject=self.subject, name="Инерция")

    @staticmethod
    def _tool_call(name: str, arguments: str, call_id: str = "call-1"):
        return SimpleNamespace(
            id=call_id, function=SimpleNamespace(name=name, arguments=arguments)
        )

    @classmethod
    def _response(cls, *, content: str = "", tool_calls=None):
        return SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content=content, tool_calls=tool_calls)
                )
            ]
        )

    def test_tool_result_is_fed_back_and_the_model_answers(self) -> None:
        from ai_engine.skills import router

        first = self._response(
            tool_calls=[
                self._tool_call(
                    "check_answer",
                    json.dumps({"student_answer": "0,5", "expected_answer": "0.5"}),
                )
            ]
        )
        second = self._response(content="Верно, 0,5.")

        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.side_effect = [first, second]
            result = router.route_and_run(
                user_message="ответ 0,5",
                history=[],
                mode="practice",
                user_email="student@example.com",
                topic_name="Инерция",
            )

        self.assertEqual(result.reply, "Верно, 0,5.")
        self.assertEqual(client.chat.completions.create.call_count, 2)

        # Второй запрос обязан содержать tool-result, иначе модель отвечала бы,
        # не увидев результата проверки.
        sent = client.chat.completions.create.call_args_list[1].kwargs["messages"]
        tool_messages = [m for m in sent if m.get("role") == "tool"]
        self.assertEqual(len(tool_messages), 1)
        payload = json.loads(tool_messages[0]["content"])
        self.assertTrue(payload["correct"])
        self.assertEqual(tool_messages[0]["tool_call_id"], "call-1")

    def test_invalid_tool_arguments_come_back_as_a_tool_result(self) -> None:
        """Модель должна узнать о своей ошибке и исправиться, а не упасть."""
        from ai_engine.skills import router

        first = self._response(
            tool_calls=[self._tool_call("check_answer", '{"student_answer": "1"}')]
        )
        second = self._response(content="Уточни, пожалуйста, верный ответ.")

        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.side_effect = [first, second]
            result = router.route_and_run(
                user_message="проверь", history=[], mode="practice",
                user_email="student@example.com", topic_name="Инерция",
            )

        sent = client.chat.completions.create.call_args_list[1].kwargs["messages"]
        payload = json.loads([m for m in sent if m.get("role") == "tool"][0]["content"])
        self.assertFalse(payload["ok"])
        self.assertEqual(payload["error"], "invalid_arguments")
        self.assertEqual(result.reply, "Уточни, пожалуйста, верный ответ.")

    def test_tool_outside_the_mode_is_refused(self) -> None:
        """`schedule_review` не входит в practice — режим правило, а не просьба."""
        from ai_engine.skills import router

        response = self._response(
            content="сейчас назначу",
            tool_calls=[self._tool_call("schedule_review", '{"rating": "GOOD"}')],
        )
        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = response
            result = router.route_and_run(
                user_message="повторили", history=[], mode="practice",
                user_email="student@example.com", topic_name="Инерция",
            )

        self.assertEqual(result.skill, "chat")
        self.assertEqual(client.chat.completions.create.call_count, 1)

    def test_contest_mode_exposes_no_tools_in_the_request(self) -> None:
        from ai_engine.skills import router

        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = self._response(content="ok")
            router.route_and_run(
                user_message="подскажи", history=[], mode="contest",
                user_email="student@example.com", topic_name="Инерция",
            )
        self.assertNotIn("tools", client.chat.completions.create.call_args.kwargs)

    def test_endless_tool_calling_is_capped(self) -> None:
        """Модель умеет зацикливаться, а каждый круг — оплаченный запрос."""
        from ai_engine.skills import router

        looping = self._response(
            tool_calls=[
                self._tool_call(
                    "check_answer", json.dumps({"student_answer": "1", "expected_answer": "1"})
                )
            ]
        )
        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.return_value = looping
            result = router.route_and_run(
                user_message="проверь", history=[], mode="practice",
                user_email="student@example.com", topic_name="Инерция",
            )

        self.assertEqual(client.chat.completions.create.call_count, MAX_TOOL_ROUNDS)
        self.assertEqual(result.skill, "chat")
        self.assertTrue(result.reply.strip())

    def test_a_skill_still_short_circuits_without_a_second_call(self) -> None:
        """Скилл сам формирует ответ — второй запрос к модели не нужен."""
        from ai_engine.skills import router

        response = self._response(
            content="сейчас нарисую",
            tool_calls=[self._tool_call("draw_board", '{"topic": "силы"}')],
        )
        with patch.object(router.SKILLS["draw_board"], "run") as board_run:
            board_run.return_value = router.SkillResult(reply="", skill="draw_board")
            with patch.object(router, "openrouter_client") as client:
                client.chat.completions.create.return_value = response
                result = router.route_and_run(
                    user_message="нарисуй силы", history=[], mode="explain",
                    user_email="student@example.com", topic_name="Инерция",
                )

        board_run.assert_called_once()
        self.assertEqual(client.chat.completions.create.call_count, 1)
        # Скилл реплики не дал — показываем текст модели, иначе чат молчит.
        self.assertEqual(result.reply, "сейчас нарисую")

    def test_tool_context_comes_from_the_backend_not_the_model(self) -> None:
        """Модель не может подменить пользователя аргументами инструмента."""
        from ai_engine.skills import router

        first = self._response(tool_calls=[self._tool_call("get_topic_state", "{}")])
        second = self._response(content="Ты только начал тему.")

        with patch.object(router, "openrouter_client") as client:
            client.chat.completions.create.side_effect = [first, second]
            router.route_and_run(
                user_message="что я знаю?", history=[], mode="explain",
                user_email="student@example.com", topic_name="Инерция",
            )

        sent = client.chat.completions.create.call_args_list[1].kwargs["messages"]
        payload = json.loads([m for m in sent if m.get("role") == "tool"][0]["content"])
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["topic"], "Инерция")

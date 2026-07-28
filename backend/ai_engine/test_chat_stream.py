"""Focused tests for the streaming chat path (/api/ai/chat/stream/).

Три вещи здесь легко сломать молча, поэтому они закрыты тестами:

1. Сборка tool-call из стрим-дельт. В стриме имя функции приходит в первой
   дельте, а `arguments` дописываются по кускам — если собрать неверно,
   отвалится рисование доски, причём без ошибки: JSON просто не распарсится и
   скилл получит пустые аргументы.
2. Учёт токенов. Финальный чанк с usage не содержит `choices`, и наивный цикл
   его пропустит — оплаченные токены исчезнут из леджера бесшумно.
3. Маппинг ошибок провайдера по КЛАССУ исключения. APITimeoutError наследуется
   от APIConnectionError, поэтому порядок проверок критичен: перепутав их,
   любой таймаут превратится в 503 вместо 504.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from unittest.mock import patch

import httpx
from django.test import TestCase
from openai import APIConnectionError, APITimeoutError, NotFoundError, RateLimitError

from .llm_errors import llm_error_response
from .skills.router import _assemble_tool_calls, route_and_run_streaming


def _delta(*, content=None, reasoning=None, tool_calls=None):
    return SimpleNamespace(
        choices=[SimpleNamespace(delta=SimpleNamespace(
            content=content, reasoning=reasoning, tool_calls=tool_calls
        ))],
        usage=None,
    )


def _tool_delta(index, name=None, arguments=None):
    return SimpleNamespace(
        index=index,
        function=SimpleNamespace(name=name, arguments=arguments),
    )


def _usage_chunk(total=91, reasoning_tokens=54):
    """Финальный чанк OpenRouter: есть usage, но НЕТ choices."""
    return SimpleNamespace(
        choices=[],
        id="gen-test",
        model="z-ai/glm-4.6v",
        usage={
            "prompt_tokens": 7,
            "completion_tokens": 84,
            "total_tokens": total,
            "completion_tokens_details": {"reasoning_tokens": reasoning_tokens},
        },
    )


class AssembleToolCallsTests(TestCase):
    def test_arguments_are_concatenated_across_deltas(self) -> None:
        buffer = {0: {"name": "draw_board", "arguments": '{"topic": "трение"}'}}
        self.assertEqual(
            _assemble_tool_calls(buffer),
            [{"name": "draw_board", "arguments": '{"topic": "трение"}'}],
        )

    def test_calls_without_a_name_are_dropped(self) -> None:
        buffer = {0: {"name": "", "arguments": "{}"}}
        self.assertEqual(_assemble_tool_calls(buffer), [])

    def test_calls_are_ordered_by_index_not_insertion(self) -> None:
        buffer = {
            1: {"name": "second", "arguments": "{}"},
            0: {"name": "first", "arguments": "{}"},
        }
        self.assertEqual([c["name"] for c in _assemble_tool_calls(buffer)], ["first", "second"])


class StreamingRouterTests(TestCase):
    def _run(self, chunks):
        with patch("ai_engine.skills.router.openrouter_client") as client, \
                patch("ai_engine.skills.router.record_model_usage") as record:
            client.chat.completions.create.return_value = iter(chunks)
            events = list(route_and_run_streaming(user_message="привет", history=[]))
        return events, record

    def test_reasoning_and_content_are_streamed_separately(self) -> None:
        events, _ = self._run([
            _delta(reasoning="Дум"),
            _delta(reasoning="аю"),
            _delta(content="При"),
            _delta(content="вет"),
        ])
        kinds = [name for name, _ in events]
        self.assertEqual(kinds.count("reasoning"), 2)
        self.assertEqual(kinds.count("content"), 2)

        done = [payload for name, payload in events if name == "done"][0]
        self.assertEqual(done["reply"], "Привет")
        self.assertEqual(done["reasoning"], "Думаю")
        self.assertEqual(done["skill"], "chat")

    def test_first_event_is_the_routing_stage(self) -> None:
        events, _ = self._run([_delta(content="ок")])
        self.assertEqual(events[0], ("stage", {"stage": "routing"}))

    def test_tool_call_split_across_deltas_is_reassembled(self) -> None:
        chunks = [
            _delta(tool_calls=[_tool_delta(0, name="draw_board", arguments='{"to')]),
            _delta(tool_calls=[_tool_delta(0, arguments='pic": "т')]),
            _delta(tool_calls=[_tool_delta(0, arguments='рение"}')]),
        ]
        with patch("ai_engine.skills.router.openrouter_client") as client, \
                patch("ai_engine.skills.router.record_model_usage"), \
                patch.dict("ai_engine.skills.router.SKILLS", {}, clear=False) as skills:
            client.chat.completions.create.return_value = iter(chunks)
            captured = {}

            class FakeBoardSkill:
                # as_tool() нужен с тех пор, как стриминг стал собирать список
                # инструментов через tools_for_mode(mode), а не брать готовую
                # константу ROUTABLE_TOOLS: режим обязан управлять и стримом.
                def as_tool(self):
                    return {
                        "type": "function",
                        "function": {"name": "draw_board", "description": "", "parameters": {}},
                    }

                def run(self, **kwargs):
                    captured.update(kwargs)
                    from .skills.base import SkillResult
                    return SkillResult(reply="готово", board={"board_steps": []}, skill="draw_board")

            skills["draw_board"] = FakeBoardSkill()
            events = list(route_and_run_streaming(user_message="нарисуй", history=[]))

        # Аргументы собрались в валидный JSON и доехали до скилла целиком.
        self.assertEqual(captured.get("topic"), "трение")
        self.assertIn(("stage", {"stage": "drawing"}), events)
        done = [payload for name, payload in events if name == "done"][0]
        self.assertEqual(done["skill"], "draw_board")

    def test_final_usage_chunk_without_choices_is_recorded(self) -> None:
        events, record = self._run([_delta(content="ок"), _usage_chunk()])

        record.assert_called_once()
        recorded_chunk = record.call_args.args[0]
        self.assertEqual(recorded_chunk.usage["total_tokens"], 91)
        self.assertEqual(record.call_args.kwargs["feature"], "board_router_stream")
        # Чанк без choices не должен превратиться в пустую content-дельту.
        self.assertEqual([n for n, _ in events].count("content"), 1)

    def test_stream_without_usage_chunk_does_not_record(self) -> None:
        _, record = self._run([_delta(content="ок")])
        record.assert_not_called()


class LLMErrorResponseTests(TestCase):
    def setUp(self) -> None:
        self.request = httpx.Request("POST", "https://openrouter.ai/api/v1/chat/completions")

    def _response(self, exc):
        return httpx.Response(status_code=500, request=self.request)

    def test_timeout_maps_to_504_not_503(self) -> None:
        # APITimeoutError наследуется от APIConnectionError — порядок проверок
        # в llm_errors должен ловить таймаут первым.
        res = llm_error_response(APITimeoutError(self.request), base_url="x", model="m")
        self.assertEqual(res.status_code, 504)

    def test_connection_error_maps_to_503(self) -> None:
        exc = APIConnectionError(message="connection refused", request=self.request)
        res = llm_error_response(exc, base_url="x", model="m")
        self.assertEqual(res.status_code, 503)

    def test_missing_model_names_the_model(self) -> None:
        exc = NotFoundError("no endpoints", response=self._response(None), body=None)
        res = llm_error_response(exc, base_url="x", model="z-ai/glm-4.6v")
        self.assertEqual(res.status_code, 502)
        self.assertIn("z-ai/glm-4.6v", res.data["error"])

    def test_rate_limit_maps_to_429(self) -> None:
        exc = RateLimitError("slow down", response=self._response(None), body=None)
        res = llm_error_response(exc, base_url="x", model="m")
        self.assertEqual(res.status_code, 429)


class ChatStreamViewTests(TestCase):
    URL = "/api/ai/chat/stream/"

    def test_empty_message_is_rejected_before_streaming(self) -> None:
        res = self.client.post(self.URL, {"message": "  "}, content_type="application/json")
        self.assertEqual(res.status_code, 400)

    def test_stream_emits_sse_events(self) -> None:
        def fake_stream(**kwargs):
            yield "stage", {"stage": "routing"}
            yield "reasoning", {"delta": "думаю"}
            yield "done", {"reply": "привет", "board": None, "skill": "chat"}

        with patch("ai_engine.chat_views.route_and_run_streaming", fake_stream):
            res = self.client.post(
                self.URL, {"message": "привет"}, content_type="application/json"
            )
            body = b"".join(res.streaming_content).decode()

        self.assertEqual(res["Content-Type"], "text/event-stream")
        self.assertEqual(res["X-Accel-Buffering"], "no")
        # no-transform обязателен: без него Next.js-прокси жмёт поток gzip'ом,
        # компрессор копит его в буфере, и браузер получает все события одним
        # куском в конце. Замерено вживую: 124 reasoning-фрейма с
        # firstReasoningMs == totalMs == 6051, блок «Думаю…» тикал секундами,
        # но текст рассуждения не появлялся ни разу.
        self.assertIn("no-transform", res["Cache-Control"])
        self.assertIn("event: reasoning", body)
        # Кириллица едет как есть, а не как \uXXXX — иначе поток втрое тяжелее.
        self.assertIn("думаю", body)
        self.assertIn("event: done", body)

    def test_provider_failure_arrives_as_an_error_event(self) -> None:
        def exploding_stream(**kwargs):
            raise APITimeoutError(httpx.Request("POST", "https://openrouter.ai/v1"))
            yield  # pragma: no cover - делает функцию генератором

        with patch("ai_engine.chat_views.route_and_run_streaming", exploding_stream):
            res = self.client.post(
                self.URL, {"message": "привет"}, content_type="application/json"
            )
            body = b"".join(res.streaming_content).decode()

        # Заголовки уже ушли с кодом 200, поэтому ошибка обязана приехать
        # событием — иначе фронтенд молча покажет пустой ответ.
        self.assertEqual(res.status_code, 200)
        self.assertIn("event: error", body)
        payload = json.loads(body.split("event: error\ndata: ")[1].split("\n")[0])
        self.assertIn("вовремя", payload["error"])

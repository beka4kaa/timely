"""Транспорт структурированных JSON-запросов: схема, провайдеры, дедлайн.

Проверяется ровно то, что нельзя проверить на живом вызове дёшево: какая форма
запроса уходит провайдеру и что происходит, когда он не отвечает.
"""

from __future__ import annotations

import threading
import time
from unittest.mock import patch

from django.test import SimpleTestCase

from . import text_llm
from .text_llm import TextModel


class _Message:
    def __init__(self, content: str) -> None:
        self.content = content


class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _Message(content)


class _Response:
    """Минимальный ответ SDK: `record_model_usage` большего и не требует."""

    def __init__(self, content: str = '{"ok":true}') -> None:
        self.choices = [_Choice(content)]
        self.usage = None
        self.model = "vendor/model"


class _RecordingClient:
    """Перехватывает аргументы `chat.completions.create`, не ходя в сеть."""

    def __init__(self, *, delay: float = 0.0, response: _Response | None = None) -> None:
        self.calls: list[dict] = []
        self.delay = delay
        self.response = response or _Response()
        self.chat = self
        self.completions = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        if self.delay:
            time.sleep(self.delay)
        return self.response


class _ClientFixture:
    """Подменяет и клиент, и ключ: без ключа функция падает раньше проверки."""

    def __init__(self, client: _RecordingClient) -> None:
        self.client = client
        self._patches = [
            patch.object(text_llm, "OpenAI", lambda **_: client),
            patch.object(text_llm, "TEXT_LLM_API_KEY", "test-key"),
            patch.object(text_llm, "record_model_usage", lambda *a, **k: None),
        ]

    def __enter__(self) -> _RecordingClient:
        for p in self._patches:
            p.start()
        return self.client

    def __exit__(self, *exc) -> None:
        for p in reversed(self._patches):
            p.stop()


class StructuredOutputRequestTests(SimpleTestCase):
    def test_without_schema_stays_on_plain_json_mode(self):
        with _ClientFixture(_RecordingClient()) as client:
            TextModel("vendor/model").generate_json_content(
                system_prompt="s", payload={}, timeout=5, max_tokens=100
            )
        self.assertEqual(
            client.calls[0]["response_format"], {"type": "json_object"}
        )
        # Без явного списка провайдеров маршрутизация остаётся дефолтной.
        self.assertNotIn("provider", client.calls[0]["extra_body"])

    def test_schema_is_sent_as_strict_json_schema(self):
        schema = {"type": "object", "properties": {}, "required": []}
        with _ClientFixture(_RecordingClient()) as client:
            TextModel("vendor/model").generate_json_content(
                system_prompt="s",
                payload={},
                timeout=5,
                max_tokens=100,
                json_schema=schema,
                schema_name="course_plan",
            )
        sent = client.calls[0]["response_format"]
        self.assertEqual(sent["type"], "json_schema")
        self.assertEqual(sent["json_schema"]["name"], "course_plan")
        self.assertIs(sent["json_schema"]["schema"], schema)
        # strict обязателен: без него провайдер вправе вернуть «похожий» JSON.
        self.assertTrue(sent["json_schema"]["strict"])

    def test_provider_allow_list_sorts_by_throughput(self):
        with _ClientFixture(_RecordingClient()) as client:
            TextModel("vendor/model").generate_json_content(
                system_prompt="s",
                payload={},
                timeout=5,
                max_tokens=100,
                providers=("together", "morph"),
            )
        provider = client.calls[0]["extra_body"]["provider"]
        self.assertEqual(provider["only"], ["together", "morph"])
        self.assertEqual(provider["sort"], "throughput")
        # require_parameters НЕ отправляем: замерено, что он уводит на самого
        # медленного из подходящих провайдеров и игнорирует явный order.
        self.assertNotIn("require_parameters", provider)

    def test_reasoning_block_survives_provider_options(self):
        """`provider` добавляется рядом с `reasoning`, а не вместо него."""
        with _ClientFixture(_RecordingClient()) as client:
            TextModel("vendor/model").generate_json_content(
                system_prompt="s",
                payload={},
                timeout=5,
                max_tokens=100,
                reasoning_effort="low",
                providers=("together",),
            )
        extra = client.calls[0]["extra_body"]
        self.assertEqual(extra["reasoning"], {"enabled": True, "effort": "low"})
        self.assertIn("provider", extra)


class WallClockBackstopTests(SimpleTestCase):
    def test_hung_provider_raises_instead_of_hanging(self):
        # httpx считает `timeout` простоем между чанками, поэтому «медленный»
        # клиент здесь его не срабатывает — сдаться должен именно backstop.
        with _ClientFixture(_RecordingClient(delay=5.0)):
            with patch.object(text_llm, "_WALL_CLOCK_GRACE_SECONDS", 0):
                with self.assertRaises(TimeoutError):
                    TextModel("vendor/model").generate_json_content(
                        system_prompt="s", payload={}, timeout=1, max_tokens=10
                    )

    def test_fast_call_returns_normally(self):
        with _ClientFixture(_RecordingClient(response=_Response('{"a":1}'))):
            response = TextModel("vendor/model").generate_json_content(
                system_prompt="s", payload={}, timeout=5, max_tokens=10
            )
        self.assertEqual(response.text, '{"a":1}')

    def test_usage_context_reaches_the_worker_thread(self):
        """ContextVar не наследуется тредом — контекст обязан копироваться.

        Без явного `contextvars.copy_context()` расход писался бы анонимным:
        `record_model_usage` берёт e-mail и feature из контекста вызова.
        """
        seen: dict[str, str] = {}

        def fake_record(*_args, **kwargs):
            from .usage import current_usage_context

            context = current_usage_context()
            seen["email"] = context.user_email
            seen["thread"] = threading.current_thread().name

        from .usage import usage_scope

        client = _RecordingClient()
        with patch.object(text_llm, "OpenAI", lambda **_: client), patch.object(
            text_llm, "TEXT_LLM_API_KEY", "test-key"
        ), patch.object(text_llm, "record_model_usage", fake_record):
            with usage_scope(user_email="pupil@example.com", feature="course_planning"):
                TextModel("vendor/model").generate_json_content(
                    system_prompt="s", payload={}, timeout=5, max_tokens=10
                )

        self.assertEqual(seen["email"], "pupil@example.com")
        # Учёт действительно случился в рабочем треде, а не в вызывающем.
        self.assertTrue(seen["thread"].startswith("text-llm-json"))

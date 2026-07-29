"""Тесты коротких имён чатов (chat_title.py)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from ai_engine.chat_title import (
    DEFAULT_TITLE,
    MAX_TITLE_WORDS,
    fallback_title,
    generate_chat_title,
)
from ai_engine.models import ChatSession

EMAIL = "student@example.com"


def user_msg(text: str) -> dict:
    return {"id": "1", "role": "user", "content": text}


def model_returns(text: str):
    """Подменяет текстовую модель, не трогая сеть."""
    return patch(
        "ai_engine.chat_title.text_llm.get_text_model",
        return_value=SimpleNamespace(
            generate_content=lambda _prompt: SimpleNamespace(text=text)
        ),
    )


class TitleTidyTests(TestCase):
    def setUp(self) -> None:
        self.configured = patch(
            "ai_engine.chat_title.text_llm.is_configured", return_value=True
        )
        self.configured.start()
        self.addCleanup(self.configured.stop)

    def test_greeting_stays_itself(self) -> None:
        with model_returns("Привет"):
            self.assertEqual(generate_chat_title([user_msg("привет")]), "Привет")

    def test_long_request_becomes_short_topic(self) -> None:
        with model_returns("Сила трения"):
            title = generate_chat_title(
                [user_msg("Объясни мне, пожалуйста, тему по физике про силу трения")]
            )
        self.assertEqual(title, "Сила трения")

    def test_never_longer_than_three_words(self) -> None:
        with model_returns("Очень длинное название которое модель придумала зря"):
            title = generate_chat_title([user_msg("что-то")])
        self.assertLessEqual(len(title.split()), MAX_TITLE_WORDS)

    def test_quotes_and_prefixes_are_stripped(self) -> None:
        with model_returns('Название: «Сила трения».'):
            self.assertEqual(generate_chat_title([user_msg("x")]), "Сила трения")

    def test_first_letter_is_capitalised_without_touching_the_rest(self) -> None:
        with model_returns("pH раствора"):
            # «PH раствора» было бы ошибкой: регистр внутри слова осмысленный.
            self.assertEqual(generate_chat_title([user_msg("x")]), "PH раствора")

    def test_planning_banners_are_not_used_as_the_title(self) -> None:
        messages = [
            {"id": "0", "role": "assistant", "content": "План принят", "planningEvent": True},
            {"id": "1", "role": "user", "content": "План принят", "planningEvent": True},
            user_msg("Закон Ома"),
        ]
        with model_returns("Закон Ома"):
            self.assertEqual(generate_chat_title(messages), "Закон Ома")


class TitleFallbackTests(TestCase):
    def test_empty_chat_gets_default_title(self) -> None:
        self.assertEqual(generate_chat_title([]), DEFAULT_TITLE)
        self.assertEqual(generate_chat_title(None), DEFAULT_TITLE)

    def test_model_failure_falls_back_to_first_words(self) -> None:
        # Имя — не повод терять чат: сохранение обязано пройти без модели.
        with patch(
            "ai_engine.chat_title.text_llm.is_configured", return_value=True
        ), patch(
            "ai_engine.chat_title.text_llm.get_text_model",
            side_effect=RuntimeError("провайдер недоступен"),
        ):
            title = generate_chat_title([user_msg("Объясни силу трения подробно")])

        self.assertEqual(title, "Объясни силу трения")
        self.assertLessEqual(len(title.split()), MAX_TITLE_WORDS)

    def test_unconfigured_model_uses_fallback(self) -> None:
        with patch("ai_engine.chat_title.text_llm.is_configured", return_value=False):
            self.assertEqual(generate_chat_title([user_msg("привет")]), "Привет")

    def test_fallback_is_also_bounded(self) -> None:
        self.assertLessEqual(
            len(fallback_title([user_msg("а" * 200)]).split()), MAX_TITLE_WORDS
        )


class TitleOnCreateTests(TestCase):
    """Имя принадлежит backend: клиент его не присылает и не перезаписывает."""

    def setUp(self) -> None:
        self.client = APIClient()

    def _post(self, payload: dict):
        return self.client.post(
            "/api/ai_engine/chat-sessions/",
            payload,
            format="json",
            HTTP_X_USER_EMAIL=EMAIL,
        )

    def test_backend_names_the_session_when_client_sends_none(self) -> None:
        with patch(
            "ai_engine.views.generate_chat_title", return_value="Сила трения"
        ) as gen:
            response = self._post(
                {
                    "id": "44444444-4444-4444-4444-444444444444",
                    "messages": [user_msg("расскажи про силу трения")],
                }
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["title"], "Сила трения")
        gen.assert_called_once()

    def test_explicit_title_from_client_wins(self) -> None:
        # Переименование из интерфейса должно оставаться возможным.
        with patch("ai_engine.views.generate_chat_title") as gen:
            response = self._post(
                {
                    "id": "55555555-5555-5555-5555-555555555555",
                    "title": "Моё имя",
                    "messages": [user_msg("привет")],
                }
            )

        self.assertEqual(response.data["title"], "Моё имя")
        gen.assert_not_called()

    def test_saved_title_survives_later_updates(self) -> None:
        # Автосейв больше не шлёт title — и не должен затирать сгенерированное.
        with patch("ai_engine.views.generate_chat_title", return_value="Закон Ома"):
            self._post(
                {
                    "id": "66666666-6666-6666-6666-666666666666",
                    "messages": [user_msg("закон ома")],
                }
            )

        self.client.patch(
            "/api/ai_engine/chat-sessions/66666666-6666-6666-6666-666666666666/",
            {"messages": [user_msg("закон ома"), user_msg("а ещё?")]},
            format="json",
            HTTP_X_USER_EMAIL=EMAIL,
        )

        session = ChatSession.objects.get(id="66666666-6666-6666-6666-666666666666")
        self.assertEqual(session.title, "Закон Ома")

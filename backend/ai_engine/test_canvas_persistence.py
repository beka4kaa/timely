"""Содержимое доски сохраняется вместе с сессией чата."""

from __future__ import annotations

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from ai_engine.models import ChatSession
from ai_engine.serializers import MAX_CANVAS_BYTES

EMAIL = "student@example.com"

CANVAS = {
    "elements": [
        {"id": "1", "type": "SHAPE", "shape": "path", "points": [[0, 0], [10, 10]]},
        {"id": "2", "type": "TEXT", "content": "закон Ома"},
        {"id": "3", "type": "ILLUSTRATION", "src": "data:image/png;base64,AAAA", "labels": []},
    ],
    "strokes": [
        {
            "id": "s1",
            "color": "#302d2a",
            "lineWidth": 3,
            "points": [{"x": 0, "y": 0, "pressure": 0.5}, {"x": 8, "y": 12, "pressure": 0.6}],
        }
    ],
    "camera": {"x": 12, "y": 34, "zoom": 1.5},
}


class CanvasPersistenceTests(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()
        # Создание сессии придумывает ей имя через модель. Тесту это не нужно,
        # а живой запрос к провайдеру в юнит-тестах недопустим.
        title = patch("ai_engine.views.generate_chat_title", return_value="Доска")
        title.start()
        self.addCleanup(title.stop)

    def create(self, session_id: str, **extra):
        payload = {"id": session_id, "messages": [], "canvas": CANVAS}
        payload.update(extra)
        return self.client.post(
            "/api/ai_engine/chat-sessions/", payload, format="json", HTTP_X_USER_EMAIL=EMAIL
        )

    def test_canvas_is_stored_and_returned(self) -> None:
        response = self.create("11111111-1111-1111-1111-111111111111")
        self.assertEqual(response.status_code, 201)

        detail = self.client.get(
            "/api/ai_engine/chat-sessions/11111111-1111-1111-1111-111111111111/",
            HTTP_X_USER_EMAIL=EMAIL,
        )
        self.assertEqual(detail.data["canvas"], CANVAS)

    def test_drawings_texts_and_illustrations_all_survive(self) -> None:
        self.create("22222222-2222-2222-2222-222222222222")
        stored = ChatSession.objects.get(id="22222222-2222-2222-2222-222222222222").canvas

        kinds = {element["type"] for element in stored["elements"]}
        self.assertEqual(kinds, {"SHAPE", "TEXT", "ILLUSTRATION"})

    def test_camera_is_part_of_the_snapshot(self) -> None:
        # Без камеры восстановленная доска открывалась бы в произвольном месте.
        self.create("33333333-3333-3333-3333-333333333333")
        stored = ChatSession.objects.get(id="33333333-3333-3333-3333-333333333333").canvas
        self.assertEqual(stored["camera"], {"x": 12, "y": 34, "zoom": 1.5})

    def test_canvas_updates_without_touching_messages(self) -> None:
        # Автосейв доски шлёт ТОЛЬКО canvas — переписка обязана уцелеть.
        self.create("44444444-4444-4444-4444-444444444444", messages=[{"role": "user", "content": "привет"}])
        self.client.patch(
            "/api/ai_engine/chat-sessions/44444444-4444-4444-4444-444444444444/",
            {"canvas": {"elements": [], "camera": {"x": 0, "y": 0, "zoom": 1}}},
            format="json",
            HTTP_X_USER_EMAIL=EMAIL,
        )
        session = ChatSession.objects.get(id="44444444-4444-4444-4444-444444444444")

        self.assertEqual(session.messages, [{"role": "user", "content": "привет"}])
        self.assertEqual(session.canvas["elements"], [])

    def test_session_without_canvas_defaults_to_empty(self) -> None:
        # Сессии, сохранённые до появления поля, обязаны открываться.
        response = self.client.post(
            "/api/ai_engine/chat-sessions/",
            {"id": "55555555-5555-5555-5555-555555555555", "messages": []},
            format="json",
            HTTP_X_USER_EMAIL=EMAIL,
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["canvas"], {})

    def test_history_list_does_not_ship_the_canvas(self) -> None:
        # Список истории обязан оставаться лёгким: холст с картинками весит
        # мегабайты, и тащить его на каждое открытие поповера нельзя.
        self.create("66666666-6666-6666-6666-666666666666")
        listing = self.client.get("/api/ai_engine/chat-sessions/", HTTP_X_USER_EMAIL=EMAIL)

        self.assertNotIn("canvas", listing.data[0])

    def test_oversized_canvas_is_rejected_loudly(self) -> None:
        # Молча обрезать нельзя: это потеря рисунков без ведома ученика.
        huge = {"elements": [{"id": "1", "src": "x" * (MAX_CANVAS_BYTES + 1000)}]}
        response = self.client.post(
            "/api/ai_engine/chat-sessions/",
            {"id": "77777777-7777-7777-7777-777777777777", "messages": [], "canvas": huge},
            format="json",
            HTTP_X_USER_EMAIL=EMAIL,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("canvas", str(response.data).lower())

    def test_pencil_strokes_survive_the_round_trip(self) -> None:
        # Регрессия: штрихи карандаша жили в React-state хука, вне стора доски.
        # Рисование не будило автосейв и не попадало в снимок — ученик рисовал,
        # перезагружал страницу и терял всё, не увидев даже запроса в Network.
        self.create("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
        stored = ChatSession.objects.get(id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").canvas

        self.assertEqual(len(stored["strokes"]), 1)
        self.assertEqual(stored["strokes"][0]["points"][1], {"x": 8, "y": 12, "pressure": 0.6})

    def test_strokes_must_be_a_list(self) -> None:
        response = self.client.post(
            "/api/ai_engine/chat-sessions/",
            {
                "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                "messages": [],
                "canvas": {"elements": [], "strokes": {"nope": True}},
            },
            format="json",
            HTTP_X_USER_EMAIL=EMAIL,
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("strokes", str(response.data).lower())

    def test_canvas_without_strokes_key_still_valid(self) -> None:
        # Сессии, сохранённые до появления штрихов, обязаны открываться.
        response = self.create(
            "cccccccc-cccc-cccc-cccc-cccccccccccc",
            canvas={"elements": [], "camera": {"x": 0, "y": 0, "zoom": 1}},
        )
        self.assertEqual(response.status_code, 201)

    def test_canvas_above_djangos_default_body_limit_is_accepted(self) -> None:
        # Регрессия: DATA_UPLOAD_MAX_MEMORY_SIZE не был задан, и Django резал
        # тело на 2.5 МБ раньше, чем сериализатор доходил до своего предела в
        # 12 МБ. Доска с несколькими иллюстрациями молча переставала
        # сохраняться, а клиент проглатывал ошибку.
        big = {"elements": [{"id": "1", "type": "ILLUSTRATION", "src": "x" * (4 * 1024 * 1024)}]}
        response = self.client.post(
            "/api/ai_engine/chat-sessions/",
            {"id": "dddddddd-dddd-dddd-dddd-dddddddddddd", "messages": [], "canvas": big},
            format="json",
            HTTP_X_USER_EMAIL=EMAIL,
        )
        self.assertEqual(response.status_code, 201)

    def test_canvas_must_be_an_object(self) -> None:
        response = self.client.post(
            "/api/ai_engine/chat-sessions/",
            {"id": "88888888-8888-8888-8888-888888888888", "messages": [], "canvas": [1, 2]},
            format="json",
            HTTP_X_USER_EMAIL=EMAIL,
        )
        self.assertEqual(response.status_code, 400)

    def test_other_accounts_cannot_read_the_canvas(self) -> None:
        self.create("99999999-9999-9999-9999-999999999999")
        response = self.client.get(
            "/api/ai_engine/chat-sessions/99999999-9999-9999-9999-999999999999/",
            HTTP_X_USER_EMAIL="someone-else@example.com",
        )
        self.assertEqual(response.status_code, 404)

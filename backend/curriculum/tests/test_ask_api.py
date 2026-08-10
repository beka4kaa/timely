"""Эндпоинт вопроса по книге: доступ, форма потока и поведение при отказе.

Модель подменяется: проверяется обвязка, а не её ответы. Смысловая часть —
что уходит в промпт — живёт в `test_ask.py`.
"""

from __future__ import annotations

import json
from unittest import mock

from django.test import TestCase

from curriculum.ask import OUTSIDE_MARKER
from curriculum.models import Document, KnowledgeChunk, LearningGoal

OWNER = "owner@example.com"
INTRUDER = "intruder@example.com"
URL = "/api/curriculum/ask/stream"


def _auth(email: str) -> dict:
    return {"HTTP_X_USER_EMAIL": email}


def _events(response) -> list[tuple[str, dict]]:
    """Разбирает поток в список `(событие, данные)`."""
    body = b"".join(response.streaming_content).decode("utf-8")
    parsed: list[tuple[str, dict]] = []
    for block in body.split("\n\n"):
        lines = [line for line in block.split("\n") if line.strip()]
        if len(lines) < 2:
            continue
        event = lines[0].removeprefix("event: ").strip()
        data = json.loads(lines[1].removeprefix("data: "))
        parsed.append((event, data))
    return parsed


def _stream(*chunks):
    """Подменяет поток модели заданными кусочками текста."""
    return mock.patch(
        "ai_engine.text_llm.TextModel.stream_content",
        lambda self, messages, **kwargs: iter(chunks),
    )


class AskStreamTests(TestCase):
    def setUp(self):
        self.goal = LearningGoal.objects.create(
            user_email=OWNER, original_text="механика"
        )
        self.document = Document.objects.create(
            user_email=OWNER,
            goal=self.goal,
            title="Механика",
            ingestion_status=Document.Status.READY,
        )
        KnowledgeChunk.objects.create(
            document_id=self.document.pk,
            normalized_text="Импульс тела равен произведению массы на скорость",
            content_hash="a" * 64,
            processing_version=self.document.processing_version,
            section_path="§ 5.2",
            page_start=292,
            page_end=292,
        )

    def _post(self, question="импульс", email=OWNER, goal=None, **body):
        return self.client.post(
            URL,
            data=json.dumps(
                {
                    "goal_id": str((goal or self.goal).pk),
                    "message": question,
                    **body,
                }
            ),
            content_type="application/json",
            **_auth(email),
        )

    def _ask(self, *chunks, **kwargs):
        """Спрашивает с подменённым потоком и СРАЗУ читает ответ.

        Читать обязательно внутри патча: тело `StreamingHttpResponse` — это
        генератор, и он исполняется в момент чтения. Прочитанный снаружи, он
        уходил в настоящую модель — тест ждал по пятнадцать секунд и тратил
        деньги.
        """
        with _stream(*chunks):
            response = self._post(**kwargs)
            events = _events(response) if response.status_code == 200 else []
        return response, events

    def test_поток_отдаётся_событиями(self):
        response, events = self._ask(
            "Импульс — это ", "произведение массы на скорость."
        )

        self.assertEqual(response["Content-Type"], "text/event-stream")
        names = [name for name, _ in events]
        # Три стадии подряд: ищу → нашёл → отвечаю. Ученик видит, что делается,
        # а не одну крутилку на всё время ожидания.
        self.assertEqual(names[:3], ["stage", "stage", "stage"])
        self.assertEqual(names[-1], "done")
        self.assertIn("content", names)
        self.assertIn("citations", names)

    def test_заголовки_запрещают_буферизацию(self):
        """Без них прокси копит поток и отдаёт всё одним куском в конце.

        Проверено на живом проде для чата доски: 124 события приходили
        одновременно, и «печать» ответа не работала вовсе.
        """
        response, _ = self._ask("текст")

        self.assertIn("no-transform", response["Cache-Control"])
        self.assertEqual(response["X-Accel-Buffering"], "no")

    def test_стадии_приходят_по_порядку(self):
        _, events = self._ask("ответ")
        stages = [d.get("stage") for n, d in events if n == "stage"]
        self.assertEqual(stages, ["retrieving", "found", "answering"])

    def test_цитата_несёт_название_книги_отдельно(self):
        """Панель показывает книгу один раз над списком, а не в каждой ссылке."""
        _, events = self._ask("ответ")
        item = dict(events)["citations"]["items"][0]
        self.assertEqual(item["document_title"], "Механика")
        self.assertEqual(item["section_path"], "§ 5.2")

    def test_ответ_по_книге_приходит_с_цитатами(self):
        _, events = self._ask("Импульс — это произведение массы на скорость.")
        by_name = dict(events)

        self.assertTrue(by_name["citations"]["grounded"])
        self.assertIn("§ 5.2", by_name["citations"]["items"][0]["label"])

    def test_ответ_вне_книги_без_цитат_и_без_маркера(self):
        """Маркер — сигнал интерфейсу; ученик не должен его увидеть."""
        _, events = self._ask(
            f"{OUTSIDE_MARKER}\nИсаак Ньютон — английский физик.",
            question="кто такой Ньютон",
        )
        by_name = dict(events)
        self.assertFalse(by_name["citations"]["grounded"])
        self.assertEqual(by_name["citations"]["items"], [])

        text = "".join(
            data["delta"] for name, data in events if name == "content"
        )
        self.assertNotIn(OUTSIDE_MARKER, text)
        self.assertIn("Исаак Ньютон", text)

    def test_маркер_узнаётся_разорванным_между_чанками(self):
        """Провайдер режет поток где хочет, в том числе посреди маркера."""
        _, events = self._ask("[ВНЕ ", "КНИГИ]\n", "Ответ от себя.")

        text = "".join(d["delta"] for n, d in events if n == "content")
        self.assertNotIn("[ВНЕ", text)
        self.assertIn("Ответ от себя.", text)
        self.assertFalse(dict(events)["done"]["grounded"])

    def test_чужой_предмет_не_находится(self):
        """404, а не 403: чужая цель не должна подтверждать своё существование."""
        response, _ = self._ask("текст", email=INTRUDER)
        self.assertEqual(response.status_code, 404)

    def test_пустой_вопрос_отклоняется_кодом(self):
        response, _ = self._ask("текст", question="   ")
        self.assertEqual(response.status_code, 400)

    def test_отказ_модели_приезжает_событием(self):
        """Заголовки уже отправлены — HTTP-код не поменять."""

        def boom(self, messages, **kwargs):
            raise RuntimeError("провайдер лёг")
            yield  # pragma: no cover — делает функцию генератором

        with mock.patch("ai_engine.text_llm.TextModel.stream_content", boom):
            response = self._post()
            events = _events(response)

        self.assertEqual(response.status_code, 200)
        by_name = dict(events)
        self.assertIn("провайдер лёг", by_name["error"]["error"])

    def test_предмет_без_готовых_книг_отвечает_вне_книги(self):
        empty_goal = LearningGoal.objects.create(
            user_email=OWNER, original_text="химия"
        )
        _, events = self._ask(
            f"{OUTSIDE_MARKER}\nОтвечаю от себя.",
            question="что такое моль",
            goal=empty_goal,
        )
        # События `stage` приходят тройкой, поэтому берём нужное по имени, а не
        # схлопываем всё в словарь: там побеждало бы последнее.
        found = next(d for n, d in events if n == "stage" and "found" in d)
        by_name = dict(events)
        self.assertEqual(found["found"], 0)
        self.assertFalse(by_name["citations"]["grounded"])
        self.assertEqual(by_name["done"]["grounded"], False)

    def test_решение_не_доезжает_до_модели(self):
        """Тот же рубеж, что и в поиске: режим ученика запрещает решения."""
        KnowledgeChunk.objects.create(
            document_id=self.document.pk,
            normalized_text="Ответ: p = 12 кг·м/с",
            content_hash="b" * 64,
            processing_version=self.document.processing_version,
            chunk_type=KnowledgeChunk.ChunkType.SOLUTION,
            solution_visibility=KnowledgeChunk.SolutionVisibility.RESTRICTED,
        )
        seen: list[list[dict]] = []

        def capture(self, messages, **kwargs):
            seen.append(messages)
            return iter(["ответ"])

        with mock.patch("ai_engine.text_llm.TextModel.stream_content", capture):
            _events(self._post("импульс"))

        blob = " ".join(m["content"] for m in seen[0])
        self.assertNotIn("12 кг·м/с", blob)

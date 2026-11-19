"""Оценки ответов тьютора: «нравится» и «не нравится».

Оценка хранится вместе с вопросом и ответом, чтобы потом было видно, что именно не
понравилось. Ответ ищется в сохранённом чате по моменту, когда он пришёл (`at`): так
не важно, что старые реплики обрезаются. Удалил чат — удалились и его оценки.
"""

from __future__ import annotations

from django.test import TestCase

from curriculum.models import AnswerFeedback, LearningGoal, SubjectChat
from config.testing import auth_headers

OWNER = "owner@example.com"
INTRUDER = "intruder@example.com"
CHATS = "/api/curriculum/chats/"


def make_chat(email: str = OWNER) -> SubjectChat:
    return SubjectChat.objects.create(
        user_email=email,
        goal=LearningGoal.objects.create(user_email=email, original_text="механика"),
        title="Импульс",
        messages=[
            {"role": "user", "content": "Что такое импульс?", "at": 1000},
            {"role": "assistant", "content": "Масса на скорость.", "at": 2000},
            {"role": "user", "content": "А момент силы?", "at": 3000},
            {"role": "assistant", "content": "Сила на плечо.", "at": 4000},
            {"role": "assistant", "content": "Старый ответ без времени"},
        ],
    )


class AnswerFeedbackTests(TestCase):
    def setUp(self):
        self.chat = make_chat()

    def rate(self, at, rating, chat=None, email=OWNER, **extra):
        chat = chat or self.chat
        return self.client.post(
            f"{CHATS}{chat.pk}/feedback/",
            data={"at": at, "rating": rating, **extra},
            content_type="application/json",
            **auth_headers(email),
        )

    def test_оценка_сохраняется_с_вопросом_и_ответом(self):
        response = self.rate(4000, 1, mode="plain", model="smart")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"rating": 1})
        row = AnswerFeedback.objects.get()
        self.assertEqual(
            (row.user_email, row.rating, row.question, row.answer, row.mode, row.model),
            (OWNER, 1, "А момент силы?", "Сила на плечо.", "plain", "smart"),
        )

    def test_передумал_и_оценка_меняется_без_дубля(self):
        self.rate(2000, 1)
        self.rate(2000, -1)
        self.assertEqual(AnswerFeedback.objects.count(), 1)
        self.assertEqual(AnswerFeedback.objects.get().rating, -1)

    def test_снял_оценку_и_её_нет(self):
        self.rate(2000, -1)
        response = self.rate(2000, 0)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(AnswerFeedback.objects.exists())

    def test_оценить_можно_только_ответ_тьютора(self):
        self.assertEqual(self.rate(1000, 1).status_code, 404)
        self.assertEqual(self.rate(9999, 1).status_code, 404)

    def test_оценка_только_плюс_или_минус_один(self):
        self.assertEqual(self.rate(2000, 5).status_code, 400)
        self.assertEqual(self.rate(2000, True).status_code, 400)
        self.assertEqual(self.rate("2000", 1).status_code, 400)

    def test_чужой_чат_не_оценить(self):
        foreign = make_chat(INTRUDER)
        self.assertEqual(self.rate(2000, 1, chat=foreign).status_code, 404)
        self.assertFalse(AnswerFeedback.objects.exists())

    def test_удалил_чат_и_оценок_нет(self):
        self.rate(2000, 1)
        self.client.delete(f"{CHATS}{self.chat.pk}/", **auth_headers(OWNER))
        self.assertFalse(AnswerFeedback.objects.exists())

    def test_без_входа_нельзя(self):
        response = self.client.post(
            f"{CHATS}{self.chat.pk}/feedback/", data={"at": 2000, "rating": 1}, content_type="application/json"
        )
        self.assertEqual(response.status_code, 401)

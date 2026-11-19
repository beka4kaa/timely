"""Публичная ссылка на разговор с тьютором.

Ссылка — снимок на момент, когда ученик поделился: новые сообщения в неё не попадают,
пока он сам её не обновит. По ссылке видно только текст реплик: цитаты из книг ученика
и служебные поля не уходят наружу. Удалил ссылку или чат — по ссылке ничего нет.
"""

from __future__ import annotations

from django.test import TestCase

from curriculum.models import LearningGoal, SharedChat, SubjectChat
from config.testing import auth_headers

OWNER = "owner@example.com"
INTRUDER = "intruder@example.com"
CHATS = "/api/curriculum/chats/"


def public_url(token: str) -> str:
    return f"/api/public/chats/{token}/"


def make_chat(email: str = OWNER, messages=None, title="Импульс") -> SubjectChat:
    return SubjectChat.objects.create(
        user_email=email,
        goal=LearningGoal.objects.create(user_email=email, original_text="механика"),
        title=title,
        messages=messages
        if messages is not None
        else [
            {"role": "user", "content": "Что такое импульс?"},
            {
                "role": "assistant",
                "content": "Импульс — это масса, умноженная на скорость.",
                "citations": [{"quote": "ТЕКСТ ИЗ КНИГИ УЧЕНИКА", "page": 12}],
                "grounded": True,
                "durationMs": 1200,
            },
            {"role": "assistant", "content": "", "error": "Сеть оборвалась"},
        ],
    )


class ChatShareTests(TestCase):
    def setUp(self):
        self.chat = make_chat()

    def share(self, chat=None, email=OWNER, method="post"):
        chat = chat or self.chat
        return getattr(self.client, method)(f"{CHATS}{chat.pk}/share/", **auth_headers(email))

    def test_нет_ссылки_пока_не_поделился(self):
        response = self.share(method="get")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"token": None, "shared_at": None})

    def test_ссылка_создаётся_и_читается_без_входа(self):
        created = self.share()
        self.assertEqual(created.status_code, 200)
        token = created.json()["token"]
        self.assertGreaterEqual(len(token), 20)

        public = self.client.get(public_url(token))
        self.assertEqual(public.status_code, 200)
        body = public.json()
        self.assertEqual(body["title"], "Импульс")
        self.assertEqual(
            body["messages"],
            [
                {"role": "user", "content": "Что такое импульс?"},
                {"role": "assistant", "content": "Импульс — это масса, умноженная на скорость."},
            ],
        )
        self.assertNotIn(OWNER, public.content.decode())
        self.assertEqual(public["X-Robots-Tag"], "noindex")

    def test_цитаты_из_книги_не_уходят_по_ссылке(self):
        token = self.share().json()["token"]
        self.assertNotIn("ТЕКСТ ИЗ КНИГИ УЧЕНИКА", self.client.get(public_url(token)).content.decode())

    def test_новые_сообщения_не_попадают_в_ссылку_пока_её_не_обновили(self):
        token = self.share().json()["token"]
        self.chat.messages = self.chat.messages + [{"role": "user", "content": "А момент силы?"}]
        self.chat.save()
        self.assertNotIn("А момент силы?", self.client.get(public_url(token)).content.decode())

        again = self.share()
        self.assertEqual(again.json()["token"], token)
        self.assertIn("А момент силы?", self.client.get(public_url(token)).content.decode())
        self.assertEqual(SharedChat.objects.count(), 1)

    def test_удалённая_ссылка_больше_не_открывается(self):
        token = self.share().json()["token"]
        removed = self.share(method="delete")
        self.assertEqual(removed.status_code, 204)
        self.assertEqual(self.client.get(public_url(token)).status_code, 404)
        self.assertEqual(self.share(method="get").json(), {"token": None, "shared_at": None})

    def test_удалил_чат_и_ссылки_нет(self):
        token = self.share().json()["token"]
        self.client.delete(f"{CHATS}{self.chat.pk}/", **auth_headers(OWNER))
        self.assertEqual(self.client.get(public_url(token)).status_code, 404)

    def test_чужим_чатом_не_поделиться(self):
        foreign = make_chat(INTRUDER)
        self.assertEqual(self.share(foreign).status_code, 404)
        self.assertEqual(self.share(foreign, method="get").status_code, 404)
        self.assertFalse(SharedChat.objects.exists())

    def test_пустым_чатом_не_поделиться(self):
        empty = make_chat(messages=[])
        self.assertEqual(self.share(empty).status_code, 400)

    def test_неизвестная_ссылка(self):
        self.assertEqual(self.client.get(public_url("nope-nope-nope-nope-nope")).status_code, 404)

    def test_управлять_ссылкой_можно_только_с_входом(self):
        self.assertEqual(self.client.post(f"{CHATS}{self.chat.pk}/share/").status_code, 401)

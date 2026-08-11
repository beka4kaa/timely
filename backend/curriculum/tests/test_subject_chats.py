"""Чаты внутри предмета: изоляция, форма списка и название.

Изоляция проверяется отдельно от всего: чат хранит переписку ученика, и
единственная ошибка в фильтре здесь означает чужую переписку на экране.
"""

from __future__ import annotations

import json
from unittest import mock

from django.test import TestCase

from curriculum.chat_title import fallback_title, first_question, generate_chat_title
from curriculum.models import LearningGoal, SubjectChat

OWNER = "owner@example.com"
INTRUDER = "intruder@example.com"
URL = "/api/curriculum/chats/"


def _auth(email: str) -> dict:
    return {"HTTP_X_USER_EMAIL": email}


def _rows(response) -> list:
    """Список без пагинации — так же его читает `listChats` на фронте."""
    body = response.json()
    return body if isinstance(body, list) else body["results"]


def goal(email: str = OWNER, text: str = "механика") -> LearningGoal:
    return LearningGoal.objects.create(user_email=email, original_text=text)


def chat(subject: LearningGoal, *, title="Импульс", messages=None) -> SubjectChat:
    return SubjectChat.objects.create(
        user_email=subject.user_email,
        goal=subject,
        title=title,
        messages=messages if messages is not None else [],
    )


class IsolationTests(TestCase):
    def setUp(self):
        self.goal = goal()
        self.chat = chat(self.goal)
        self.foreign = chat(goal(INTRUDER, "чужая физика"), title="Чужой")

    def test_чужой_чат_не_виден_в_списке(self):
        response = self.client.get(URL, **_auth(OWNER))
        ids = [row["id"] for row in _rows(response)]
        self.assertIn(str(self.chat.pk), ids)
        self.assertNotIn(str(self.foreign.pk), ids)

    def test_чужой_чат_не_читается(self):
        response = self.client.get(f"{URL}{self.foreign.pk}/", **_auth(OWNER))
        self.assertEqual(response.status_code, 404)

    def test_чужой_чат_не_удаляется(self):
        response = self.client.delete(f"{URL}{self.foreign.pk}/", **_auth(OWNER))
        self.assertEqual(response.status_code, 404)
        self.assertTrue(SubjectChat.objects.filter(pk=self.foreign.pk).exists())

    def test_чат_в_чужом_предмете_не_создаётся(self):
        """404, а не 403: чужой предмет не должен подтверждать своё существование."""
        response = self.client.post(
            URL,
            data=json.dumps({"goal": str(self.foreign.goal_id), "title": "Влезаю"}),
            content_type="application/json",
            **_auth(OWNER),
        )
        self.assertEqual(response.status_code, 404)

    def test_без_пользователя_список_пуст(self):
        self.assertEqual(_rows(self.client.get(URL)), [])


class ListShapeTests(TestCase):
    def setUp(self):
        self.goal = goal()

    def test_список_не_тянет_сообщения(self):
        """Сорок реплик на чат при пяти чатах — мегабайты на каждое открытие."""
        chat(self.goal, messages=[{"role": "user", "content": "x" * 5000}])

        row = _rows(self.client.get(URL, **_auth(OWNER)))[0]

        self.assertNotIn("messages", row)
        self.assertEqual(row["message_count"], 1)

    def test_чат_целиком_отдаёт_сообщения(self):
        created = chat(self.goal, messages=[{"role": "user", "content": "привет"}])

        body = self.client.get(f"{URL}{created.pk}/", **_auth(OWNER)).json()

        self.assertEqual(body["messages"][0]["content"], "привет")

    def test_фильтр_по_предмету(self):
        other = goal(text="химия")
        chat(self.goal, title="Механика")
        chat(other, title="Химия")

        rows = _rows(self.client.get(f"{URL}?goal={other.pk}", **_auth(OWNER)))

        self.assertEqual([row["title"] for row in rows], ["Химия"])

    def test_свежие_чаты_идут_первыми(self):
        chat(self.goal, title="Старый")
        chat(self.goal, title="Новый")

        rows = _rows(self.client.get(URL, **_auth(OWNER)))

        self.assertEqual(rows[0]["title"], "Новый")


class WriteTests(TestCase):
    def setUp(self):
        self.goal = goal()

    def test_создание_привязывает_владельца(self):
        response = self.client.post(
            URL,
            data=json.dumps({"goal": str(self.goal.pk), "title": "Импульс"}),
            content_type="application/json",
            **_auth(OWNER),
        )
        self.assertEqual(response.status_code, 201)
        created = SubjectChat.objects.get(pk=response.json()["id"])
        self.assertEqual(created.user_email, OWNER)

    def test_сообщения_дописываются_патчем(self):
        created = chat(self.goal, messages=[])
        messages = [{"role": "user", "content": "что такое импульс"}]

        self.client.patch(
            f"{URL}{created.pk}/",
            data=json.dumps({"messages": messages}),
            content_type="application/json",
            **_auth(OWNER),
        )

        created.refresh_from_db()
        self.assertEqual(created.messages, messages)

    def test_удаление_предмета_уносит_его_чаты(self):
        """Отвечать таким чатам больше не по чему."""
        created = chat(self.goal)
        self.goal.delete()
        self.assertFalse(SubjectChat.objects.filter(pk=created.pk).exists())


class TitleTests(TestCase):
    MESSAGES = [
        {"role": "user", "content": "почему тяжёлый ящик легче толкать, чем нести"},
        {"role": "assistant", "content": "Потому что сила трения зависит от…"},
    ]

    def test_название_от_модели(self):
        response = mock.Mock(text=json.dumps({"title": "Сила трения"}))
        with mock.patch(
            "ai_engine.text_llm.TextModel.generate_json_content", return_value=response
        ):
            self.assertEqual(generate_chat_title(self.MESSAGES), "Сила трения")

    def test_отказ_модели_даёт_первый_вопрос(self):
        """Список из пяти «Новый чат» бесполезен: по нему не вернёшься к теме."""
        with mock.patch(
            "ai_engine.text_llm.TextModel.generate_json_content",
            side_effect=RuntimeError("провайдер лёг"),
        ):
            title = generate_chat_title(self.MESSAGES)

        self.assertTrue(title.startswith("почему тяжёлый ящик"))
        self.assertNotEqual(title, "Новый чат")

    def test_мусор_вместо_json_тоже_даёт_запасное(self):
        with mock.patch(
            "ai_engine.text_llm.TextModel.generate_json_content",
            return_value=mock.Mock(text="не json"),
        ):
            self.assertTrue(generate_chat_title(self.MESSAGES).startswith("почему"))

    def test_длинный_вопрос_режется_по_словам(self):
        long = [{"role": "user", "content": "почему " * 40}]
        title = fallback_title(long)
        self.assertLessEqual(len(title), 51)
        self.assertTrue(title.endswith("…"))
        # Обрубок посреди слова читается как ошибка.
        self.assertFalse(title.rstrip("…").endswith("поч"))

    def test_пустой_разговор_остаётся_новым_чатом(self):
        self.assertEqual(generate_chat_title([]), "Новый чат")
        only_answer = [{"role": "assistant", "content": "ответ"}]
        self.assertEqual(fallback_title(only_answer), "Новый чат")

    def test_первый_вопрос_ищется_среди_реплик(self):
        messages = [{"role": "assistant", "content": "привет"}, *self.MESSAGES]
        self.assertTrue(first_question(messages).startswith("почему"))

    def test_эндпоинт_сохраняет_название(self):
        created = chat(self.goal_for_endpoint(), title="", messages=self.MESSAGES)
        response = mock.Mock(text=json.dumps({"title": "Сила трения"}))

        with mock.patch(
            "ai_engine.text_llm.TextModel.generate_json_content", return_value=response
        ):
            body = self.client.post(
                f"{URL}{created.pk}/title/", **_auth(OWNER)
            ).json()

        created.refresh_from_db()
        self.assertEqual(body["title"], "Сила трения")
        self.assertEqual(created.title, "Сила трения")

    def goal_for_endpoint(self) -> LearningGoal:
        return goal()

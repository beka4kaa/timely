"""Focused tests for ChatSessionViewSet: per-account isolation of saved
AI Tutor conversations (create, list, update, delete, and ownership)."""

from django.test import TestCase
from rest_framework.test import APIClient

from .models import ChatSession

USER_A = "alice@example.com"
USER_B = "bob@example.com"
BASE_URL = "/api/ai_engine/chat-sessions/"


class ChatSessionViewSetTests(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()

    def _as(self, email: str) -> dict:
        return {"HTTP_X_USER_EMAIL": email}

    def test_create_requires_authentication(self) -> None:
        res = self.client.post(BASE_URL, {"id": "s1", "messages": []}, format="json")
        self.assertEqual(res.status_code, 401)

    def test_create_requires_id(self) -> None:
        res = self.client.post(BASE_URL, {"messages": []}, format="json", **self._as(USER_A))
        self.assertEqual(res.status_code, 400)

    def test_create_with_taken_id_returns_409(self) -> None:
        ChatSession.objects.create(id="a1", user_email=USER_A, title="A's chat", messages=[])
        res = self.client.post(
            BASE_URL, {"id": "a1", "title": "Second", "messages": []}, format="json", **self._as(USER_A)
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(ChatSession.objects.get(id="a1").title, "A's chat")

    def test_create_with_another_users_id_returns_409(self) -> None:
        """Same status and body as the own-id conflict: create must not tell
        one account whether another account owns a given session id."""
        ChatSession.objects.create(id="a1", user_email=USER_A, title="A's chat", messages=[])
        res = self.client.post(
            BASE_URL, {"id": "a1", "title": "Hijack", "messages": []}, format="json", **self._as(USER_B)
        )
        self.assertEqual(res.status_code, 409)

        own = self.client.post(
            BASE_URL, {"id": "a1", "title": "Second", "messages": []}, format="json", **self._as(USER_A)
        )
        self.assertEqual(res.json(), own.json())

        session = ChatSession.objects.get(id="a1")
        self.assertEqual(session.user_email, USER_A)
        self.assertEqual(session.title, "A's chat")

    def test_create_cannot_spoof_user_email(self) -> None:
        res = self.client.post(
            BASE_URL,
            {"id": "s1", "user_email": USER_B, "messages": []},
            format="json",
            **self._as(USER_A),
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(ChatSession.objects.get(id="s1").user_email, USER_A)

    def test_create_rejects_non_list_messages(self) -> None:
        res = self.client.post(
            BASE_URL, {"id": "s1", "messages": {"not": "a list"}}, format="json", **self._as(USER_A)
        )
        self.assertEqual(res.status_code, 400)
        self.assertFalse(ChatSession.objects.filter(id="s1").exists())

    def test_create_rejects_non_object_lesson_plan(self) -> None:
        res = self.client.post(
            BASE_URL,
            {"id": "s1", "messages": [], "lesson_plan": "Второй закон Ньютона"},
            format="json",
            **self._as(USER_A),
        )
        self.assertEqual(res.status_code, 400)
        self.assertFalse(ChatSession.objects.filter(id="s1").exists())

    def test_patch_rejects_non_list_messages(self) -> None:
        ChatSession.objects.create(id="a1", user_email=USER_A, title="A", messages=[])
        res = self.client.patch(
            f"{BASE_URL}a1/", {"messages": "oops"}, format="json", **self._as(USER_A)
        )
        self.assertEqual(res.status_code, 400)
        self.assertEqual(ChatSession.objects.get(id="a1").messages, [])

    def test_create_and_retrieve(self) -> None:
        lesson_plan = {"id": "lesson-1", "topic": "Второй закон Ньютона", "tasks": []}
        payload = {
            "id": "session-1",
            "title": "Второй закон Ньютона",
            "topic": "Второй закон Ньютона",
            "messages": [{"id": "m1", "role": "user", "content": "Привет"}],
            "lesson_plan": lesson_plan,
        }
        res = self.client.post(BASE_URL, payload, format="json", **self._as(USER_A))
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(body["id"], "session-1")
        self.assertEqual(body["messages"], payload["messages"])
        self.assertEqual(body["lesson_plan"], lesson_plan)

        res = self.client.get(f"{BASE_URL}session-1/", **self._as(USER_A))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["title"], "Второй закон Ньютона")
        self.assertEqual(res.json()["lesson_plan"], lesson_plan)

    def test_list_omits_messages_but_detail_includes_them(self) -> None:
        ChatSession.objects.create(
            id="s1", user_email=USER_A, title="A", messages=[{"id": "m1", "role": "user", "content": "hi"}]
        )
        res = self.client.get(BASE_URL, **self._as(USER_A))
        self.assertEqual(res.status_code, 200)
        (row,) = res.json()
        self.assertNotIn("messages", row)

        res = self.client.get(f"{BASE_URL}s1/", **self._as(USER_A))
        self.assertIn("messages", res.json())

    def test_list_only_returns_own_sessions(self) -> None:
        ChatSession.objects.create(id="a1", user_email=USER_A, title="A's chat", messages=[])
        ChatSession.objects.create(id="b1", user_email=USER_B, title="B's chat", messages=[])

        res = self.client.get(BASE_URL, **self._as(USER_A))
        ids = [row["id"] for row in res.json()]
        self.assertEqual(ids, ["a1"])

    def test_list_without_user_email_is_empty(self) -> None:
        ChatSession.objects.create(id="a1", user_email=USER_A, title="A's chat", messages=[])
        res = self.client.get(BASE_URL)
        self.assertEqual(res.json(), [])

    def test_cannot_retrieve_or_modify_another_users_session(self) -> None:
        ChatSession.objects.create(id="a1", user_email=USER_A, title="A's chat", messages=[])

        res = self.client.get(f"{BASE_URL}a1/", **self._as(USER_B))
        self.assertEqual(res.status_code, 404)

        res = self.client.patch(f"{BASE_URL}a1/", {"title": "hijacked"}, format="json", **self._as(USER_B))
        self.assertEqual(res.status_code, 404)

        res = self.client.delete(f"{BASE_URL}a1/", **self._as(USER_B))
        self.assertEqual(res.status_code, 404)

        # Untouched
        session = ChatSession.objects.get(id="a1")
        self.assertEqual(session.title, "A's chat")

    def test_owner_can_patch_messages_and_title(self) -> None:
        ChatSession.objects.create(id="a1", user_email=USER_A, title="Old", messages=[])
        res = self.client.patch(
            f"{BASE_URL}a1/",
            {"title": "New", "messages": [{"id": "m1", "role": "assistant", "content": "ok"}]},
            format="json",
            **self._as(USER_A),
        )
        self.assertEqual(res.status_code, 200)
        session = ChatSession.objects.get(id="a1")
        self.assertEqual(session.title, "New")
        self.assertEqual(len(session.messages), 1)

    def test_owner_can_delete(self) -> None:
        ChatSession.objects.create(id="a1", user_email=USER_A, title="A's chat", messages=[])
        res = self.client.delete(f"{BASE_URL}a1/", **self._as(USER_A))
        self.assertEqual(res.status_code, 204)
        self.assertFalse(ChatSession.objects.filter(id="a1").exists())

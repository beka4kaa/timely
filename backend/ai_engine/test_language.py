"""Язык ответа модели: заголовок X-Timely-Lang и правило для системного промпта."""

from __future__ import annotations

from django.test import RequestFactory, SimpleTestCase

from ai_engine.language import answer_language_rule, request_language


class RequestLanguageTests(SimpleTestCase):
    def setUp(self) -> None:
        self.factory = RequestFactory()

    def test_английский_из_заголовка(self) -> None:
        request = self.factory.get("/", HTTP_X_TIMELY_LANG="en")
        self.assertEqual(request_language(request), "en")

    def test_без_заголовка_и_с_чужим_языком_русский(self) -> None:
        self.assertEqual(request_language(self.factory.get("/")), "ru")
        self.assertEqual(request_language(self.factory.get("/", HTTP_X_TIMELY_LANG="de")), "ru")
        self.assertEqual(request_language(self.factory.get("/", HTTP_X_TIMELY_LANG=" EN ")), "en")


class AnswerLanguageRuleTests(SimpleTestCase):
    def test_для_английского_отвечать_на_языке_ученика_а_английский_по_умолчанию(self) -> None:
        rule = answer_language_rule("en")
        self.assertIn("language the student writes in", rule)
        self.assertIn("reply in English", rule)

    def test_для_русского_правила_нет(self) -> None:
        self.assertEqual(answer_language_rule("ru"), "")

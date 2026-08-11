"""Выбор провайдера ритма, разбор ответа модели и откат на детерминированный."""

from __future__ import annotations

import json
from unittest import mock

from django.test import SimpleTestCase

from studyplan.planning.contracts import PacingRequest
from studyplan.planning.providers import (
    DeterministicPacingProvider,
    MalformedPacingResponse,
    OpenRouterPacingProvider,
    ProviderNotConfigured,
    get_pacing_provider,
    parse_pacing_response,
)

from .factories import topic

ROLE_ENV = "SCHEDULE_PLANNING_MODEL"


def _request(**kwargs) -> PacingRequest:
    defaults = dict(
        goal_text="Хочу разобраться в механике",
        subject="Физика",
        current_level="school_basic",
        target_level="school_confident",
        theory_practice_balance="balanced",
        language="ru",
        topics=(topic("t1"), topic("t2")),
        session_minutes=45,
    )
    defaults.update(kwargs)
    return PacingRequest(**defaults)


class ProviderSelectionTests(SimpleTestCase):
    def test_without_configured_role_never_reaches_the_network(self):
        # Главная защита проекта: забытая переменная окружения не должна
        # приводить к платному вызову. См. `curriculum/ROADMAP.md`, грабли
        # «настроенный .env протекает в тесты».
        with mock.patch.dict("os.environ", {}, clear=False):
            import os

            os.environ.pop(ROLE_ENV, None)
            os.environ.pop("TEXT_LLM_MODEL", None)
            provider = get_pacing_provider()
        self.assertIsInstance(provider, DeterministicPacingProvider)

    def test_configured_role_selects_the_model_provider(self):
        with mock.patch.dict("os.environ", {ROLE_ENV: "vendor/model"}):
            provider = get_pacing_provider()
        self.assertIsInstance(provider, OpenRouterPacingProvider)
        self.assertEqual(provider.model, "vendor/model")

    def test_explicit_key_wins(self):
        provider = get_pacing_provider("deterministic")
        self.assertIsInstance(provider, DeterministicPacingProvider)

    def test_unknown_key_is_rejected(self):
        with self.assertRaises(ProviderNotConfigured):
            get_pacing_provider("telepathy")


class DeterministicProviderTests(SimpleTestCase):
    def test_builds_pacing_for_every_topic(self):
        request = _request()
        plan = DeterministicPacingProvider().generate_pacing(request)
        self.assertEqual(
            [item.topic_id for item in plan.topic_pacing], ["id-t1", "id-t2"]
        )
        for item in plan.topic_pacing:
            self.assertTrue(item.lesson_parts)
            self.assertEqual(item.lesson_parts[-1].activity_type, "assessment")


class ParseResponseTests(SimpleTestCase):
    def _raw(self, topic_pacing) -> str:
        return json.dumps(
            {
                "weekly_pattern": [
                    {
                        "weekday": 1,
                        "activity_types": ["theory"],
                        "preferred_duration_minutes": 45,
                    }
                ],
                "topic_pacing": topic_pacing,
                "milestones": [{"title": "Контрольная", "after_topic_id": "id-t1"}],
                "buffer_percentage": 0.2,
                "rationale": "Потому что",
            },
            ensure_ascii=False,
        )

    def test_model_decides_the_split_backend_fills_the_content(self):
        raw = self._raw(
            [
                {
                    "topic_id": "id-t1",
                    "lesson_parts": [
                        {"activity_type": "theory", "duration_minutes": 30},
                        {"activity_type": "assessment", "duration_minutes": 20},
                    ],
                }
            ]
        )
        plan = parse_pacing_response(raw, request=_request())
        parts = plan.topic_pacing[0].lesson_parts
        self.assertEqual(
            [(p.activity_type, p.duration_minutes) for p in parts],
            [("theory", 30), ("assessment", 20)],
        )
        # Название и цель пришли из программы, а не от модели.
        self.assertIn("Тема t1", parts[0].title)
        self.assertEqual(parts[0].objective, "Цель t1")
        self.assertEqual(plan.buffer_percentage, 0.2)
        self.assertEqual(plan.milestones[0].title, "Контрольная")

    def test_unknown_topic_survives_as_an_empty_entry_for_the_validator(self):
        raw = self._raw([{"topic_id": "ghost", "lesson_parts": []}])
        plan = parse_pacing_response(raw, request=_request())
        self.assertEqual(plan.topic_pacing[0].topic_id, "ghost")
        self.assertEqual(plan.topic_pacing[0].lesson_parts, ())

    def test_overlong_part_is_chunked_by_the_backend(self):
        raw = self._raw(
            [
                {
                    "topic_id": "id-t1",
                    "lesson_parts": [
                        {"activity_type": "independent_practice", "duration_minutes": 150}
                    ],
                }
            ]
        )
        plan = parse_pacing_response(raw, request=_request(session_minutes=45))
        parts = plan.topic_pacing[0].lesson_parts
        self.assertGreater(len(parts), 1)
        self.assertTrue(all(part.duration_minutes <= 45 for part in parts))
        self.assertEqual(sum(part.duration_minutes for part in parts), 150)

    def test_json_wrapped_in_a_fence_is_still_read(self):
        raw = "```json\n" + self._raw([{"topic_id": "id-t1", "lesson_parts": []}]) + "\n```"
        plan = parse_pacing_response(raw, request=_request())
        self.assertEqual(len(plan.topic_pacing), 1)

    def test_garbage_raises_instead_of_pretending(self):
        with self.assertRaises(MalformedPacingResponse):
            parse_pacing_response("модель сегодня не в духе", request=_request())

    def test_broken_buffer_falls_back_to_a_sane_default(self):
        raw = json.dumps(
            {"topic_pacing": [], "buffer_percentage": "много"}, ensure_ascii=False
        )
        plan = parse_pacing_response(raw, request=_request())
        self.assertEqual(plan.buffer_percentage, 0.15)

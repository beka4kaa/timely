"""Проверка ритма, предложенного моделью."""

from __future__ import annotations

from django.test import SimpleTestCase

from studyplan.planning.contracts import PacingConstraints
from studyplan.planning.validation import validate_pacing
from studyplan.scheduling.contracts import LessonPart, PacingPlan, TopicPacing


def _part(activity_type: str = "theory", minutes: int = 25) -> LessonPart:
    return LessonPart(
        topic_id="id-t1",
        topic_external_id="t1",
        module_external_id="m1",
        part_index=0,
        activity_type=activity_type,
        duration_minutes=minutes,
        title="Тема — теория",
    )


def _topic(topic_id: str, *, parts=None) -> TopicPacing:
    return TopicPacing(
        topic_id=topic_id,
        topic_external_id=topic_id,
        lesson_parts=tuple(parts if parts is not None else [_part(), _part("assessment", 15)]),
        title=f"Тема {topic_id}",
    )


def _plan(*topics, buffer: float = 0.15) -> PacingPlan:
    return PacingPlan(
        weekly_pattern=(),
        topic_pacing=tuple(topics),
        buffer_percentage=buffer,
    )


class BlockerTests(SimpleTestCase):
    def test_empty_plan_is_a_blocker(self):
        report = validate_pacing(_plan(), allowed_topic_ids=("a",))
        self.assertFalse(report.approved)
        self.assertEqual([issue.kind for issue in report.blockers], ["empty_plan"])

    def test_unknown_topic_is_a_blocker(self):
        report = validate_pacing(_plan(_topic("ghost")), allowed_topic_ids=("a",))
        kinds = {issue.kind for issue in report.blockers}
        self.assertIn("unknown_topic", kinds)

    def test_duplicate_topic_is_a_blocker(self):
        report = validate_pacing(
            _plan(_topic("a"), _topic("a")), allowed_topic_ids=("a",)
        )
        self.assertIn("duplicate_topic", {issue.kind for issue in report.blockers})

    def test_missing_topic_is_a_blocker(self):
        report = validate_pacing(_plan(_topic("a")), allowed_topic_ids=("a", "b"))
        self.assertIn("missing_topics", {issue.kind for issue in report.blockers})

    def test_topic_without_parts_is_a_blocker(self):
        report = validate_pacing(
            _plan(_topic("a", parts=[])), allowed_topic_ids=("a",)
        )
        self.assertIn("empty_topic", {issue.kind for issue in report.blockers})

    def test_non_positive_duration_is_a_blocker(self):
        report = validate_pacing(
            _plan(_topic("a", parts=[_part(minutes=0), _part("assessment", 15)])),
            allowed_topic_ids=("a",),
        )
        self.assertIn(
            "non_positive_duration", {issue.kind for issue in report.blockers}
        )

    def test_unknown_activity_type_is_a_blocker(self):
        report = validate_pacing(
            _plan(_topic("a", parts=[_part("telepathy", 25)])),
            allowed_topic_ids=("a",),
        )
        self.assertIn(
            "unknown_activity_type", {issue.kind for issue in report.blockers}
        )

    def test_prerequisite_order_violation_is_a_blocker(self):
        report = validate_pacing(
            _plan(_topic("b"), _topic("a")),
            allowed_topic_ids=("a", "b"),
            prerequisites={"b": ("a",)},
        )
        self.assertIn(
            "prerequisite_order_violated", {issue.kind for issue in report.blockers}
        )

    def test_correct_prerequisite_order_passes(self):
        report = validate_pacing(
            _plan(_topic("a"), _topic("b")),
            allowed_topic_ids=("a", "b"),
            prerequisites={"b": ("a",)},
        )
        self.assertTrue(report.approved)

    def test_absurd_total_is_a_blocker(self):
        huge = _topic("a", parts=[_part(minutes=500_000), _part("assessment", 15)])
        report = validate_pacing(_plan(huge), allowed_topic_ids=("a",))
        self.assertIn(
            "total_minutes_exceeded", {issue.kind for issue in report.blockers}
        )


class WarningTests(SimpleTestCase):
    """Предупреждение не отменяет ритм: пустой календарь хуже лишней пометки."""

    def test_missing_assessment_is_only_a_warning(self):
        report = validate_pacing(
            _plan(_topic("a", parts=[_part()])), allowed_topic_ids=("a",)
        )
        self.assertTrue(report.approved)
        self.assertIn("no_assessment", {issue.kind for issue in report.issues})

    def test_too_short_part_is_only_a_warning(self):
        report = validate_pacing(
            _plan(_topic("a", parts=[_part(minutes=5), _part("assessment", 15)])),
            allowed_topic_ids=("a",),
            constraints=PacingConstraints(min_part_minutes=15),
        )
        self.assertTrue(report.approved)
        self.assertIn("part_too_short", {issue.kind for issue in report.issues})

    def test_buffer_outside_range_is_only_a_warning(self):
        report = validate_pacing(
            _plan(_topic("a"), buffer=0.9), allowed_topic_ids=("a",)
        )
        self.assertTrue(report.approved)
        self.assertIn("buffer_out_of_range", {issue.kind for issue in report.issues})

    def test_report_payload_is_serialisable(self):
        payload = validate_pacing(
            _plan(_topic("a")), allowed_topic_ids=("a",)
        ).to_payload()
        self.assertTrue(payload["approved"])
        self.assertIsInstance(payload["issues"], list)

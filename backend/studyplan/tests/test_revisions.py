"""Изменение расписания: предложение, diff, подтверждение, Undo."""

from __future__ import annotations

from datetime import timedelta

from curriculum.models import CourseDependency
from studyplan.models import FixedCommitment, LearningBlock, ScheduleRevision
from studyplan.revisions import (
    BlockMove,
    RevisionRejected,
    StaleRevision,
    confirm_revision,
    propose_moves,
    reject_revision,
    undo_revision,
)
from studyplan.services import generate_schedule

from .test_materialize import MONDAY, SchedulePlanFixture


class RevisionFixture(SchedulePlanFixture):
    def setUp(self):
        super().setUp()
        self.outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=41),
            template=self.make_template(),
        )
        self.schedule = self.outcome.schedule
        self.blocks = list(self.schedule.blocks.order_by("start_at"))

    def free_slot_start(self):
        """Заведомо свободное время: воскресенье, в ритме окон нет."""
        last = max(block.end_at for block in self.blocks)
        candidate = last + timedelta(days=1)
        while candidate.weekday() != 6:
            candidate += timedelta(days=1)
        return candidate.replace(hour=12, minute=0, second=0, microsecond=0)


class ProposeTests(RevisionFixture):
    def test_proposal_does_not_touch_the_calendar(self):
        block = self.blocks[0]
        before = block.start_at

        revision = propose_moves(
            self.schedule,
            moves=[BlockMove(block_id=str(block.id), start_at=self.free_slot_start())],
        )

        block.refresh_from_db()
        self.schedule.refresh_from_db()
        self.assertEqual(block.start_at, before)
        self.assertEqual(self.schedule.version, 1)
        self.assertEqual(revision.status, ScheduleRevision.Status.PROPOSED)
        self.assertEqual(revision.base_version, 1)
        self.assertEqual(revision.proposed_version, 2)

    def test_diff_records_both_sides_of_the_change(self):
        block = self.blocks[0]
        target = self.free_slot_start()
        revision = propose_moves(
            self.schedule,
            moves=[
                BlockMove(
                    block_id=str(block.id), start_at=target, duration_minutes=20
                )
            ],
        )
        moved = revision.diff["moved"][0]
        self.assertEqual(moved["block_id"], str(block.id))
        self.assertEqual(moved["from"]["start_at"], block.start_at.isoformat())
        self.assertEqual(moved["to"]["start_at"], target.isoformat())
        # 25 минут стали 20 — это укорачивание, и оно видно отдельно.
        self.assertTrue(revision.diff["shortened"])
        self.assertTrue(revision.inverse_diff["extended"])

    def test_impact_shows_the_new_finish(self):
        block = self.blocks[0]
        revision = propose_moves(
            self.schedule,
            moves=[BlockMove(block_id=str(block.id), start_at=self.free_slot_start())],
        )
        self.assertEqual(revision.impact["blocks_touched"], 1)
        self.assertIsNotNone(revision.impact["finish_after"])

    def test_moving_nowhere_is_rejected(self):
        block = self.blocks[0]
        with self.assertRaises(RevisionRejected):
            propose_moves(
                self.schedule,
                moves=[BlockMove(block_id=str(block.id), start_at=block.start_at)],
            )

    def test_block_from_another_schedule_is_rejected(self):
        other = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            template=self.schedule.template,
        )
        foreign = other.schedule.blocks.first()
        with self.assertRaises(RevisionRejected):
            propose_moves(
                self.schedule,
                moves=[
                    BlockMove(
                        block_id=str(foreign.id), start_at=self.free_slot_start()
                    )
                ],
            )


class GuardTests(RevisionFixture):
    def test_fixed_block_is_never_moved(self):
        block = self.blocks[0]
        block.fixed = True
        block.save(update_fields=["fixed"])
        with self.assertRaises(RevisionRejected):
            propose_moves(
                self.schedule,
                moves=[
                    BlockMove(block_id=str(block.id), start_at=self.free_slot_start())
                ],
            )

    def test_finished_block_is_not_moved(self):
        block = self.blocks[0]
        block.status = LearningBlock.Status.COMPLETED
        block.save(update_fields=["status"])
        with self.assertRaises(RevisionRejected):
            propose_moves(
                self.schedule,
                moves=[
                    BlockMove(block_id=str(block.id), start_at=self.free_slot_start())
                ],
            )

    def test_overlap_with_another_block_is_rejected(self):
        first, second = self.blocks[0], self.blocks[1]
        with self.assertRaises(RevisionRejected):
            propose_moves(
                self.schedule,
                moves=[BlockMove(block_id=str(first.id), start_at=second.start_at)],
            )

    def test_overlap_with_busy_time_is_rejected(self):
        target = self.free_slot_start()
        FixedCommitment.objects.create(
            user_email=self.plan.user_email,
            kind=FixedCommitment.Kind.FAMILY,
            title="Семейный обед",
            start_at=target - timedelta(minutes=10),
            end_at=target + timedelta(hours=2),
        )
        with self.assertRaises(RevisionRejected):
            propose_moves(
                self.schedule,
                moves=[BlockMove(block_id=str(self.blocks[0].id), start_at=target)],
            )

    def test_too_short_block_is_rejected(self):
        with self.assertRaises(RevisionRejected):
            propose_moves(
                self.schedule,
                moves=[
                    BlockMove(
                        block_id=str(self.blocks[0].id),
                        start_at=self.free_slot_start(),
                        duration_minutes=5,
                    )
                ],
            )


class PrerequisiteGuardTests(SchedulePlanFixture):
    def setUp(self):
        super().setUp()
        CourseDependency.objects.create(
            plan=self.plan, topic=self.topics[1], depends_on=self.topics[0]
        )
        self.outcome = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=41),
            template=self.make_template(),
        )
        self.schedule = self.outcome.schedule

    def _blocks_of(self, topic):
        return list(self.schedule.blocks.filter(topic=topic).order_by("start_at"))

    def test_dependent_block_cannot_jump_ahead_of_its_prerequisite(self):
        dependent = self._blocks_of(self.topics[1])[0]
        self.assertTrue(dependent.prerequisite_block_ids)
        earlier = self.schedule.blocks.order_by("start_at").first().start_at
        with self.assertRaises(RevisionRejected):
            propose_moves(
                self.schedule,
                moves=[
                    BlockMove(
                        block_id=str(dependent.id),
                        start_at=earlier - timedelta(days=3),
                    )
                ],
            )

    def test_prerequisite_cannot_be_pushed_past_its_dependent(self):
        prerequisite = self._blocks_of(self.topics[0])[-1]
        dependent = self._blocks_of(self.topics[1])[0]
        with self.assertRaises(RevisionRejected):
            propose_moves(
                self.schedule,
                moves=[
                    BlockMove(
                        block_id=str(prerequisite.id),
                        start_at=dependent.end_at + timedelta(days=7),
                    )
                ],
            )


class ConfirmAndUndoTests(RevisionFixture):
    def _move_first_block(self):
        block = self.blocks[0]
        target = self.free_slot_start()
        revision = propose_moves(
            self.schedule,
            moves=[BlockMove(block_id=str(block.id), start_at=target)],
        )
        return block, target, revision

    def test_confirmation_applies_the_change_and_bumps_versions(self):
        block, target, revision = self._move_first_block()
        before_version = block.version

        confirm_revision(revision)

        block.refresh_from_db()
        self.schedule.refresh_from_db()
        revision.refresh_from_db()
        self.assertEqual(block.start_at, target)
        self.assertEqual(block.version, before_version + 1)
        self.assertEqual(self.schedule.version, 2)
        self.assertEqual(revision.status, ScheduleRevision.Status.CONFIRMED)
        self.assertIsNotNone(revision.confirmed_at)

    def test_stale_revision_is_refused_not_applied(self):
        block, _, first = self._move_first_block()
        second = propose_moves(
            self.schedule,
            moves=[
                BlockMove(
                    block_id=str(self.blocks[1].id),
                    start_at=self.free_slot_start() + timedelta(days=7),
                )
            ],
        )
        confirm_revision(first)

        with self.assertRaises(StaleRevision):
            confirm_revision(second)

        second.refresh_from_db()
        self.assertEqual(second.status, ScheduleRevision.Status.EXPIRED)
        self.schedule.refresh_from_db()
        self.assertEqual(self.schedule.version, 2)

    def test_undo_restores_the_previous_placement(self):
        block, _, revision = self._move_first_block()
        original_start = block.start_at
        confirm_revision(revision)

        undo_revision(revision)

        block.refresh_from_db()
        revision.refresh_from_db()
        self.schedule.refresh_from_db()
        self.assertEqual(block.start_at, original_start)
        self.assertEqual(revision.status, ScheduleRevision.Status.REVERTED)
        self.assertEqual(self.schedule.version, 3)

    def test_undo_works_only_for_the_latest_change(self):
        _, _, first = self._move_first_block()
        confirm_revision(first)
        # Второе изменение строится ПОСЛЕ первого, то есть уже от версии 2.
        self.schedule.refresh_from_db()
        second = propose_moves(
            self.schedule,
            moves=[
                BlockMove(
                    block_id=str(self.blocks[1].id),
                    start_at=self.free_slot_start() + timedelta(days=7),
                )
            ],
        )
        confirm_revision(second)

        with self.assertRaises(StaleRevision):
            undo_revision(first)

    def test_undo_cannot_be_repeated(self):
        _, _, revision = self._move_first_block()
        confirm_revision(revision)
        undo_revision(revision)
        with self.assertRaises(RevisionRejected):
            undo_revision(revision)

    def test_rejected_revision_is_not_applied(self):
        block, target, revision = self._move_first_block()
        reject_revision(revision)

        block.refresh_from_db()
        revision.refresh_from_db()
        self.assertNotEqual(block.start_at, target)
        self.assertEqual(revision.status, ScheduleRevision.Status.REJECTED)
        with self.assertRaises(RevisionRejected):
            confirm_revision(revision)

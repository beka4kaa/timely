"""Изменение расписания: предложение, diff, подтверждение, Undo."""

from __future__ import annotations

import queue
import threading
import time
from datetime import timedelta
from unittest import mock

from django.db import connection, connections, transaction
from django.test import TransactionTestCase, skipUnlessDBFeature

from curriculum.models import CourseDependency, CoursePlan
from studyplan.models import (
    FixedCommitment,
    LearningBlock,
    ScheduleRevision,
    StudySchedule,
)
from studyplan.revisions import (
    BlockMove,
    ClosedRevision,
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

    def test_cancelled_block_is_refused_with_the_real_reason(self):
        block = self.blocks[0]
        block.status = LearningBlock.Status.CANCELLED
        block.save(update_fields=["status"])
        with self.assertRaises(RevisionRejected) as caught:
            propose_moves(
                self.schedule,
                moves=[
                    BlockMove(block_id=str(block.id), start_at=self.free_slot_start())
                ],
            )
        self.assertIn("отменён", str(caught.exception))
        self.assertNotIn("в работе", str(caught.exception))

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


class OverlappingAnswersTests(RevisionFixture):
    """Два ответа на одно предложение: две вкладки или два устройства.

    Представление читает ревизию до транзакции, поэтому второй запрос приходит в
    сервис с копией, где она ещё «предложена». Ответы здесь идут один за другим:
    это единственный порядок, который оставляет блокировка, и воспроизводится он
    без потоков, в том числе на SQLite, где `select_for_update` ничего не делает.
    """

    def setUp(self):
        super().setUp()
        self.block = self.blocks[0]
        self.original = self.block.start_at
        self.target = self.free_slot_start()
        revision = propose_moves(
            self.schedule,
            moves=[BlockMove(block_id=str(self.block.id), start_at=self.target)],
        )
        self.first, self.late = self._copies(revision)

    def _copies(self, revision):
        """То, что два запроса получили из `get_object()` до любого ответа."""
        return (
            ScheduleRevision.objects.get(pk=revision.pk),
            ScheduleRevision.objects.get(pk=revision.pk),
        )

    def _assert_state(self, status, *, start_at, version):
        self.assertEqual(
            ScheduleRevision.objects.get(pk=self.first.pk).status, status
        )
        self.block.refresh_from_db()
        self.schedule.refresh_from_db()
        self.assertEqual(self.block.start_at, start_at)
        self.assertEqual(self.schedule.version, version)

    def _assert_refused_for_status(self, answer, revision):
        """Отказ из-за статуса, а не «расписание изменилось»: оно не изменилось."""
        with self.assertRaises(ClosedRevision):
            answer(revision)

    def test_late_confirm_leaves_the_applied_move_undoable(self):
        confirm_revision(self.first)

        self._assert_refused_for_status(confirm_revision, self.late)

        self._assert_state(
            ScheduleRevision.Status.CONFIRMED, start_at=self.target, version=2
        )
        undo_revision(self.late)
        self._assert_state(
            ScheduleRevision.Status.REVERTED, start_at=self.original, version=3
        )

    def test_late_confirm_does_not_apply_a_declined_move(self):
        reject_revision(self.first)

        self._assert_refused_for_status(confirm_revision, self.late)

        self._assert_state(
            ScheduleRevision.Status.REJECTED, start_at=self.original, version=1
        )

    def test_late_reject_leaves_the_applied_move_undoable(self):
        confirm_revision(self.first)

        self._assert_refused_for_status(reject_revision, self.late)

        self._assert_state(
            ScheduleRevision.Status.CONFIRMED, start_at=self.target, version=2
        )
        undo_revision(self.late)
        self._assert_state(
            ScheduleRevision.Status.REVERTED, start_at=self.original, version=3
        )

    def test_late_confirm_on_a_changed_schedule_keeps_the_rejection(self):
        # Версия разошлась, но «устарела» можно писать только поверх
        # «предложена»: ученик уже ответил, и этот ответ не должен потеряться.
        reject_revision(self.first)
        other = propose_moves(
            self.schedule,
            moves=[
                BlockMove(
                    block_id=str(self.blocks[1].id),
                    start_at=self.target + timedelta(days=7),
                )
            ],
        )
        confirm_revision(other)

        self._assert_refused_for_status(confirm_revision, self.late)

        self._assert_state(
            ScheduleRevision.Status.REJECTED, start_at=self.original, version=2
        )

    def test_late_undo_names_the_real_reason(self):
        confirm_revision(self.first)
        first_undo, late_undo = self._copies(self.first)
        undo_revision(first_undo)

        self._assert_refused_for_status(undo_revision, late_undo)

        self._assert_state(
            ScheduleRevision.Status.REVERTED, start_at=self.original, version=3
        )

    def test_refused_answer_refreshes_the_callers_copy(self):
        confirm_revision(self.first)

        self._assert_refused_for_status(reject_revision, self.late)

        self.assertEqual(self.late.status, ScheduleRevision.Status.CONFIRMED)

    def test_outdated_proposal_still_expires(self):
        # Обратная сторона: если ответа ещё не было, пометка «устарела» обязана
        # дожить до конца, иначе кнопка предлагала бы подтвердить снова и снова.
        other = propose_moves(
            self.schedule,
            moves=[
                BlockMove(
                    block_id=str(self.blocks[1].id),
                    start_at=self.target + timedelta(days=7),
                )
            ],
        )
        confirm_revision(other)

        with self.assertRaises(StaleRevision):
            confirm_revision(self.late)

        self.assertEqual(self.late.status, ScheduleRevision.Status.EXPIRED)
        self._assert_state(
            ScheduleRevision.Status.EXPIRED, start_at=self.original, version=2
        )


class DecliningClosesOlderProposalsTests(RevisionFixture):
    """Главная показывает одно предложение на расписание — самое свежее.

    Отказ от него не должен вернуть на экран то, что помощник уже переиграл.
    """

    def _proposal(self):
        return propose_moves(
            self.schedule,
            moves=[
                BlockMove(
                    block_id=str(self.blocks[0].id), start_at=self.free_slot_start()
                )
            ],
        )

    def _status(self, revision):
        return ScheduleRevision.objects.get(pk=revision.pk).status

    def test_declining_the_newest_closes_older_ones(self):
        older = self._proposal()
        middle = self._proposal()
        newest = self._proposal()

        reject_revision(newest)

        self.assertEqual(self._status(newest), ScheduleRevision.Status.REJECTED)
        # На них ученик не отвечал: «устарела», а не «отклонена».
        self.assertEqual(self._status(middle), ScheduleRevision.Status.EXPIRED)
        self.assertEqual(self._status(older), ScheduleRevision.Status.EXPIRED)

    def test_closed_proposal_cannot_be_accepted_from_an_old_card(self):
        # Карточка в чате другой вкладки живёт своей копией и кнопки не гасит.
        original = self.blocks[0].start_at
        older = self._proposal()
        reject_revision(self._proposal())

        with self.assertRaises(RevisionRejected) as caught:
            confirm_revision(older)

        # Текст видит ученик, а не разработчик.
        self.assertNotIn("ревизи", str(caught.exception))
        self.blocks[0].refresh_from_db()
        self.assertEqual(self.blocks[0].start_at, original)
        self.assertEqual(self._status(older), ScheduleRevision.Status.EXPIRED)

    def test_declining_an_older_one_leaves_the_newest_answerable(self):
        older = self._proposal()
        newest = self._proposal()

        reject_revision(older)

        self.assertEqual(self._status(newest), ScheduleRevision.Status.PROPOSED)
        confirm_revision(newest)
        self.assertEqual(self._status(newest), ScheduleRevision.Status.CONFIRMED)

    def test_declining_closes_older_ones_about_other_blocks_too(self):
        # Принять из них всё равно можно только одно: подтверждение двигает версию,
        # и остальные устаревают, о каких бы занятиях они ни были.
        about_another_block = propose_moves(
            self.schedule,
            moves=[
                BlockMove(
                    block_id=str(self.blocks[1].id),
                    start_at=self.free_slot_start() + timedelta(days=7),
                )
            ],
        )

        reject_revision(self._proposal())

        self.assertEqual(
            self._status(about_another_block), ScheduleRevision.Status.EXPIRED
        )

    def test_declining_leaves_other_schedules_alone(self):
        other = generate_schedule(
            plan=self.plan, start_date=MONDAY, template=self.schedule.template
        ).schedule
        elsewhere = ScheduleRevision.objects.create(
            user_email=other.user_email,
            schedule=other,
            base_version=self.schedule.version,
            proposed_version=self.schedule.version + 1,
        )

        reject_revision(self._proposal())

        self.assertEqual(self._status(elsewhere), ScheduleRevision.Status.PROPOSED)


@skipUnlessDBFeature("has_select_for_update")
class OverlappingAnswersOnRowLocksTests(TransactionTestCase):
    """Те же два ответа, но настоящие: каждый в своём потоке и соединении.

    Только на PostgreSQL: в SQLite нет построчной блокировки. Второй ответ приходит,
    пока первый ещё держит транзакцию, и обязан дождаться её конца, а не прочитать
    ревизию «предложенной».
    """

    def setUp(self):
        SchedulePlanFixture.setUp(self)
        self.schedule = generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=41),
            template=SchedulePlanFixture.make_template(self),
        ).schedule
        self.blocks = list(self.schedule.blocks.order_by("start_at"))
        self.block = self.blocks[0]
        self.original = self.block.start_at
        self.target = RevisionFixture.free_slot_start(self)

    def _overlap(self, first, late):
        """Что ответил второй: исключение или `None`, если он прошёл."""
        first_holds_the_lock = threading.Event()
        answers: queue.Queue = queue.Queue()

        def answer_first():
            try:
                with transaction.atomic():
                    first()
                    first_holds_the_lock.set()
                    # Второму хватит, чтобы дойти до блокировки. Не дойдёт — просто
                    # прочитает уже записанное, и ложного падения это не даст.
                    time.sleep(0.3)
            finally:
                first_holds_the_lock.set()
                connections.close_all()

        def answer_late():
            first_holds_the_lock.wait(timeout=10)
            try:
                late()
                answers.put(None)
            except RevisionRejected as exc:
                answers.put(exc)
            finally:
                connections.close_all()

        workers = [
            threading.Thread(target=answer_first),
            threading.Thread(target=answer_late),
        ]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=30)
        return answers.get_nowait()

    def _overlap_on_one_proposal(self, first, late):
        revision = propose_moves(
            self.schedule,
            moves=[BlockMove(block_id=str(self.block.id), start_at=self.target)],
        )
        first_copy = ScheduleRevision.objects.get(pk=revision.pk)
        late_copy = ScheduleRevision.objects.get(pk=revision.pk)

        answer = self._overlap(lambda: first(first_copy), lambda: late(late_copy))

        revision.refresh_from_db()
        self.block.refresh_from_db()
        self.schedule.refresh_from_db()
        return revision, answer

    def test_confirm_and_confirm(self):
        revision, late = self._overlap_on_one_proposal(
            confirm_revision, confirm_revision
        )

        self.assertIsInstance(late, ClosedRevision)
        self.assertEqual(revision.status, ScheduleRevision.Status.CONFIRMED)
        self.assertEqual(self.block.start_at, self.target)
        self.assertEqual(self.schedule.version, 2)
        undo_revision(revision)
        self.block.refresh_from_db()
        self.assertEqual(self.block.start_at, self.original)

    def test_reject_and_confirm(self):
        revision, late = self._overlap_on_one_proposal(
            reject_revision, confirm_revision
        )

        self.assertIsInstance(late, ClosedRevision)
        self.assertEqual(revision.status, ScheduleRevision.Status.REJECTED)
        self.assertEqual(self.block.start_at, self.original)
        self.assertEqual(self.schedule.version, 1)

    def test_confirm_and_reject(self):
        revision, late = self._overlap_on_one_proposal(
            confirm_revision, reject_revision
        )

        self.assertIsInstance(late, ClosedRevision)
        self.assertEqual(revision.status, ScheduleRevision.Status.CONFIRMED)
        self.assertEqual(self.block.start_at, self.target)
        self.assertEqual(self.schedule.version, 2)

    def test_two_courses_into_one_slot(self):
        # Ради этого lock общий на все курсы: у ревизий разные строки и разные
        # версии, и без него второй не увидит ещё не записанный перенос первого.
        physics = CoursePlan.objects.create(
            user_email=self.plan.user_email,
            goal=self.goal,
            title="Физика",
            status=CoursePlan.Status.ACTIVE,
        )
        other_schedule = StudySchedule.objects.create(
            user_email=self.plan.user_email,
            course_plan=physics,
            template=self.schedule.template,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=90),
            status=StudySchedule.Status.ACTIVE,
        )
        other_start = self.target + timedelta(days=1)
        other_block = LearningBlock.objects.create(
            user_email=self.plan.user_email,
            schedule=other_schedule,
            course_plan=physics,
            title="Физика",
            start_at=other_start,
            end_at=other_start + timedelta(minutes=45),
            duration_minutes=45,
        )
        mine = propose_moves(
            self.schedule,
            moves=[BlockMove(block_id=str(self.block.id), start_at=self.target)],
        )
        theirs = propose_moves(
            other_schedule,
            moves=[BlockMove(block_id=str(other_block.id), start_at=self.target)],
        )

        late = self._overlap(
            lambda: confirm_revision(mine), lambda: confirm_revision(theirs)
        )

        self.assertIsInstance(late, RevisionRejected)
        self.assertIn("другого курса", str(late))
        other_block.refresh_from_db()
        self.assertEqual(other_block.start_at, other_start)


class AnswerLockTests(RevisionFixture):
    """Какие блокировки просит ответ.

    SQLite игнорирует `select_for_update`, так что на нём никто не заметит, что
    блокировку убрали, а на PostgreSQL ответы снова начнут затирать друг друга.
    Поэтому компилятору говорят, что база их умеет, а из готового запроса
    блокировку записывают и вырезают: сам SQLite такого синтаксиса не поймёт.
    """

    FOR_UPDATE = " FOR UPDATE"
    CALENDAR_THEN_REVISION = [
        StudySchedule._meta.db_table,
        ScheduleRevision._meta.db_table,
    ]

    def _locking_statements(self, answer, revision):
        locking = []

        def record_and_strip(execute, sql, params, many, context):
            if sql.endswith(self.FOR_UPDATE):
                locking.append(sql)
                sql = sql.removesuffix(self.FOR_UPDATE)
            return execute(sql, params, many, context)

        with mock.patch.object(connection.features, "has_select_for_update", True):
            with connection.execute_wrapper(record_and_strip):
                answer(revision)
        return locking

    def _locks_requested_by(self, answer, revision):
        return [
            sql.split('FROM "', 1)[1].split('"', 1)[0]
            for sql in self._locking_statements(answer, revision)
        ]

    def _proposal(self):
        return propose_moves(
            self.schedule,
            moves=[
                BlockMove(
                    block_id=str(self.blocks[0].id), start_at=self.free_slot_start()
                )
            ],
        )

    def test_confirm_locks_the_calendar_then_the_revision(self):
        self.assertEqual(
            self._locks_requested_by(confirm_revision, self._proposal()),
            self.CALENDAR_THEN_REVISION,
        )

    def test_reject_locks_the_calendar_then_the_revision(self):
        self.assertEqual(
            self._locks_requested_by(reject_revision, self._proposal()),
            self.CALENDAR_THEN_REVISION,
        )

    def test_undo_locks_the_calendar_then_the_revision(self):
        revision = self._proposal()
        confirm_revision(revision)
        self.assertEqual(
            self._locks_requested_by(undo_revision, revision),
            self.CALENDAR_THEN_REVISION,
        )

    def test_calendar_lock_takes_every_course_in_one_order(self):
        # Только своё расписание — и переносы двух курсов в один слот разминутся
        # (`test_two_courses_into_one_slot`). Без порядка — две вкладки поймают
        # deadlock, а `confirm_schedule` берёт эти строки в том же порядке.
        calendar_lock = self._locking_statements(reject_revision, self._proposal())[0]

        self.assertIn('"user_email" =', calendar_lock)
        # `values_list("id")` Django сортирует по номеру колонки: `ORDER BY 1`.
        self.assertRegex(calendar_lock, r'ORDER BY (1|"[a-z_]+"\."id") ASC')

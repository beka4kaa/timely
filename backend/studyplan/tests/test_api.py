"""HTTP-контракт расписания: генерация, подтверждение, перенос, Undo, изоляция."""

from __future__ import annotations

import json
from datetime import time, timedelta
from unittest import mock

from django.test import TestCase

from curriculum.models import CoursePlan
from studyplan import revisions as revisions_service
from studyplan.models import (
    FixedCommitment,
    LearningBlock,
    ScheduleRevision,
    StudySchedule,
    WeeklyScheduleTemplate,
)

from .test_materialize import MONDAY, OWNER, SchedulePlanFixture
from config.testing import auth_headers

STRANGER = "stranger@example.com"


def headers(email: str = OWNER) -> dict:
    return auth_headers(email)


class ApiFixture(SchedulePlanFixture):
    def setUp(self):
        super().setUp()
        self.template = self.make_template()

    def generate(self, email: str = OWNER, **overrides):
        payload = {
            "course_plan": str(self.plan.id),
            "start_date": MONDAY.isoformat(),
            "end_date": (MONDAY + timedelta(days=41)).isoformat(),
            "timezone": "UTC",
            "template": str(self.template.id),
        }
        payload.update(overrides)
        return self.client.post(
            "/api/study-schedules/generate/",
            data=json.dumps(payload),
            content_type="application/json",
            **headers(email),
        )


class GenerateTests(ApiFixture):
    def test_generation_creates_a_proposed_schedule_with_blocks(self):
        response = self.generate()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertTrue(body["feasible"])
        self.assertGreater(body["blocks_created"], 0)
        self.assertEqual(body["schedule"]["status"], StudySchedule.Status.PROPOSED)
        self.assertEqual(body["schedule"]["version"], 1)

    def test_generation_needs_a_user(self):
        response = self.client.post(
            "/api/study-schedules/generate/",
            data=json.dumps({"course_plan": str(self.plan.id), "start_date": "2026-08-17"}),
            content_type="application/json",
        )
        self.assertEqual(response.status_code, 401)

    def test_cannot_generate_for_someone_elses_plan(self):
        response = self.generate(email=STRANGER)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "plan_not_found")

    def test_unknown_template_is_reported(self):
        response = self.generate(template="0" * 8 + "-0000-0000-0000-" + "0" * 12)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "template_not_found")

    def test_backwards_horizon_is_rejected(self):
        response = self.generate(end_date=(MONDAY - timedelta(days=1)).isoformat())
        self.assertEqual(response.status_code, 400)


class ScheduleAccessTests(ApiFixture):
    def setUp(self):
        super().setUp()
        self.schedule_id = self.generate().json()["schedule"]["id"]

    def test_list_shows_only_own_schedules(self):
        response = self.client.get("/api/study-schedules/", **headers(STRANGER))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

        own = self.client.get("/api/study-schedules/", **headers()).json()
        self.assertEqual(len(own), 1)
        self.assertFalse(own[0]["setup_restartable"])

    def test_stranger_cannot_open_a_schedule(self):
        response = self.client.get(
            f"/api/study-schedules/{self.schedule_id}/", **headers(STRANGER)
        )
        self.assertEqual(response.status_code, 404)

    def test_blocks_can_be_narrowed_to_a_week(self):
        week_end = (MONDAY + timedelta(days=7)).isoformat()
        response = self.client.get(
            f"/api/study-schedules/{self.schedule_id}/blocks/?from={MONDAY.isoformat()}&to={week_end}",
            **headers(),
        )
        self.assertEqual(response.status_code, 200)
        blocks = response.json()
        self.assertTrue(blocks)
        for block in blocks:
            self.assertLess(block["start_at"][:10], week_end)

    def test_filter_by_course_plan(self):
        response = self.client.get(
            f"/api/study-schedules/?course_plan={self.plan.id}", **headers()
        )
        self.assertEqual(len(response.json()), 1)


class ConfirmTests(ApiFixture):
    def test_confirmation_activates_and_archives_the_rest(self):
        first = self.generate().json()["schedule"]["id"]
        second = self.generate().json()["schedule"]["id"]

        response = self.client.post(
            f"/api/study-schedules/{second}/confirm/", **headers()
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], StudySchedule.Status.ACTIVE)

        self.assertEqual(
            StudySchedule.objects.get(pk=first).status, StudySchedule.Status.ARCHIVED
        )

    def test_infeasible_schedule_cannot_be_confirmed(self):
        # Одно окно в неделю на шесть тем — программа не помещается.
        narrow = WeeklyScheduleTemplate.objects.create(
            user_email=OWNER, title="Узкий ритм", timezone="UTC", active=False
        )
        narrow.slots.create(weekday=0, start_time="17:00", duration_minutes=45)
        schedule_id = self.generate(
            template=str(narrow.id),
            end_date=(MONDAY + timedelta(days=6)).isoformat(),
        ).json()["schedule"]["id"]

        response = self.client.post(
            f"/api/study-schedules/{schedule_id}/confirm/", **headers()
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "not_confirmable")

    def test_non_setup_confirmation_does_not_rewrite_course_pace(self):
        self.plan.recommended_sessions_per_week = 4
        self.plan.recommended_session_minutes = 50
        self.plan.save(
            update_fields=[
                "recommended_sessions_per_week",
                "recommended_session_minutes",
                "updated_at",
            ]
        )
        schedule_id = self.generate().json()["schedule"]["id"]

        response = self.client.post(
            f"/api/study-schedules/{schedule_id}/confirm/", **headers()
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.recommended_sessions_per_week, 4)
        self.assertEqual(self.plan.recommended_session_minutes, 50)

    def test_retrying_active_confirmation_preserves_newer_proposal(self):
        active_id = self.generate().json()["schedule"]["id"]
        first = self.client.post(
            f"/api/study-schedules/{active_id}/confirm/", **headers()
        )
        self.assertEqual(first.status_code, 200, first.content)
        active = StudySchedule.objects.get(pk=active_id)
        active_template_id = active.template_id

        alternative_template = WeeklyScheduleTemplate.objects.create(
            user_email=OWNER,
            title="Новый вариант",
            timezone="UTC",
            active=False,
        )
        alternative_template.slots.create(
            weekday=5,
            start_time="10:00",
            duration_minutes=25,
        )
        proposal_id = self.generate(
            template=str(alternative_template.id)
        ).json()["schedule"]["id"]
        original_pace = (
            self.plan.recommended_sessions_per_week,
            self.plan.recommended_session_minutes,
        )

        retry = self.client.post(
            f"/api/study-schedules/{active_id}/confirm/", **headers()
        )

        self.assertEqual(retry.status_code, 200, retry.content)
        active.refresh_from_db()
        proposal = StudySchedule.objects.get(pk=proposal_id)
        alternative_template.refresh_from_db()
        self.plan.refresh_from_db()
        self.assertEqual(active.status, StudySchedule.Status.ACTIVE)
        self.assertEqual(active.template_id, active_template_id)
        self.assertTrue(active.template.active)
        self.assertEqual(proposal.status, StudySchedule.Status.PROPOSED)
        self.assertFalse(alternative_template.active)
        self.assertEqual(
            (
                self.plan.recommended_sessions_per_week,
                self.plan.recommended_session_minutes,
            ),
            original_pace,
        )


class RevisionApiTests(ApiFixture):
    def setUp(self):
        super().setUp()
        body = self.generate().json()
        self.schedule_id = body["schedule"]["id"]
        self.schedule = StudySchedule.objects.get(pk=self.schedule_id)
        self.blocks = list(self.schedule.blocks.order_by("start_at"))

    def _free_start(self):
        last = max(block.end_at for block in self.blocks)
        candidate = last + timedelta(days=1)
        while candidate.weekday() != 6:
            candidate += timedelta(days=1)
        return candidate.replace(hour=12, minute=0, second=0, microsecond=0)

    def _propose(self, **overrides):
        payload = {
            "moves": [
                {
                    "block_id": str(self.blocks[0].id),
                    "start_at": self._free_start().isoformat(),
                }
            ],
            "base_version": self.schedule.version,
        }
        payload.update(overrides)
        return self.client.post(
            f"/api/study-schedules/{self.schedule_id}/revisions/",
            data=json.dumps(payload),
            content_type="application/json",
            **headers(),
        )

    def test_propose_confirm_and_undo(self):
        proposed = self._propose()
        self.assertEqual(proposed.status_code, 201, proposed.content)
        revision_id = proposed.json()["id"]
        self.assertEqual(proposed.json()["status"], ScheduleRevision.Status.PROPOSED)

        original = self.blocks[0].start_at
        confirmed = self.client.post(
            f"/api/schedule-revisions/{revision_id}/confirm/", **headers()
        )
        self.assertEqual(confirmed.status_code, 200)
        self.blocks[0].refresh_from_db()
        self.assertNotEqual(self.blocks[0].start_at, original)

        undone = self.client.post(
            f"/api/schedule-revisions/{revision_id}/undo/", **headers()
        )
        self.assertEqual(undone.status_code, 200)
        self.blocks[0].refresh_from_db()
        self.assertEqual(self.blocks[0].start_at, original)

    def test_stale_base_version_is_refused(self):
        response = self._propose(base_version=99)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "stale_version")

    def test_conflicting_move_is_refused_with_a_reason(self):
        response = self._propose(
            moves=[
                {
                    "block_id": str(self.blocks[0].id),
                    "start_at": self.blocks[1].start_at.isoformat(),
                }
            ]
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "revision_rejected")

    def test_reject_leaves_the_calendar_alone(self):
        revision_id = self._propose().json()["id"]
        original = self.blocks[0].start_at
        response = self.client.post(
            f"/api/schedule-revisions/{revision_id}/reject/", **headers()
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], ScheduleRevision.Status.REJECTED)
        self.blocks[0].refresh_from_db()
        self.assertEqual(self.blocks[0].start_at, original)

    def test_stranger_cannot_touch_a_revision(self):
        revision_id = self._propose().json()["id"]
        response = self.client.post(
            f"/api/schedule-revisions/{revision_id}/confirm/", **headers(STRANGER)
        )
        self.assertEqual(response.status_code, 404)

    def test_duplicate_block_in_one_proposal_is_rejected(self):
        start = self._free_start().isoformat()
        response = self._propose(
            moves=[
                {"block_id": str(self.blocks[0].id), "start_at": start},
                {"block_id": str(self.blocks[0].id), "start_at": start},
            ]
        )
        self.assertEqual(response.status_code, 400)

    def _proposal_id(self, **overrides):
        response = self._propose(**overrides)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["id"]

    def _answer(self, revision_id, verb):
        response = self.client.post(
            f"/api/schedule-revisions/{revision_id}/{verb}/", **headers()
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.schedule.refresh_from_db()

    def _listed(self, query=""):
        response = self.client.get(
            f"/api/study-schedules/{self.schedule_id}/revisions/{query}", **headers()
        )
        self.assertEqual(response.status_code, 200, response.content)
        return [item["id"] for item in response.json()]

    def test_open_filter_keeps_only_waiting_proposals_on_the_current_version(self):
        outdated = self._proposal_id()
        applied = self._proposal_id()
        self._answer(applied, "confirm")

        # Другой блок и другая неделя: первый перенос уже занял прежнее место.
        moves = [
            {
                "block_id": str(self.blocks[1].id),
                "start_at": (self._free_start() + timedelta(days=7)).isoformat(),
            }
        ]
        # Отклонена при той же версии расписания: отсеять её может только статус.
        declined = self._proposal_id(moves=moves)
        self._answer(declined, "reject")
        waiting = self._proposal_id(moves=moves)

        # Устаревшая всё ещё «предложена»: отсеять её может только версия.
        self.assertEqual(
            ScheduleRevision.objects.get(pk=outdated).status,
            ScheduleRevision.Status.PROPOSED,
        )
        self.assertEqual(self._listed("?open=1"), [waiting])

    def test_open_filter_sends_every_proposal_still_waiting(self):
        first = self._proposal_id()
        second = self._proposal_id()
        self.assertCountEqual(self._listed("?open=1"), [first, second])

    def test_declining_the_newest_brings_no_older_proposal_back(self):
        self._proposal_id()
        newest = self._proposal_id()

        self._answer(newest, "reject")

        self.assertEqual(self._listed("?open=1"), [])

    def test_replaced_schedule_has_no_open_proposals(self):
        revision_id = self._proposal_id()
        StudySchedule.objects.filter(pk=self.schedule.pk).update(
            status=StudySchedule.Status.ARCHIVED
        )

        self.assertEqual(self._listed("?open=1"), [])
        self.assertIn(revision_id, self._listed())

    def test_answer_on_a_replaced_schedule_says_it_is_stale(self):
        revision_id = self._proposal_id()
        StudySchedule.objects.filter(pk=self.schedule.pk).update(
            status=StudySchedule.Status.ARCHIVED
        )

        response = self.client.post(
            f"/api/schedule-revisions/{revision_id}/confirm/", **headers()
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "stale_revision")

    def test_answering_a_closed_proposal_says_it_is_closed(self):
        # Отдельный код: повторять такой ответ бессмысленно, и карточка не должна
        # предлагать его снова, в отличие от отказа из-за занятого времени.
        revision_id = self._proposal_id()
        self._answer(revision_id, "reject")

        for verb in ("confirm", "reject", "undo"):
            with self.subTest(verb=verb):
                response = self.client.post(
                    f"/api/schedule-revisions/{revision_id}/{verb}/", **headers()
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["code"], "revision_closed")

    def _open_cards(self):
        response = self.client.get(
            f"/api/study-schedules/{self.schedule_id}/revisions/?open=1", **headers()
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def _post_json(self, url, payload):
        response = self.client.post(
            url,
            data=json.dumps(payload),
            content_type="application/json",
            **headers(),
        )
        self.assertIn(response.status_code, (200, 201), response.content)
        return response

    def _pin_first_block(self, pinned):
        self._post_json(
            "/api/learning-blocks/pin/",
            {"block_ids": [str(self.blocks[0].id)], "pinned": pinned},
        )

    def test_open_proposal_that_can_be_accepted_has_no_reason(self):
        self._proposal_id()
        self.assertIsNone(self._open_cards()[0]["blocked_reason"])

    def test_blocked_reason_is_what_accepting_would_answer(self):
        revision_id = self._proposal_id()
        self._pin_first_block(True)

        reason = self._open_cards()[0]["blocked_reason"]

        self.assertIn("закреплён", reason)
        refused = self.client.post(
            f"/api/schedule-revisions/{revision_id}/confirm/", **headers()
        )
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json()["error"], reason)

    def test_reason_goes_away_with_the_pin_and_the_proposal_works_again(self):
        revision_id = self._proposal_id()
        self._pin_first_block(True)
        self.assertIsNotNone(self._open_cards()[0]["blocked_reason"])

        self._pin_first_block(False)

        self.assertIsNone(self._open_cards()[0]["blocked_reason"])
        self._answer(revision_id, "confirm")

    def test_reason_for_a_cancelled_block(self):
        revision_id = self._proposal_id()
        cancel = {"block_ids": [str(self.blocks[0].id)]}
        self._post_json("/api/learning-blocks/cancel/", cancel)

        self.assertIn("отменён", self._open_cards()[0]["blocked_reason"])

        self._post_json("/api/learning-blocks/cancel/", {**cancel, "restore": True})
        self.assertIsNone(self._open_cards()[0]["blocked_reason"])
        self._answer(revision_id, "confirm")

    def test_reason_for_a_commitment_over_the_target(self):
        revision_id = self._proposal_id()
        target = self._free_start()
        commitment = FixedCommitment.objects.create(
            user_email=OWNER,
            kind=FixedCommitment.Kind.FAMILY,
            title="Семейный обед",
            start_at=target - timedelta(minutes=10),
            end_at=target + timedelta(hours=2),
        )

        self.assertIn("занято", self._open_cards()[0]["blocked_reason"])

        commitment.delete()
        self.assertIsNone(self._open_cards()[0]["blocked_reason"])
        self._answer(revision_id, "confirm")

    def test_reason_for_another_courses_block_on_the_target(self):
        revision_id = self._proposal_id()
        target = self._free_start()
        physics = CoursePlan.objects.create(
            user_email=OWNER,
            goal=self.goal,
            title="Физика",
            status=CoursePlan.Status.ACTIVE,
        )
        other_schedule = StudySchedule.objects.create(
            user_email=OWNER,
            course_plan=physics,
            template=self.template,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=90),
            status=StudySchedule.Status.ACTIVE,
        )
        other_block = LearningBlock.objects.create(
            user_email=OWNER,
            schedule=other_schedule,
            course_plan=physics,
            title="Физика",
            start_at=target,
            end_at=target + timedelta(minutes=45),
            duration_minutes=45,
        )

        self.assertIn("другого курса", self._open_cards()[0]["blocked_reason"])

        other_block.delete()
        self.assertIsNone(self._open_cards()[0]["blocked_reason"])
        self._answer(revision_id, "confirm")

    def test_checking_a_proposal_changes_nothing(self):
        revision_id = self._proposal_id()
        self._pin_first_block(True)
        version = StudySchedule.objects.get(pk=self.schedule_id).version
        before = ScheduleRevision.objects.get(pk=revision_id).updated_at

        self._open_cards()

        revision = ScheduleRevision.objects.get(pk=revision_id)
        self.assertEqual(revision.status, ScheduleRevision.Status.PROPOSED)
        self.assertEqual(revision.updated_at, before)
        self.assertEqual(StudySchedule.objects.get(pk=self.schedule_id).version, version)

    def test_history_is_not_checked(self):
        # История растёт без предела: проверять её на каждое чтение незачем.
        self._proposal_id()
        response = self.client.get(
            f"/api/study-schedules/{self.schedule_id}/revisions/", **headers()
        )
        self.assertNotIn("blocked_reason", response.json()[0])

    def _proposal_in_another_schedule(self, email):
        plan = CoursePlan.objects.create(
            user_email=email,
            goal=self.goal,
            title="Другой курс",
            status=CoursePlan.Status.ACTIVE,
        )
        schedule = StudySchedule.objects.create(
            user_email=email,
            course_plan=plan,
            template=self.template,
            start_date=MONDAY,
            end_date=MONDAY + timedelta(days=41),
        )
        return ScheduleRevision.objects.create(
            user_email=email,
            schedule=schedule,
            base_version=schedule.version,
            proposed_version=schedule.version + 1,
        )

    def test_open_filter_stays_inside_the_requested_schedule(self):
        # Тот же статус и та же версия: отличается только расписание.
        self._proposal_in_another_schedule(OWNER)
        self._proposal_in_another_schedule(STRANGER)
        own = self._proposal_id()

        self.assertEqual(self._listed("?open=1"), [own])

    def test_undo_does_not_reopen_older_proposals(self):
        # Календарь снова как был, но версия выросла: «Принять» на старом
        # предложении упадёт, поэтому показывать его нельзя.
        older = self._proposal_id()
        applied = self._proposal_id()
        self._answer(applied, "confirm")
        self.assertEqual(self._listed("?open=1"), [])

        self._answer(applied, "undo")
        self.assertEqual(self._listed("?open=1"), [])
        self.assertIn(older, self._listed())

    def test_revisions_without_the_open_filter_return_the_whole_history(self):
        declined = self._proposal_id()
        self._answer(declined, "reject")
        waiting = self._proposal_id()

        self.assertCountEqual(self._listed(), [declined, waiting])
        self.assertCountEqual(self._listed("?open=0"), [declined, waiting])

    def test_stranger_cannot_read_open_proposals(self):
        self._proposal_id()
        response = self.client.get(
            f"/api/study-schedules/{self.schedule_id}/revisions/?open=1",
            **headers(STRANGER),
        )
        self.assertEqual(response.status_code, 404)


class BlockPatchTests(RevisionApiTests):
    def test_manual_drag_applies_immediately_and_returns_undo_handle(self):
        target = self._free_start()
        response = self.client.patch(
            f"/api/learning-blocks/{self.blocks[0].id}/",
            data=json.dumps({"start_at": target.isoformat()}),
            content_type="application/json",
            **headers(),
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["block"]["start_at"][:16], target.isoformat()[:16])
        self.assertEqual(body["revision"]["status"], ScheduleRevision.Status.CONFIRMED)

        # Перенос записан как ревизия и его можно отменить.
        undone = self.client.post(
            f"/api/schedule-revisions/{body['revision']['id']}/undo/", **headers()
        )
        self.assertEqual(undone.status_code, 200)

    def test_manual_drag_onto_busy_time_is_refused(self):
        target = self._free_start()
        FixedCommitment.objects.create(
            user_email=OWNER,
            kind=FixedCommitment.Kind.SCHOOL,
            title="Школа",
            start_at=target - timedelta(minutes=5),
            end_at=target + timedelta(hours=1),
        )
        response = self.client.patch(
            f"/api/learning-blocks/{self.blocks[0].id}/",
            data=json.dumps({"start_at": target.isoformat()}),
            content_type="application/json",
            **headers(),
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "revision_rejected")

    def _drag_interrupted_by(self, interference):
        """Настоящий PATCH; между предложением и подтверждением — `interference`."""
        real_propose = revisions_service.propose_moves

        def propose_then_interfere(*args, **kwargs):
            revision = real_propose(*args, **kwargs)
            interference()
            return revision

        with mock.patch.object(
            revisions_service, "propose_moves", propose_then_interfere
        ):
            return self.client.patch(
                f"/api/learning-blocks/{self.blocks[0].id}/",
                data=json.dumps({"start_at": self._free_start().isoformat()}),
                content_type="application/json",
                **headers(),
            )

    def _assert_drag_left_nothing(self, response, code="revision_rejected"):
        # Ученику сказали, что перенос не удался. Живое предложение с тем же
        # переносом показалось бы на главной и применило бы его позже.
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["code"], code)
        self.assertEqual(self._listed(), [])
        original = self.blocks[0].start_at
        self.blocks[0].refresh_from_db()
        self.assertEqual(self.blocks[0].start_at, original)

    def test_drag_blocked_by_a_new_commitment_leaves_no_proposal(self):
        target = self._free_start()

        def commitment_takes_the_slot():
            FixedCommitment.objects.create(
                user_email=OWNER,
                kind=FixedCommitment.Kind.FAMILY,
                title="Репетитор",
                start_at=target,
                end_at=target + timedelta(hours=1),
            )

        self._assert_drag_left_nothing(
            self._drag_interrupted_by(commitment_takes_the_slot)
        )

    def test_drag_of_a_block_cancelled_meanwhile_leaves_no_proposal(self):
        def cancel_key_lands():
            LearningBlock.objects.filter(pk=self.blocks[0].pk).update(
                status=LearningBlock.Status.CANCELLED
            )

        self._assert_drag_left_nothing(self._drag_interrupted_by(cancel_key_lands))

    def test_drag_overtaken_by_another_change_leaves_no_proposal(self):
        # Отказ через версию идёт другой веткой, и пометка «устарела» внутри
        # подтверждения не должна пережить откат всего переноса. Код тот же, что
        # у проверки `base_version`: по нему календарь перечитывается.
        def another_tab_moves_something():
            StudySchedule.objects.filter(pk=self.schedule.pk).update(
                version=self.schedule.version + 1
            )

        self._assert_drag_left_nothing(
            self._drag_interrupted_by(another_tab_moves_something),
            code="stale_revision",
        )

    def test_drag_in_a_replaced_schedule_leaves_no_proposal(self):
        # Вкладка открыта на старом варианте: версия та же, а он уже в архиве.
        StudySchedule.objects.filter(pk=self.schedule.pk).update(
            status=StudySchedule.Status.ARCHIVED
        )

        response = self.client.patch(
            f"/api/learning-blocks/{self.blocks[0].id}/",
            data=json.dumps(
                {
                    "start_at": self._free_start().isoformat(),
                    "base_version": self.schedule.version,
                }
            ),
            content_type="application/json",
            **headers(),
        )

        self._assert_drag_left_nothing(response, code="stale_revision")

    def test_put_is_not_a_way_to_move_a_block(self):
        response = self.client.put(
            f"/api/learning-blocks/{self.blocks[0].id}/",
            data=json.dumps({"start_at": self._free_start().isoformat()}),
            content_type="application/json",
            **headers(),
        )
        self.assertEqual(response.status_code, 400)

    def test_stranger_cannot_move_a_block(self):
        response = self.client.patch(
            f"/api/learning-blocks/{self.blocks[0].id}/",
            data=json.dumps({"start_at": self._free_start().isoformat()}),
            content_type="application/json",
            **headers(STRANGER),
        )
        self.assertEqual(response.status_code, 404)


class TemplateAndCommitmentApiTests(SchedulePlanFixture):
    def test_template_crud_is_scoped_to_the_owner(self):
        created = self.client.post(
            "/api/study-templates/",
            data=json.dumps({"title": "Вечерний ритм", "timezone": "Europe/Moscow"}),
            content_type="application/json",
            **headers(),
        )
        self.assertEqual(created.status_code, 201, created.content)
        template_id = created.json()["id"]

        slot = self.client.post(
            f"/api/study-templates/{template_id}/slots/",
            data=json.dumps(
                {
                    "weekday": 1,
                    "start_time": "18:00",
                    "duration_minutes": 45,
                    "allowed_activity_types": ["theory", "assessment"],
                }
            ),
            content_type="application/json",
            **headers(),
        )
        self.assertEqual(slot.status_code, 201, slot.content)
        self.assertEqual(len(slot.json()["slots"]), 1)

        self.assertEqual(
            self.client.get("/api/study-templates/", **headers(STRANGER)).json(), []
        )

    def test_unknown_activity_type_in_a_slot_is_rejected(self):
        template_id = self.client.post(
            "/api/study-templates/",
            data=json.dumps({"title": "Ритм"}),
            content_type="application/json",
            **headers(),
        ).json()["id"]

        response = self.client.post(
            f"/api/study-templates/{template_id}/slots/",
            data=json.dumps(
                {
                    "weekday": 1,
                    "start_time": "18:00",
                    "duration_minutes": 45,
                    "allowed_activity_types": ["telepathy"],
                }
            ),
            content_type="application/json",
            **headers(),
        )
        self.assertEqual(response.status_code, 400)

    def test_commitment_requires_one_of_the_two_forms(self):
        response = self.client.post(
            "/api/study-commitments/",
            data=json.dumps({"kind": "school", "title": "Школа"}),
            content_type="application/json",
            **headers(),
        )
        self.assertEqual(response.status_code, 400)

    def test_recurring_commitment_is_accepted(self):
        response = self.client.post(
            "/api/study-commitments/",
            data=json.dumps(
                {
                    "kind": "school",
                    "title": "Школа",
                    "weekday": 0,
                    "start_time": "08:00",
                    "duration_minutes": 300,
                    "source": "chat",
                    "source_text": "по будням с восьми до часу школа",
                }
            ),
            content_type="application/json",
            **headers(),
        )
        self.assertEqual(response.status_code, 201, response.content)
        commitment = FixedCommitment.objects.get(pk=response.json()["id"])
        self.assertEqual(commitment.user_email, OWNER)
        self.assertEqual(commitment.source, FixedCommitment.Source.CHAT)

    def make_commitment(self, email: str = OWNER) -> FixedCommitment:
        return FixedCommitment.objects.create(
            user_email=email,
            kind=FixedCommitment.Kind.OTHER,
            title="Английский",
            weekday=1,
            start_time="09:00",
            duration_minutes=120,
        )

    def test_commitment_is_deleted_for_good(self):
        """Delete в календаре убирает занятость совсем.

        У занятия есть статус «отменено», у занятости его нет: строка либо
        существует, либо нет. Ctrl+Z поэтому пересоздаёт её заново — но это
        уже работа фронтенда, здесь важно, что удаление не оставляет следа.
        """
        commitment = self.make_commitment()

        response = self.client.delete(
            f"/api/study-commitments/{commitment.id}/", **headers()
        )

        self.assertEqual(response.status_code, 204, response.content)
        self.assertFalse(FixedCommitment.objects.filter(pk=commitment.id).exists())

    def test_commitment_of_another_student_is_not_deletable(self):
        commitment = self.make_commitment(email="another@example.com")

        response = self.client.delete(
            f"/api/study-commitments/{commitment.id}/", **headers()
        )

        self.assertEqual(response.status_code, 404)
        self.assertTrue(FixedCommitment.objects.filter(pk=commitment.id).exists())


class CancelBlocksTests(ApiFixture):
    """Delete в календаре отменяет занятия пачкой и умеет вернуть их обратно."""

    def setUp(self):
        super().setUp()
        self.generate()
        self.schedule = StudySchedule.objects.get(user_email=OWNER)
        self.blocks = list(self.schedule.blocks.order_by("start_at"))

    def cancel(self, ids, email: str = OWNER, **extra):
        payload = {"block_ids": [str(item) for item in ids]}
        payload.update(extra)
        return self.client.post(
            "/api/learning-blocks/cancel/",
            data=json.dumps(payload),
            content_type="application/json",
            **headers(email),
        )

    def test_several_blocks_are_cancelled_in_one_call(self):
        targets = self.blocks[:3]
        response = self.cancel([block.id for block in targets])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()["changed"]), 3)
        for block in targets:
            block.refresh_from_db()
            self.assertEqual(block.status, LearningBlock.Status.CANCELLED)

    def test_cancelling_is_reversible(self):
        block = self.blocks[0]
        self.cancel([block.id])
        response = self.cancel([block.id], restore=True)
        self.assertEqual(response.status_code, 200, response.content)
        block.refresh_from_db()
        self.assertEqual(block.status, LearningBlock.Status.SCHEDULED)

    def test_completed_work_is_not_erased(self):
        block = self.blocks[0]
        block.status = LearningBlock.Status.COMPLETED
        block.save(update_fields=["status"])
        response = self.cancel([block.id])
        self.assertEqual(response.json()["changed"], [])
        block.refresh_from_db()
        self.assertEqual(block.status, LearningBlock.Status.COMPLETED)

    def test_pinned_block_stays_put(self):
        block = self.blocks[0]
        block.fixed = True
        block.save(update_fields=["fixed"])
        self.cancel([block.id])
        block.refresh_from_db()
        self.assertEqual(block.status, LearningBlock.Status.SCHEDULED)

    def test_stranger_cannot_cancel_someone_elses_blocks(self):
        block = self.blocks[0]
        response = self.cancel([block.id], email=STRANGER)
        self.assertEqual(response.json()["changed"], [])
        block.refresh_from_db()
        self.assertEqual(block.status, LearningBlock.Status.SCHEDULED)

    def test_empty_request_is_refused(self):
        response = self.cancel([])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "ids_required")


class PinBlocksTests(ApiFixture):
    """Закрепление стало переключателем, а не только результатом генерации."""

    def setUp(self):
        super().setUp()
        self.generate()
        self.schedule = StudySchedule.objects.get(user_email=OWNER)
        self.block = self.schedule.blocks.order_by("start_at").first()

    def pin(self, pinned, ids=None, email: str = OWNER):
        # `is None`, а не `or`: пустой список — это осмысленный случай, который
        # должен доехать до сервера и получить отказ.
        targets = [self.block.id] if ids is None else ids
        payload = {
            "block_ids": [str(item) for item in targets],
            "pinned": pinned,
        }
        return self.client.post(
            "/api/learning-blocks/pin/",
            data=json.dumps(payload),
            content_type="application/json",
            **headers(email),
        )

    def test_pin_and_unpin(self):
        self.assertFalse(self.block.fixed)

        self.assertEqual(self.pin(True).status_code, 200)
        self.block.refresh_from_db()
        self.assertTrue(self.block.fixed)

        self.assertEqual(self.pin(False).status_code, 200)
        self.block.refresh_from_db()
        self.assertFalse(self.block.fixed)

    def test_repeated_call_changes_nothing(self):
        self.pin(True)
        self.assertEqual(self.pin(True).json()["changed"], [])

    def test_stranger_cannot_pin_someone_elses_block(self):
        response = self.pin(True, email=STRANGER)
        self.assertEqual(response.json()["changed"], [])
        self.block.refresh_from_db()
        self.assertFalse(self.block.fixed)

    def test_empty_request_is_refused(self):
        response = self.pin(True, ids=[])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "ids_required")


QUICK_PLAN_URL = "/api/study-schedules/quick-plan/"
QUICK_PLAN = {
    "subject": "Русский язык",
    "weekdays": [0, 1, 2, 3, 4],
    "start_time": "16:00",
    "minutes": 60,
    "from_date": "2030-01-07",
    "to_date": "2030-01-11",
    "timezone": "Asia/Almaty",
}


class QuickPlanApiTests(TestCase):
    def post(self, url=QUICK_PLAN_URL, body=None, email=OWNER):
        return self.client.post(
            url,
            data=json.dumps(QUICK_PLAN if body is None else body),
            content_type="application/json",
            **headers(email),
        )

    def test_quick_plan_creates_and_undo_removes(self):
        response = self.post()

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["sessions"], 5)
        self.assertEqual(LearningBlock.objects.filter(user_email=OWNER).count(), 5)

        gone = self.post(f"{QUICK_PLAN_URL}undo/", {"undo": response.json()["undo"]})

        self.assertEqual(gone.status_code, 204)
        self.assertFalse(StudySchedule.objects.filter(user_email=OWNER).exists())

    def test_a_subject_without_days(self):
        response = self.post(body={"subject": "Русский язык", "timezone": "Asia/Almaty"})

        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["schedule_id"])
        self.assertEqual(response.json()["sessions"], 0)

    def test_busy_is_a_readable_refusal(self):
        FixedCommitment.objects.create(
            user_email=OWNER, title="Репетитор", weekday=2, start_time=time(15, 30), duration_minutes=90
        )

        response = self.post()

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "busy")
        self.assertIn("9 января", response.json()["error"])
        self.assertIn("Репетитор", response.json()["error"])

    def test_the_card_is_checked_and_applied_once(self):
        changed = self.post(body={**QUICK_PLAN, "expected_sessions": 4, "expected_path": "new_sessions"})
        self.assertEqual((changed.status_code, changed.json()["code"]), (400, "changed"))

        body = {**QUICK_PLAN, "expected_sessions": 5, "expected_path": "new_sessions", "key": "card-1"}
        first = self.post(body=body)
        second = self.post(body=body)

        self.assertEqual((first.status_code, second.status_code), (201, 201))
        self.assertEqual(first.json()["undo"], second.json()["undo"])
        self.assertEqual(LearningBlock.objects.filter(user_email=OWNER).count(), 5)

    def test_wrong_types_are_refused(self):
        for broken in ({"weekdays": ["пн"]}, {"start_time": "когда-нибудь"}, {"from_date": "завтра"}, {"minutes": "час"}):
            with self.subTest(broken=broken):
                response = self.post(body={**QUICK_PLAN, **broken})
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["code"], "bad_request")
        self.assertFalse(LearningBlock.objects.filter(user_email=OWNER).exists())

    def test_the_email_comes_only_from_the_request(self):
        self.post(body={**QUICK_PLAN, "user_email": STRANGER})

        self.assertFalse(StudySchedule.objects.filter(user_email=STRANGER).exists())
        self.assertTrue(StudySchedule.objects.filter(user_email=OWNER).exists())

    def test_someone_elses_undo_changes_nothing(self):
        undo = self.post().json()["undo"]

        response = self.post(f"{QUICK_PLAN_URL}undo/", {"undo": undo}, email=STRANGER)

        self.assertEqual(response.status_code, 204)
        self.assertEqual(LearningBlock.objects.filter(user_email=OWNER).count(), 5)

    def test_undo_after_progress_is_a_readable_refusal(self):
        undo = self.post().json()["undo"]
        LearningBlock.objects.filter(user_email=OWNER).update(status=LearningBlock.Status.COMPLETED)

        response = self.post(f"{QUICK_PLAN_URL}undo/", {"undo": undo})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "undo_stale")
        self.assertEqual(LearningBlock.objects.filter(user_email=OWNER).count(), 5)

    def test_undo_needs_something_to_undo(self):
        response = self.post(f"{QUICK_PLAN_URL}undo/", {"undo": "мусор"})

        self.assertEqual(response.status_code, 400)

    def test_without_a_user_nothing_happens(self):
        response = self.client.post(QUICK_PLAN_URL, data=json.dumps(QUICK_PLAN), content_type="application/json")

        self.assertIn(response.status_code, (400, 401))
        self.assertFalse(LearningBlock.objects.exists())

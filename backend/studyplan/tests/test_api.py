"""HTTP-контракт расписания: генерация, подтверждение, перенос, Undo, изоляция."""

from __future__ import annotations

import json
from datetime import timedelta

from studyplan.models import (
    FixedCommitment,
    ScheduleRevision,
    StudySchedule,
    WeeklyScheduleTemplate,
)

from .test_materialize import MONDAY, OWNER, SchedulePlanFixture

STRANGER = "stranger@example.com"


def headers(email: str = OWNER) -> dict:
    return {"HTTP_X_USER_EMAIL": email}


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
        self.assertEqual(response.status_code, 400)

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

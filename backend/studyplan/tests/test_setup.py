"""Signed guided setup: question order, ownership and proposal generation."""

from __future__ import annotations

import json
from unittest.mock import patch

from curriculum.models import CoursePlan
from studyplan import services
from studyplan.models import StudySchedule, WeeklyScheduleTemplate

from .test_api import STRANGER, headers
from .test_materialize import MONDAY, OWNER, SchedulePlanFixture


class ScheduleSetupTests(SchedulePlanFixture):
    endpoint = "/api/studyplan/setup/"

    def post(self, payload: dict, *, email: str = OWNER):
        return self.client.post(
            self.endpoint,
            data=json.dumps(payload),
            content_type="application/json",
            **headers(email),
        )

    def start(self, *, answers: dict | None = None, email: str = OWNER):
        payload = {
            "type": "schedule_setup",
            "timezone": "UTC",
            "start_date": MONDAY.isoformat(),
        }
        if answers is not None:
            payload["answers"] = answers
        return self.post(payload, email=email)

    def answer(self, body: dict, key: str, value: str, *, email: str = OWNER):
        return self.post(
            {
                "type": "schedule_setup",
                "session_id": body["session_id"],
                "answers": {**body["answers"], key: value},
            },
            email=email,
        )

    def complete(self, *, email: str = OWNER) -> dict:
        body = self.start(email=email).json()
        body = self.answer(body, "weekdays", "alternate", email=email).json()
        body = self.answer(body, "start_time", "17:00", email=email).json()
        body = self.answer(body, "session_minutes", "45", email=email).json()
        self.assertEqual(body["status"], "complete")
        return body

    def confirm(self, complete: dict, *, email: str = OWNER):
        return self.post(
            {
                "type": "confirm_schedule_setup",
                "session_id": complete["session_id"],
                "answers": complete["answers"],
            },
            email=email,
        )

    def test_single_plan_is_known_and_questions_are_asked_one_at_a_time(self):
        first = self.start()
        self.assertEqual(first.status_code, 200, first.content)
        body = first.json()
        self.assertEqual(body["status"], "question")
        self.assertEqual(body["question"]["id"], "weekdays")
        self.assertEqual(body["answers"]["course_plan_id"], str(self.plan.id))
        self.assertEqual(len(body["question"]["options"]), 3)
        self.assertTrue(body["allow_other"])

        body = self.answer(body, "weekdays", "alternate").json()
        self.assertEqual(body["question"]["id"], "start_time")
        self.assertEqual(body["answers"]["weekdays"], "0,2,4")

        body = self.answer(body, "start_time", "19:00").json()
        self.assertEqual(body["question"]["id"], "session_minutes")

        body = self.answer(body, "session_minutes", "25").json()
        self.assertEqual(body["status"], "complete")
        self.assertNotIn("question", body)
        self.assertEqual(body["summary"]["weekdays"], [0, 2, 4])
        self.assertEqual(body["summary"]["session_minutes"], 25)
        self.assertEqual(body["summary"]["minutes_per_week"], 75)

    def test_initial_request_cannot_bypass_the_one_question_flow(self):
        response = self.start(answers={"weekdays": "пн, ср"})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_answer")

    def test_multiple_plans_ask_for_one_of_at_most_three_owned_plans(self):
        plans = [self.plan]
        for index in range(3):
            plans.append(
                CoursePlan.objects.create(
                    user_email=OWNER,
                    goal=self.goal,
                    title=f"Дополнительная программа {index}",
                    status=CoursePlan.Status.ACTIVE,
                )
            )

        body = self.start().json()
        self.assertEqual(body["question"]["id"], "course_plan_id")
        self.assertFalse(body["allow_other"])
        self.assertEqual(len(body["question"]["options"]), 3)
        self.assertTrue(body["question"]["has_more"])
        offered = {option["id"] for option in body["question"]["options"]}
        self.assertTrue(offered.issubset({str(plan.id) for plan in plans}))

    def test_no_active_plan_is_a_blocking_response_without_writes(self):
        self.plan.status = CoursePlan.Status.ARCHIVED
        self.plan.save(update_fields=["status", "updated_at"])

        response = self.start()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            response.json(),
            {
                "type": "schedule_setup",
                "status": "blocked",
                "error": "Сначала создай и активируй учебную программу.",
                "code": "no_active_course_plans",
            },
        )
        self.assertFalse(WeeklyScheduleTemplate.objects.exists())

    def test_setup_is_blocked_when_a_current_schedule_already_exists(self):
        existing = services.generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            template=self.make_template(),
        ).schedule

        response = self.start()

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "schedule_already_exists")
        self.assertEqual(StudySchedule.objects.get().id, existing.id)

    def test_confirm_rechecks_if_another_tab_created_the_first_schedule(self):
        complete = self.complete()
        template = self.make_template()
        existing = services.generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            template=template,
        ).schedule

        response = self.confirm(complete)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "schedule_already_exists")
        self.assertEqual(list(StudySchedule.objects.values_list("id", flat=True)), [existing.id])
        template.refresh_from_db()
        self.assertTrue(template.active)

    def test_completed_schedule_does_not_block_a_fresh_start(self):
        schedule = services.generate_schedule(
            plan=self.plan,
            start_date=MONDAY,
            template=self.make_template(),
        ).schedule
        schedule.status = StudySchedule.Status.COMPLETED
        schedule.save(update_fields=["status", "updated_at"])

        response = self.start()

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], "question")

    def test_unconfirmed_setup_proposal_can_be_replaced_by_restart(self):
        first = self.complete()
        first_response = self.confirm(first)
        self.assertEqual(first_response.status_code, 201)
        first_schedule = StudySchedule.objects.get(
            pk=first_response.json()["schedule"]["id"]
        )
        listed = self.client.get("/api/study-schedules/", **headers()).json()
        self.assertTrue(listed[0]["setup_restartable"])

        restarted = self.start()
        self.assertEqual(restarted.status_code, 200, restarted.content)
        body = restarted.json()
        body = self.answer(body, "weekdays", "weekend").json()
        body = self.answer(body, "start_time", "10:00").json()
        body = self.answer(body, "session_minutes", "25").json()
        replacement = self.confirm(body)

        self.assertEqual(replacement.status_code, 201, replacement.content)
        first_schedule.refresh_from_db()
        self.assertEqual(first_schedule.status, StudySchedule.Status.ARCHIVED)
        current = StudySchedule.objects.exclude(
            status__in=[
                StudySchedule.Status.ARCHIVED,
                StudySchedule.Status.COMPLETED,
            ]
        ).get()
        self.assertEqual(str(current.id), replacement.json()["schedule"]["id"])
        self.assertTrue(current.setup_restartable)
        self.assertEqual(
            WeeklyScheduleTemplate.objects.filter(
                user_email=OWNER, active=True
            ).count(),
            1,
        )

    def test_foreign_plan_cannot_be_injected_as_an_initial_answer(self):
        foreign = CoursePlan.objects.create(
            user_email=STRANGER,
            goal=self.goal,
            title="Чужая программа",
            status=CoursePlan.Status.ACTIVE,
        )
        response = self.start(answers={"course_plan_id": str(foreign.id)})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_answer")

    def test_signed_session_is_bound_to_its_user_and_rejects_tampering(self):
        body = self.start().json()
        payload = {
            "type": "schedule_setup",
            "session_id": body["session_id"],
            "answers": body["answers"],
        }
        foreign = self.post(payload, email=STRANGER)
        self.assertEqual(foreign.status_code, 400)
        self.assertEqual(foreign.json()["code"], "invalid_session")

        payload["session_id"] += "tampered"
        tampered = self.post(payload)
        self.assertEqual(tampered.status_code, 400)
        self.assertEqual(tampered.json()["code"], "invalid_session")

    def test_mixed_case_owner_is_used_exactly_for_database_rows(self):
        mixed_case = "Student.Mixed@Example.com"
        self.goal.user_email = mixed_case
        self.goal.save(update_fields=["user_email", "updated_at"])
        self.plan.user_email = mixed_case
        self.plan.save(update_fields=["user_email", "updated_at"])

        complete = self.complete(email=mixed_case)
        response = self.confirm(complete, email=mixed_case)

        self.assertEqual(response.status_code, 201, response.content)
        schedule = StudySchedule.objects.get(pk=response.json()["schedule"]["id"])
        self.assertEqual(schedule.user_email, mixed_case)
        self.assertEqual(schedule.template.user_email, mixed_case)

    def test_previous_or_future_answers_cannot_be_rewritten(self):
        body = self.start().json()
        body = self.answer(body, "weekdays", "alternate").json()
        rewritten = self.post(
            {
                "type": "schedule_setup",
                "session_id": body["session_id"],
                "answers": {**body["answers"], "weekdays": "weekend"},
            }
        )
        self.assertEqual(rewritten.status_code, 400)
        self.assertEqual(rewritten.json()["code"], "invalid_session")

        start = self.start().json()
        skipped = self.post(
            {
                "type": "schedule_setup",
                "session_id": start["session_id"],
                "answers": {
                    **start["answers"],
                    "weekdays": "alternate",
                    "start_time": "17:00",
                },
            }
        )
        self.assertEqual(skipped.status_code, 400)
        self.assertEqual(skipped.json()["code"], "invalid_answer")

    def test_invalid_custom_answers_are_rejected(self):
        body = self.start().json()
        invalid_day = self.answer(body, "weekdays", "8")
        self.assertEqual(invalid_day.status_code, 400)
        self.assertEqual(invalid_day.json()["code"], "invalid_answer")

        body = self.answer(body, "weekdays", "alternate").json()
        invalid_time = self.answer(body, "start_time", "25:90")
        self.assertEqual(invalid_time.status_code, 400)

        body = self.answer(body, "start_time", "17:00").json()
        invalid_duration = self.answer(body, "session_minutes", "121")
        self.assertEqual(invalid_duration.status_code, 400)

    def test_confirm_creates_new_active_template_and_proposed_schedule(self):
        old_template = self.make_template(weekdays=(1,), minutes=60)
        old_slot_ids = list(old_template.slots.values_list("id", flat=True))
        complete = self.complete()

        response = self.confirm(complete)

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["status"], "created")
        self.assertTrue(body["feasible"])
        self.assertGreater(body["blocks_created"], 0)
        self.assertEqual(body["schedule"]["status"], StudySchedule.Status.PROPOSED)
        self.assertEqual(body["schedule"]["course_plan"], str(self.plan.id))

        old_template.refresh_from_db()
        self.assertFalse(old_template.active)
        self.assertEqual(
            list(old_template.slots.values_list("id", flat=True)), old_slot_ids
        )
        active = WeeklyScheduleTemplate.objects.get(user_email=OWNER, active=True)
        self.assertNotEqual(active.id, old_template.id)
        self.assertEqual(
            list(active.slots.values_list("weekday", flat=True)), [0, 2, 4]
        )
        self.assertEqual(
            {slot.start_time.isoformat(timespec="minutes") for slot in active.slots.all()},
            {"17:00"},
        )
        self.assertEqual(
            {slot.duration_minutes for slot in active.slots.all()}, {45}
        )
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.recommended_sessions_per_week, 3)
        self.assertEqual(self.plan.recommended_session_minutes, 45)

    def test_confirm_is_idempotent_for_the_signed_session(self):
        complete = self.complete()
        first = self.confirm(complete)
        second = self.confirm(complete)

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["schedule"]["id"], second.json()["schedule"]["id"])
        self.assertEqual(StudySchedule.objects.count(), 1)
        self.assertEqual(
            WeeklyScheduleTemplate.objects.filter(user_email=OWNER, active=True).count(),
            1,
        )

    def test_confirmed_session_fork_with_other_answers_is_rejected(self):
        first_branch = self.start().json()
        fork_point = self.answer(first_branch, "weekdays", "alternate").json()

        first_branch = self.answer(fork_point, "start_time", "17:00").json()
        first_branch = self.answer(
            first_branch, "session_minutes", "45"
        ).json()
        self.assertEqual(self.confirm(first_branch).status_code, 201)

        second_branch = self.answer(fork_point, "start_time", "19:00").json()
        second_branch = self.answer(
            second_branch, "session_minutes", "25"
        ).json()
        rejected = self.confirm(second_branch)

        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(rejected.json()["code"], "setup_already_confirmed")
        self.assertEqual(StudySchedule.objects.count(), 1)
        self.assertEqual(
            WeeklyScheduleTemplate.objects.filter(user_email=OWNER, active=True).count(),
            1,
        )

    def test_confirm_requires_the_completed_signed_answers(self):
        incomplete = self.start().json()
        response = self.confirm(incomplete)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "incomplete_setup")

        complete = self.complete()
        complete["answers"]["session_minutes"] = "60"
        response = self.confirm(complete)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_session")

    def test_generation_failure_rolls_back_template_and_pace_changes(self):
        old_template = self.make_template(weekdays=(1,), minutes=60)
        original_minutes = self.plan.recommended_session_minutes
        complete = self.complete()

        with patch(
            "studyplan.setup.services.generate_schedule",
            side_effect=services.ScheduleGenerationError("Не удалось построить."),
        ):
            response = self.confirm(complete)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "cannot_generate")
        old_template.refresh_from_db()
        self.assertTrue(old_template.active)
        self.assertEqual(WeeklyScheduleTemplate.objects.count(), 1)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.recommended_session_minutes, original_minutes)

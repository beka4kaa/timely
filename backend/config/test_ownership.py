"""A valid credential opens one account: its owner's.

Every request here carries a genuine token for STUDENT, and the rows belong to
OTHER. The same requests against STUDENT's own rows must keep working.
"""

from datetime import date
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import CustomUser, PrivateLeaderboard, Task
from ai_engine.models import LearningProgram, TopicPlan
from config.ownership import OwnedRelationsMixin, request_email
from config.testing import auth_headers
from diary.models import DiaryWeek, WeeklyTemplate
from mind.models import MindSession, Subject, Subtopic, Topic
from planner.models import Block, DayPlan, Goal, GoalLink, ScheduleSlot, Segment, Subtask

STUDENT = "student@example.com"
OTHER = "other@example.com"
DAY = date(2026, 11, 4)


def _plan_with_block(email, title):
    plan = DayPlan.objects.create(user_email=email, date=DAY)
    block = Block.objects.create(
        day_plan=plan, type="LESSON", title=title, duration_minutes=30, order_index=5
    )
    return plan, block


class _Base(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.credentials(**auth_headers(STUDENT))


class PlannerTests(_Base):
    def setUp(self):
        super().setUp()
        self.own_plan, self.own_block = _plan_with_block(STUDENT, "own block")
        self.plan, self.block = _plan_with_block(OTHER, "their block")
        self.segment = Segment.objects.create(
            block=self.block, title="their segment", duration_minutes=5, order_index=5
        )
        self.subtask = Subtask.objects.create(block=self.block, title="their subtask", order_index=5)

    def test_lists_show_only_own_rows(self):
        Segment.objects.create(block=self.own_block, title="own segment", duration_minutes=5, order_index=0)
        Subtask.objects.create(block=self.own_block, title="own subtask", order_index=0)
        for url, own, theirs in (
            ("/api/planner/dayplans/", str(self.own_plan.id), str(self.plan.id)),
            ("/api/planner/blocks/", "own block", "their block"),
            ("/api/planner/segments/", "own segment", "their segment"),
            ("/api/planner/subtasks/", "own subtask", "their subtask"),
        ):
            with self.subTest(url=url):
                body = self.client.get(url).content.decode()
                self.assertIn(own, body)
                self.assertNotIn(theirs, body)

    def test_someone_elses_rows_are_not_found(self):
        for method, url, data in (
            ("get", f"/api/planner/blocks/{self.block.id}/", None),
            ("patch", f"/api/planner/blocks/{self.block.id}/", {"title": "edited"}),
            ("delete", f"/api/planner/blocks/{self.block.id}/", None),
            ("post", f"/api/planner/blocks/{self.block.id}/timer/", {"action": "start"}),
            ("patch", f"/api/planner/segments/{self.segment.id}/", {"title": "edited"}),
            ("post", f"/api/planner/subtasks/{self.subtask.id}/toggle/", {}),
            ("patch", f"/api/planner/subtasks/{self.subtask.id}/", {"title": "edited"}),
        ):
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, data, format="json")
                self.assertEqual(response.status_code, 404)

        self.block.refresh_from_db()
        self.subtask.refresh_from_db()
        self.assertEqual(self.block.title, "their block")
        self.assertFalse(self.subtask.is_done)

    def test_own_rows_keep_working(self):
        response = self.client.patch(
            f"/api/planner/blocks/{self.own_block.id}/", {"title": "edited"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.own_block.refresh_from_db()
        self.assertEqual(self.own_block.title, "edited")

    def test_reorder_ignores_someone_elses_ids(self):
        for url, row in (
            ("/api/planner/blocks/reorder/", self.block),
            ("/api/planner/segments/reorder/", self.segment),
            ("/api/planner/subtasks/reorder/", self.subtask),
        ):
            with self.subTest(url=url):
                self.client.post(url, {"ids": [str(row.id)]}, format="json")
                row.refresh_from_db()
                self.assertEqual(row.order_index, 5)

    def test_reorder_moves_own_rows(self):
        self.client.post("/api/planner/blocks/reorder/", {"ids": [str(self.own_block.id)]}, format="json")
        self.own_block.refresh_from_db()
        self.assertEqual(self.own_block.order_index, 0)

    def test_cannot_add_rows_under_someone_elses_parent(self):
        for url, data, field in (
            (
                "/api/planner/blocks/",
                {"day_plan": str(self.plan.id), "type": "LESSON", "title": "planted",
                 "duration_minutes": 5, "order_index": 0},
                "day_plan",
            ),
            ("/api/planner/segments/",
             {"block": str(self.block.id), "title": "planted", "duration_minutes": 5, "order_index": 0},
             "block"),
            ("/api/planner/subtasks/", {"block": str(self.block.id), "title": "planted", "order_index": 0}, "block"),
        ):
            with self.subTest(url=url):
                response = self.client.post(url, data, format="json")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(list(response.json()), [field])

    def test_can_add_rows_under_own_parent(self):
        response = self.client.post(
            "/api/planner/blocks/",
            {"day_plan": str(self.own_plan.id), "type": "LESSON", "title": "new",
             "duration_minutes": 5, "order_index": 0},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        response = self.client.post(
            "/api/planner/subtasks/",
            {"block": str(self.own_block.id), "title": "new", "order_index": 0},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_new_day_plan_belongs_to_the_caller(self):
        response = self.client.post("/api/planner/dayplans/", {"date": "2026-12-01"}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(DayPlan.objects.get(pk=response.json()["id"]).user_email, STUDENT)

    def test_the_same_day_for_two_accounts_is_two_plans(self):
        response = self.client.post("/api/planner/dayplans/", {"date": str(DAY)}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["id"], str(self.own_plan.id))

    def test_day_plan_owner_cannot_be_rewritten(self):
        self.client.patch(f"/api/planner/dayplans/{DAY}/", {"user_email": OTHER}, format="json")
        self.own_plan.refresh_from_db()
        self.assertEqual(self.own_plan.user_email, STUDENT)

    def test_moving_a_plan_onto_an_existing_day_is_a_clean_error(self):
        DayPlan.objects.create(user_email=STUDENT, date=date(2026, 11, 5))
        response = self.client.patch(f"/api/planner/dayplans/{DAY}/", {"date": "2026-11-05"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_copy_reads_only_own_days_and_the_copy_has_an_owner(self):
        response = self.client.post(
            "/api/planner/dayplans/2026-11-06/copy/", {"from_date": str(DAY)}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        copied = DayPlan.objects.get(user_email=STUDENT, date=date(2026, 11, 6))
        self.assertEqual([b.title for b in copied.blocks.all()], ["own block"])

        Block.objects.filter(day_plan=self.own_plan).delete()
        self.own_plan.delete()
        response = self.client.post(
            "/api/planner/dayplans/2026-11-07/copy/", {"from_date": str(DAY)}, format="json"
        )
        self.assertEqual(response.status_code, 404)

    def test_schedule_slots_are_per_account(self):
        ScheduleSlot.objects.create(user_email=OTHER, day_of_week=1, start_time="09:00", end_time="10:00")
        self.assertEqual(self.client.get("/api/schedule/").json(), [])


class GoalTests(_Base):
    def setUp(self):
        super().setUp()
        self.goal = Goal.objects.create(user_email=OTHER, title="their goal", type="task")
        self.own = Goal.objects.create(user_email=STUDENT, title="own goal", type="task")

    def _sync(self, goals, links=()):
        return self.client.post(
            "/api/goals/bulk_sync/", {"goals": goals, "links": list(links)}, format="json"
        )

    def test_bulk_sync_cannot_take_over_someone_elses_goal(self):
        response = self._sync([{"id": str(self.goal.id), "title": "stolen", "type": "task"}])
        self.assertEqual(response.status_code, 403)
        self.goal.refresh_from_db()
        self.assertEqual((self.goal.user_email, self.goal.title), (OTHER, "their goal"))

    def test_bulk_sync_cannot_hang_a_goal_under_someone_elses(self):
        response = self._sync(
            [{"id": "brand-new", "title": "mine", "type": "task", "parentId": str(self.goal.id)}]
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Goal.objects.filter(id="brand-new").exists())

    def test_bulk_sync_keeps_working_for_own_and_new_goals(self):
        response = self._sync(
            [
                {"id": str(self.own.id), "title": "renamed", "type": "task"},
                {"id": "brand-new", "title": "new", "type": "task", "parentId": str(self.own.id)},
            ]
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.own.refresh_from_db()
        self.assertEqual(self.own.title, "renamed")
        self.assertEqual(Goal.objects.get(id="brand-new").user_email, STUDENT)

    def test_links_cannot_reach_someone_elses_goal(self):
        for data in (
            {"id": "l1", "source": str(self.own.id), "target": str(self.goal.id), "type": "depends_on"},
            {"id": "l2", "source": str(self.goal.id), "target": str(self.own.id), "type": "depends_on"},
        ):
            with self.subTest(data=data):
                response = self.client.post("/api/goals/links/", data, format="json")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(len(response.json()), 1)

    def test_old_links_and_children_do_not_expose_someone_elses_goal(self):
        # Rows that may already exist from before these checks.
        GoalLink.objects.create(id="old1", source=self.own, target=self.goal, type="depends_on")
        GoalLink.objects.create(id="old2", source=self.goal, target=self.own, type="blocks")
        self.goal.parent = self.own
        self.goal.save(update_fields=["parent"])

        for url in ("dependencies", "blockers", "subtree"):
            with self.subTest(url=url):
                response = self.client.get(f"/api/goals/{self.own.id}/{url}/")
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("their goal", response.content.decode())

    def test_parent_must_be_own(self):
        response = self.client.post(
            "/api/goals/",
            {"title": "planted", "type": "task", "parentId": str(self.goal.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)

        response = self.client.post(
            "/api/goals/",
            {"title": "child", "type": "task", "parentId": str(self.own.id)},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)


class GoalCycleTests(_Base):
    def setUp(self):
        super().setUp()
        self.root = Goal.objects.create(user_email=STUDENT, title="root", type="task")
        self.child = Goal.objects.create(user_email=STUDENT, title="child", type="task", parent=self.root)

    def test_a_goal_cannot_be_its_own_parent(self):
        response = self.client.patch(
            f"/api/goals/{self.root.id}/", {"parentId": str(self.root.id)}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.root.refresh_from_db()
        self.assertIsNone(self.root.parent_id)

    def test_a_goal_cannot_be_moved_under_its_own_descendant(self):
        response = self.client.patch(
            f"/api/goals/{self.root.id}/", {"parentId": str(self.child.id)}, format="json"
        )
        self.assertEqual(response.status_code, 400, response.content)

    def test_a_goal_can_still_be_moved_elsewhere(self):
        other = Goal.objects.create(user_email=STUDENT, title="other", type="task")
        response = self.client.patch(
            f"/api/goals/{self.child.id}/", {"parentId": str(other.id)}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_bulk_sync_refuses_a_cycle(self):
        for goals in (
            [{"id": str(self.root.id), "title": "r", "type": "task", "parentId": str(self.root.id)}],
            [
                {"id": str(self.root.id), "title": "r", "type": "task", "parentId": str(self.child.id)},
                {"id": str(self.child.id), "title": "c", "type": "task", "parentId": str(self.root.id)},
            ],
            [
                {"id": "new-a", "title": "a", "type": "task", "parentId": "new-b"},
                {"id": "new-b", "title": "b", "type": "task", "parentId": "new-a"},
            ],
        ):
            with self.subTest(goals=goals):
                response = self.client.post("/api/goals/bulk_sync/", {"goals": goals, "links": []}, format="json")
                self.assertEqual(response.status_code, 400, response.content)
        self.root.refresh_from_db()
        self.assertIsNone(self.root.parent_id)

    def test_bulk_sync_still_accepts_a_tree(self):
        response = self.client.post(
            "/api/goals/bulk_sync/",
            {
                "goals": [
                    {"id": str(self.root.id), "title": "r", "type": "task"},
                    {"id": str(self.child.id), "title": "c", "type": "task", "parentId": str(self.root.id)},
                    {"id": "new-a", "title": "a", "type": "task", "parentId": str(self.child.id)},
                ],
                "links": [],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_a_cycle_already_in_the_database_cannot_hang_or_break_the_api(self):
        Goal.objects.filter(pk=self.root.pk).update(parent=self.child)

        response = self.client.get(f"/api/goals/{self.root.id}/subtree/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()), 2)

        response = self.client.get("/api/goals/")
        self.assertEqual(response.status_code, 200, response.content)


class DiaryTests(_Base):
    def setUp(self):
        super().setUp()
        self.own = WeeklyTemplate.objects.create(id="own-template", user_email=STUDENT, name="own")
        self.week = DiaryWeek.objects.create(
            id="own-week", user_email=STUDENT, week_start="2026-11-02", week_end="2026-11-08", days=[]
        )

    def _put(self, **overrides):
        body = {"name": "x", "slots": [], "customPresets": [], "isActive": True, **overrides}
        return self.client.put(f"/api/diary/templates/{self.own.id}/", body, format="json")

    def test_put_cannot_move_a_template_into_another_account(self):
        response = self._put(userId=OTHER)
        self.assertEqual(response.status_code, 200, response.content)
        self.own.refresh_from_db()
        self.assertEqual(self.own.user_email, STUDENT)
        self.assertFalse(WeeklyTemplate.objects.filter(user_email=OTHER).exists())

    def test_put_cannot_plant_a_copy_under_a_new_id(self):
        self._put(id="planted", userId=OTHER)
        self.assertFalse(WeeklyTemplate.objects.filter(id="planted").exists())
        self.assertFalse(WeeklyTemplate.objects.filter(user_email=OTHER).exists())

    def test_put_still_updates_ones_own_template(self):
        response = self._put(name="renamed")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["userId"], STUDENT)
        self.own.refresh_from_db()
        self.assertEqual(self.own.name, "renamed")

    def test_patch_and_create_keep_working(self):
        response = self.client.patch(f"/api/diary/templates/{self.own.id}/", {"name": "patched"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        response = self.client.post(
            "/api/diary/templates/",
            {"id": "new-template", "name": "new", "slots": [], "userId": OTHER},
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(WeeklyTemplate.objects.get(id="new-template").user_email, STUDENT)

    def test_someone_elses_template_and_week_are_not_found(self):
        foreign = WeeklyTemplate.objects.create(id="foreign", user_email=OTHER, name="theirs")
        theirs = DiaryWeek.objects.create(
            id="foreign-week", user_email=OTHER, week_start="2026-11-02", week_end="2026-11-08", days=[]
        )
        for method, url in (
            ("get", f"/api/diary/templates/{foreign.id}/"),
            ("put", f"/api/diary/templates/{foreign.id}/"),
            ("patch", f"/api/diary/templates/{foreign.id}/"),
            ("delete", f"/api/diary/templates/{foreign.id}/"),
            ("get", f"/api/diary/weeks/{theirs.id}/"),
            ("put", f"/api/diary/weeks/{theirs.id}/"),
        ):
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, {"name": "x"}, format="json")
                self.assertEqual(response.status_code, 404)

    def test_week_owner_cannot_be_rewritten(self):
        self.client.put(f"/api/diary/weeks/{self.week.id}/", {"userId": OTHER, "days": []}, format="json")
        self.client.patch(f"/api/diary/weeks/{self.week.id}/", {"userId": OTHER}, format="json")
        self.week.refresh_from_db()
        self.assertEqual(self.week.user_email, STUDENT)


class MindTests(_Base):
    def setUp(self):
        super().setUp()
        self.subject = Subject.objects.create(user_email=OTHER, name="their subject", order_index=5)
        self.topic = Topic.objects.create(subject=self.subject, name="their topic", order_index=5)
        self.subtopic = Subtopic.objects.create(topic=self.topic, title="their subtopic")
        self.own_subject = Subject.objects.create(user_email=STUDENT, name="own subject", order_index=5)
        self.own_topic = Topic.objects.create(subject=self.own_subject, name="own topic", order_index=5)
        self.own_subtopic = Subtopic.objects.create(topic=self.own_topic, title="own subtopic")

    def test_lists_show_only_own_rows(self):
        for url, own, theirs in (
            ("/api/mind/subjects/", "own subject", "their subject"),
            ("/api/mind/topics/", "own topic", "their topic"),
            ("/api/mind/subtopics/", "own subtopic", "their subtopic"),
        ):
            with self.subTest(url=url):
                body = self.client.get(url).content.decode()
                self.assertIn(own, body)
                self.assertNotIn(theirs, body)

    def test_someone_elses_rows_are_not_found(self):
        for method, url, data in (
            ("patch", f"/api/mind/subjects/{self.subject.id}/", {"name": "edited"}),
            ("patch", f"/api/mind/topics/{self.topic.id}/", {"name": "edited"}),
            ("post", f"/api/mind/topics/{self.topic.id}/review/", {"rating": "GOOD"}),
            ("patch", f"/api/mind/subtopics/{self.subtopic.id}/", {"title": "edited"}),
            ("post", f"/api/mind/subtopics/{self.subtopic.id}/review/", {}),
            ("delete", f"/api/mind/subtopics/{self.subtopic.id}/", None),
        ):
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, data, format="json")
                self.assertEqual(response.status_code, 404)
        self.subtopic.refresh_from_db()
        self.assertEqual(self.subtopic.title, "their subtopic")

    def test_own_rows_keep_working(self):
        response = self.client.patch(
            f"/api/mind/subtopics/{self.own_subtopic.id}/", {"title": "edited"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        response = self.client.post(
            f"/api/mind/topics/{self.own_topic.id}/review/", {"rating": "GOOD"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_reorder_ignores_someone_elses_ids(self):
        self.client.post("/api/mind/subjects/reorder/", {"ids": [str(self.subject.id)]}, format="json")
        self.client.post("/api/mind/topics/reorder/", {"ids": [str(self.topic.id)]}, format="json")
        self.subject.refresh_from_db()
        self.topic.refresh_from_db()
        self.assertEqual((self.subject.order_index, self.topic.order_index), (5, 5))

    def test_reorder_moves_own_rows(self):
        self.client.post("/api/mind/subjects/reorder/", {"ids": [str(self.own_subject.id)]}, format="json")
        self.client.post("/api/mind/topics/reorder/", {"ids": [str(self.own_topic.id)]}, format="json")
        self.own_subject.refresh_from_db()
        self.own_topic.refresh_from_db()
        self.assertEqual((self.own_subject.order_index, self.own_topic.order_index), (0, 0))

    def test_cannot_add_rows_under_someone_elses_parent(self):
        session = {"task_name": "planted", "started_at": "2026-11-04T10:00:00Z"}
        for url, data, field in (
            ("/api/mind/topics/", {"subject": str(self.subject.id), "name": "planted"}, "subject"),
            ("/api/mind/topics/", {"subject_id": str(self.subject.id), "name": "planted"}, "subject_id"),
            ("/api/mind/subtopics/", {"topic": str(self.topic.id), "title": "planted"}, "topic"),
            ("/api/mind/sessions/", {"topic": str(self.topic.id), **session}, "topic"),
        ):
            with self.subTest(url=url, data=data):
                response = self.client.post(url, data, format="json")
                self.assertEqual(response.status_code, 400, response.content)
                self.assertEqual(list(response.json()), [field])

    def test_can_add_rows_under_own_parent(self):
        for url, data in (
            ("/api/mind/topics/", {"subject": str(self.own_subject.id), "name": "new"}),
            ("/api/mind/topics/", {"subject_id": str(self.own_subject.id), "name": "new"}),
            ("/api/mind/subtopics/", {"topic": str(self.own_topic.id), "title": "new"}),
            (
                "/api/mind/sessions/",
                {"topic": str(self.own_topic.id), "task_name": "new", "started_at": "2026-11-04T10:00:00Z"},
            ),
        ):
            with self.subTest(url=url, data=data):
                response = self.client.post(url, data, format="json")
                self.assertEqual(response.status_code, 201, response.content)

    def test_owner_cannot_be_rewritten(self):
        self.client.patch(f"/api/mind/subjects/{self.own_subject.id}/", {"user_email": OTHER}, format="json")
        self.own_subject.refresh_from_db()
        self.assertEqual(self.own_subject.user_email, STUDENT)

    def test_new_subject_belongs_to_the_caller_whatever_the_body_says(self):
        response = self.client.post("/api/mind/subjects/", {"name": "new", "user_email": OTHER}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Subject.objects.get(pk=response.json()["id"]).user_email, STUDENT)

    def test_rows_without_an_owner_are_kept_but_shown_to_nobody(self):
        ownerless = Subject.objects.create(user_email=None, name="ownerless subject")
        Topic.objects.create(subject=ownerless, name="ownerless topic")

        self.assertNotIn("ownerless", self.client.get("/api/mind/subjects/").content.decode())
        self.assertNotIn("ownerless", self.client.get("/api/mind/topics/").content.decode())
        self.assertTrue(Subject.objects.filter(pk=ownerless.pk).exists())

    def test_sessions_are_per_account(self):
        MindSession.objects.create(user_email=OTHER, started_at="2026-11-04T10:00:00Z")
        own = MindSession.objects.create(user_email=STUDENT, started_at="2026-11-04T10:00:00Z")
        rows = self.client.get("/api/mind/sessions/").json()
        self.assertEqual([row["id"] for row in rows], [str(own.id)])


class ProgramTests(_Base):
    def setUp(self):
        super().setUp()
        self.subject = Subject.objects.create(user_email=OTHER, name="their subject")
        self.topic = Topic.objects.create(subject=self.subject, name="their topic", status="NOT_STARTED")
        self.program = LearningProgram.objects.create(user_email=OTHER, name="their program")
        self.plan = TopicPlan.objects.create(
            program=self.program, topic=self.topic, planned_week=1, estimated_hours=1
        )
        self.own_subject = Subject.objects.create(user_email=STUDENT, name="own subject")
        self.own_topic = Topic.objects.create(subject=self.own_subject, name="own topic", status="NOT_STARTED")
        self.own_program = LearningProgram.objects.create(user_email=STUDENT, name="own program")
        self.own_plan = TopicPlan.objects.create(
            program=self.own_program, topic=self.own_topic, planned_week=1, estimated_hours=1
        )

    def test_lists_show_only_own_rows(self):
        body = self.client.get("/api/ai_engine/learning-program/").content.decode()
        self.assertIn("own program", body)
        self.assertNotIn("their program", body)

        body = self.client.get("/api/ai_engine/topic-plans/").content.decode()
        self.assertIn(str(self.own_plan.id), body)
        self.assertNotIn(str(self.plan.id), body)

    def test_someone_elses_rows_are_not_found(self):
        for method, url, data in (
            ("get", f"/api/ai_engine/learning-program/{self.program.id}/", None),
            ("delete", f"/api/ai_engine/learning-program/{self.program.id}/", None),
            ("patch", f"/api/ai_engine/topic-plans/{self.plan.id}/", {"planned_week": 9}),
            ("delete", f"/api/ai_engine/topic-plans/{self.plan.id}/", None),
        ):
            with self.subTest(method=method, url=url):
                response = getattr(self.client, method)(url, data, format="json")
                self.assertEqual(response.status_code, 404)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.planned_week, 1)

    def test_own_topic_plan_keeps_working(self):
        response = self.client.patch(
            f"/api/ai_engine/topic-plans/{self.own_plan.id}/", {"planned_week": 9}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_program_owner_comes_from_the_caller(self):
        response = self.client.post(
            "/api/ai_engine/learning-program/", {"name": "new", "user_email": OTHER}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(LearningProgram.objects.get(pk=response.json()["id"]).user_email, STUDENT)

    def test_daily_tasks_use_only_own_topics(self):
        body = self.client.get("/api/ai/daily-tasks/").content.decode()
        self.assertIn("own topic", body)
        self.assertNotIn("their topic", body)

    def test_schedule_uses_only_own_topics_and_day_plans(self):
        response = self.client.post(
            "/api/ai/schedule/",
            {"topics": [str(self.topic.id), str(self.own_topic.id)], "date": "2026-12-01"},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        body = response.content.decode()
        self.assertIn("own topic", body)
        self.assertNotIn("their topic", body)
        self.assertEqual(DayPlan.objects.get(date="2026-12-01").user_email, STUDENT)

    @patch("ai_engine.views.generate_fast_topics", return_value=[{"name": "generated"}])
    def test_fast_topics_only_under_own_subject(self, _generate):
        response = self.client.post(
            "/api/ai/fast-topics/", {"subjectId": str(self.subject.id), "text": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.assertFalse(Topic.objects.filter(subject=self.subject, name="generated").exists())

        response = self.client.post(
            "/api/ai/fast-topics/", {"subjectId": str(self.own_subject.id), "text": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    @patch("ai_engine.views.generate_learning_program_content")
    def test_generated_program_uses_only_own_subjects_and_has_an_owner(self, generate):
        # The model answers with names, so it could name someone else's topic.
        generate.return_value = {
            "programTitle": "new program",
            "totalWeeks": 1,
            "feasibility": "OK",
            "dayPlans": [
                {
                    "dayNumber": 1,
                    "date": "2026-12-01",
                    "sessions": [
                        {"type": "THEORY", "topicName": "their topic", "subjectName": "their subject"}
                    ],
                }
            ],
        }

        response = self.client.post(
            "/api/ai/generate-program/",
            {"name": "new program", "subjectIds": [str(self.subject.id), str(self.own_subject.id)]},
            format="json",
        )

        self.assertEqual(response.status_code, 201, response.content)
        subjects_sent = generate.call_args.kwargs["subjects"]
        self.assertEqual([s["id"] for s in subjects_sent], [str(self.own_subject.id)])

        program = LearningProgram.objects.get(name="new program")
        self.assertEqual(program.user_email, STUDENT)
        self.assertFalse(TopicPlan.objects.filter(program=program, topic=self.topic).exists())
        self.assertEqual(self.subject.topics.count(), 1)
        self.assertTrue(program.topic_plans.filter(topic__subject=self.own_subject).exists())

    def test_generating_with_no_own_subjects_finds_nothing_of_anyone_elses(self):
        Subject.objects.filter(user_email=STUDENT).delete()
        response = self.client.post("/api/ai/generate-program/", {"name": "new"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "No subjects found")


class AccountsTests(_Base):
    def setUp(self):
        super().setUp()
        self.student = CustomUser.objects.create_user(username="student", email=STUDENT, password="x")
        self.other = CustomUser.objects.create_user(
            username=OTHER, email=OTHER, password="x", first_name="", last_name=""
        )
        self.admin = CustomUser.objects.create_user(
            username="admin", email="admin@example.com", password="x", is_staff=True
        )
        self.task = Task.objects.create(author=self.other, title="their task", status="active")
        self.own_task = Task.objects.create(author=self.student, title="own task", status="active")

    def test_cannot_change_a_task_without_being_its_author_or_an_admin(self):
        response = self.client.patch(f"/api/tasks/{self.task.id}/", {"title": "defaced"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.delete(f"/api/tasks/{self.task.id}/").status_code, 403)
        self.task.refresh_from_db()
        self.assertEqual(self.task.title, "their task")

    def test_author_and_admin_can_change_a_task(self):
        response = self.client.patch(f"/api/tasks/{self.own_task.id}/", {"title": "edited"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

        self.client.credentials(**auth_headers(self.admin.email))
        response = self.client.patch(f"/api/tasks/{self.task.id}/", {"title": "fixed"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def test_search_never_returns_an_address(self):
        CustomUser.objects.create_user(username="findme", email="findme@example.com", password="x")
        response = self.client.get("/api/users/search/?q=findme")
        self.assertEqual([row["username"] for row in response.json()], ["findme"])
        self.assertNotIn("example.com", response.content.decode())

    def test_search_finds_nobody_by_part_of_an_address(self):
        response = self.client.get("/api/users/search/?q=example.com")
        self.assertEqual(response.json(), [])
        response = self.client.get(f"/api/users/search/?q={OTHER[:5]}")
        self.assertEqual(response.json(), [])

    def test_search_cannot_confirm_a_guessed_address(self):
        response = self.client.get(f"/api/users/search/?q={OTHER}")
        self.assertEqual(response.json(), [])

    def test_inviting_to_a_board_cannot_confirm_a_guessed_address(self):
        board = PrivateLeaderboard.objects.create(name="own board", owner=self.student)
        for identifier in (OTHER, self.admin.email):
            with self.subTest(identifier=identifier):
                response = self.client.post(
                    f"/api/private-leaderboards/{board.id}/add-member/",
                    {"identifier": identifier},
                    format="json",
                )
                self.assertEqual(response.status_code, 404)
        response = self.client.post(
            f"/api/private-leaderboards/{board.id}/add-member/", {"identifier": "admin"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_no_part_of_an_address_used_as_username_is_shown(self):
        rows = {row["id"]: row for row in self.client.get("/api/leaderboard/").json()}
        self.assertEqual(rows[self.other.id]["username"], f"Ученик {self.other.id}")
        self.assertEqual(rows[self.student.id]["username"], "student")

        response = self.client.get(f"/api/users/search/?q={self.other.id}")
        self.assertEqual(response.json()[0]["name"], f"Ученик {self.other.id}")

    def test_ones_own_name_is_not_masked(self):
        self.client.credentials(**auth_headers(OTHER))
        self.assertEqual(self.client.get("/api/me/").json()["name"], "other")

    def test_django_register_and_login_are_gone(self):
        for url in ("/api/auth/register/", "/api/auth/login/"):
            with self.subTest(url=url):
                response = self.client.post(
                    url, {"email": OTHER, "password": "x", "password2": "x", "name": "planted"}, format="json"
                )
                self.assertEqual(response.status_code, 404)

    def test_only_the_owner_can_change_a_private_board(self):
        board = PrivateLeaderboard.objects.create(name="their board", owner=self.other)
        board.members.add(self.other, self.student)

        response = self.client.patch(
            f"/api/private-leaderboards/{board.id}/", {"name": "defaced"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.delete(f"/api/private-leaderboards/{board.id}/").status_code, 403)
        board.refresh_from_db()
        self.assertEqual(board.name, "their board")

        self.client.credentials(**auth_headers(OTHER))
        response = self.client.patch(
            f"/api/private-leaderboards/{board.id}/", {"name": "renamed"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)


class OwnershipHelperTests(TestCase):
    def test_request_without_identity(self):
        self.assertIsNone(request_email(None))
        self.assertIsNone(request_email(object()))

    def test_relation_is_empty_without_identity(self):
        from planner.serializers import BlockSerializer

        self.assertIsInstance(BlockSerializer(), OwnedRelationsMixin)
        self.assertFalse(BlockSerializer().fields["day_plan"].get_queryset().exists())

"""Контест глазами ученика: что видно до начала, во время и после конца."""

import json
from datetime import timedelta

from django.test import Client, TestCase
from django.utils import timezone

from config.testing import auth_headers

from .models import Contest, ContestFile, CustomUser, Task, TaskSubmission

PDF = b"%PDF-1.7 test"


class ContestBase(TestCase):
    def setUp(self):
        self.client = Client()
        self.now = timezone.now()
        self.owner = CustomUser.objects.create_user(
            username="owner@example.com", email="owner@example.com", password="x", is_staff=True,
        )
        self.student = CustomUser.objects.create_user(
            username="student@example.com", email="student@example.com", password="x",
        )
        self.other = CustomUser.objects.create_user(
            username="other@example.com", email="other@example.com", password="x",
        )

    def pdf(self, text=""):
        return ContestFile.objects.create(data=PDF, name="z.pdf", size=len(PDF), sha256="0" * 64, text=text)

    def contest(self, state="running", published=True, tasks=None, **fields):
        if state == "running":
            start, end = self.now - timedelta(hours=1), self.now + timedelta(hours=2)
        elif state == "upcoming":
            start, end = self.now + timedelta(days=1), self.now + timedelta(days=1, hours=3)
        else:
            start, end = self.now - timedelta(days=2), self.now - timedelta(days=2) + timedelta(hours=3)
        contest = Contest.objects.create(
            title=fields.pop("title", "Кубок"), start_time=start, end_time=end,
            is_published=published, tier=fields.pop("tier", 2), art=fields.pop("art", "waves"), **fields,
        )
        made = []
        for position, spec in enumerate(tasks if tasks is not None else [{}]):
            made.append(Task.objects.create(
                author=self.owner, status="active", position=position,
                title=spec.get("title", ""),
                condition_text=spec.get("condition_text", ""),
                answer=spec.get("answer", "4242"),
                points=spec.get("points", 100),
                statement_file=spec.get("statement", self.pdf("Найди угол")),
                solution_file=spec.get("solution"),
            ))
        contest.tasks.set(made)
        self.tasks = made
        return contest

    def get(self, path, who=None):
        return self.client.get(path, **auth_headers((who or self.student).email))


class ContestVisibilityTests(ContestBase):
    def test_drafts_are_hidden(self):
        draft = self.contest(published=False)
        self.assertEqual(self.get("/api/contests/").json(), [])
        self.assertEqual(self.get(f"/api/contests/{draft.id}/").status_code, 404)

    def test_list_shows_the_plaque_fields(self):
        contest = self.contest(tasks=[{"points": 150}, {"points": 250}])
        [row] = self.get("/api/contests/").json()
        self.assertEqual(row["id"], contest.id)
        self.assertEqual((row["tier"], row["art"], row["state"]), (2, "waves", "running"))
        self.assertEqual((row["task_count"], row["points_total"]), (2, 400))
        self.assertEqual(row["tasks"], [task.id for task in self.tasks])

    def test_before_start_nothing_about_tasks(self):
        contest = self.contest(state="upcoming", tasks=[{"condition_text": "секретное условие"}])
        response = self.get(f"/api/contests/{contest.id}/")
        self.assertEqual(response.json()["task_details"], [])
        self.assertNotIn("секретное", response.content.decode())
        self.assertNotIn("4242", response.content.decode())

        download = self.get(f"/api/contests/{contest.id}/tasks/{self.tasks[0].id}/statement/")
        self.assertEqual(download.status_code, 404)
        self.assertEqual(download.json()["code"], "not_started")

    def test_running_shows_tasks_without_answers(self):
        contest = self.contest()
        response = self.get(f"/api/contests/{contest.id}/")
        [task] = response.json()["task_details"]
        self.assertEqual(set(task), {"id", "number", "title", "points", "has_statement", "condition_text"})
        self.assertEqual((task["number"], task["points"], task["has_statement"]), (1, 100, True))
        self.assertNotIn("4242", response.content.decode())
        self.assertNotIn("4242", self.get("/api/contests/").content.decode())

    def test_statement_downloads_while_running(self):
        contest = self.contest()
        response = self.get(f"/api/contests/{contest.id}/tasks/{self.tasks[0].id}/statement/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Disposition"], 'attachment; filename="zadacha-1.pdf"')
        self.assertEqual(response.content, PDF)

    def test_solution_waits_for_the_end(self):
        contest = self.contest(tasks=[{"solution": self.pdf()}])
        response = self.get(f"/api/contests/{contest.id}/tasks/{self.tasks[0].id}/solution/")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "not_ended")

    def test_after_end_answers_and_solutions_open(self):
        contest = self.contest(state="ended", tasks=[{"answer": " 60 ; 60° ", "solution": self.pdf()}])
        [task] = self.get(f"/api/contests/{contest.id}/").json()["task_details"]
        self.assertEqual(task["answer"], "60")
        self.assertTrue(task["has_solution"])
        self.assertEqual(task["review_text"], "Найди угол")

        response = self.get(f"/api/contests/{contest.id}/tasks/{self.tasks[0].id}/solution/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Disposition"], 'attachment; filename="reshenie-1.pdf"')

    def test_a_task_from_another_contest_is_not_found(self):
        contest = self.contest()
        stranger = Task.objects.create(author=self.owner, status="active", statement_file=self.pdf())
        response = self.get(f"/api/contests/{contest.id}/tasks/{stranger.id}/statement/")
        self.assertEqual(response.status_code, 404)

    def test_admin_downloads_any_time(self):
        contest = self.contest(state="upcoming", tasks=[{"solution": self.pdf()}], published=False)
        for kind in ("statement", "solution"):
            response = self.get(f"/api/contests/{contest.id}/tasks/{self.tasks[0].id}/{kind}/", who=self.owner)
            self.assertEqual(response.status_code, 200, kind)

    def test_legacy_task_text_shows_after_start(self):
        contest = self.contest(tasks=[{"statement": None, "condition_text": "Старое условие", "title": "Сумма цифр"}])
        [task] = self.get(f"/api/contests/{contest.id}/").json()["task_details"]
        self.assertEqual((task["title"], task["condition_text"], task["has_statement"]), ("Сумма цифр", "Старое условие", False))

    def test_pdf_tasks_carry_no_text_while_running(self):
        contest = self.contest(tasks=[{"condition_text": "текст при PDF"}])
        [task] = self.get(f"/api/contests/{contest.id}/").json()["task_details"]
        self.assertEqual(task["condition_text"], "")

    def test_mine_counts_own_attempts_only(self):
        contest = self.contest(tasks=[{}, {}])
        first, second = self.tasks
        TaskSubmission.objects.create(student=self.student, task=first, contest=contest, status="rejected", file_url_or_code="1")
        TaskSubmission.objects.create(student=self.student, task=first, contest=contest, status="approved", file_url_or_code="4242")
        TaskSubmission.objects.create(student=self.other, task=second, contest=contest, status="rejected", file_url_or_code="7")

        body = self.get(f"/api/contests/{contest.id}/").json()
        self.assertEqual(body["mine"], [{"task": first.id, "attempts": 2, "solved": True, "last_answer": "4242"}])
        self.assertNotIn("mine", self.get("/api/contests/").json()[0])


class OldPathsTests(ContestBase):
    def test_students_cannot_use_task_and_submission_writes(self):
        contest = self.contest()
        task = self.tasks[0]
        own = TaskSubmission.objects.create(student=self.student, task=task, contest=contest, status="rejected")
        TaskSubmission.objects.create(student=self.other, task=task, contest=contest, status="rejected")
        headers = auth_headers(self.student.email)

        self.assertEqual(self.client.get("/api/tasks/", **headers).status_code, 403)
        self.assertEqual(self.client.post("/api/tasks/", data=json.dumps({"title": "x"}), content_type="application/json", **headers).status_code, 403)
        created = self.client.post(
            "/api/submissions/", data=json.dumps({"task": task.id, "file_url_or_code": "4242"}),
            content_type="application/json", **headers,
        )
        self.assertEqual(created.status_code, 403)
        edited = self.client.patch(
            f"/api/submissions/{own.id}/", data=json.dumps({"file_url_or_code": "x"}),
            content_type="application/json", **headers,
        )
        self.assertEqual(edited.status_code, 403)
        listed = self.client.get("/api/submissions/", **headers).json()
        self.assertEqual([row["id"] for row in listed], [own.id])

    def test_admin_still_manages_tasks(self):
        self.assertEqual(self.get("/api/tasks/", who=self.owner).status_code, 200)

    def test_a_contest_task_changes_only_in_the_contest_editor(self):
        # Иначе баллы, ответ и файлы меняются мимо тиров, потолка и запрета правок после старта.
        self.contest()
        task = self.tasks[0]
        headers = auth_headers(self.owner.email)
        before = (task.points, task.answer)

        patched = self.client.patch(
            f"/api/tasks/{task.id}/", data=json.dumps({"points": 5000, "answer": "1"}),
            content_type="application/json", **headers,
        )
        deleted = self.client.delete(f"/api/tasks/{task.id}/", **headers)

        self.assertEqual((patched.status_code, deleted.status_code), (403, 403))
        task.refresh_from_db()
        self.assertEqual((task.points, task.answer), before)

    def test_a_task_outside_contests_is_still_editable(self):
        loose = Task.objects.create(author=self.owner, title="Черновик", status="active")
        response = self.client.patch(
            f"/api/tasks/{loose.id}/", data=json.dumps({"points": 70}),
            content_type="application/json", **auth_headers(self.owner.email),
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_moderator_does_not_judge_top_tier_attempts(self):
        moderator = CustomUser.objects.create_user(
            username="mod@example.com", email="mod@example.com", password="x", is_moderator=True,
        )
        top = self.contest(tier=1)
        attempt = TaskSubmission.objects.create(student=self.student, task=self.tasks[0], contest=top, status="rejected")
        lower = self.contest(tier=4)
        low_attempt = TaskSubmission.objects.create(student=self.other, task=self.tasks[0], contest=lower, status="rejected")
        headers = auth_headers(moderator.email)

        refused = self.client.post(f"/api/submissions/{attempt.id}/approve/", **headers)
        allowed = self.client.post(f"/api/submissions/{low_attempt.id}/approve/", **headers)

        self.assertEqual(refused.status_code, 403)
        self.assertEqual(allowed.status_code, 200, allowed.content)
        attempt.refresh_from_db()
        self.assertEqual(attempt.status, "rejected")

    def test_contests_list_refuses_writes(self):
        response = self.client.post(
            "/api/contests/", data=json.dumps({"title": "x"}), content_type="application/json",
            **auth_headers(self.owner.email),
        )
        self.assertEqual(response.status_code, 405)


class AnswerTests(ContestBase):
    def answer(self, contest, task, text, who=None):
        return self.client.post(
            f"/api/contests/{contest.id}/answer/",
            data=json.dumps({"task": task.id, "answer": text}),
            content_type="application/json",
            **auth_headers((who or self.student).email),
        )

    def rating(self, who=None):
        return CustomUser.objects.get(pk=(who or self.student).pk).overall_elo

    def age_attempts(self, seconds):
        # От текущего момента, а не от setUp: под нагрузкой между ними проходят секунды.
        TaskSubmission.objects.update(created_at=timezone.now() - timedelta(seconds=seconds))

    def test_correct_answer_adds_points_once(self):
        contest = self.contest(tasks=[{"answer": "3/4", "points": 150}])
        before = self.rating()

        response = self.answer(contest, self.tasks[0], "0,75")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"correct": True, "points": 150, "attempt": 1, "solved": True})
        self.assertEqual(self.rating(), before + 150)
        row = TaskSubmission.objects.get()
        self.assertEqual((row.status, row.contest_id, row.file_url_or_code), ("approved", contest.id, "0,75"))

        self.age_attempts(10)
        again = self.answer(contest, self.tasks[0], "0.75")
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()["code"], "already_solved")
        self.assertEqual(self.rating(), before + 150)

    def test_wrong_answer_is_recorded_and_can_be_retried(self):
        contest = self.contest()
        wrong = self.answer(contest, self.tasks[0], "1")
        self.assertEqual(wrong.json(), {"correct": False, "points": 0, "attempt": 1, "solved": False})
        self.assertEqual(TaskSubmission.objects.get().status, "rejected")

        self.age_attempts(3)
        right = self.answer(contest, self.tasks[0], "4242")
        self.assertEqual(right.json(), {"correct": True, "points": 100, "attempt": 2, "solved": True})

    def test_too_fast_and_too_many(self):
        contest = self.contest(tasks=[{}, {}])
        self.answer(contest, self.tasks[0], "1")
        self.age_attempts(1)
        fast = self.answer(contest, self.tasks[1], "1")
        self.assertEqual(fast.status_code, 429)
        self.assertEqual(fast.json()["code"], "too_fast")
        self.assertEqual(fast.json()["error"], "Подожди пару секунд.")
        self.assertEqual(fast.json()["retry_after"], 2)

        TaskSubmission.objects.bulk_create([
            TaskSubmission(student=self.student, task=self.tasks[0], contest=contest, status="rejected")
            for _ in range(29)
        ])
        self.age_attempts(60)
        many = self.answer(contest, self.tasks[0], "4242")
        self.assertEqual(many.status_code, 429)
        self.assertEqual(many.json()["code"], "too_many")

    def test_only_while_running(self):
        for state in ("upcoming", "ended"):
            contest = self.contest(state=state)
            response = self.answer(contest, self.tasks[0], "4242")
            self.assertEqual(response.status_code, 409, state)
            self.assertEqual(response.json()["code"], "not_running")
        self.assertFalse(TaskSubmission.objects.exists())

    def test_drafts_take_no_answers(self):
        contest = self.contest(published=False)
        self.assertEqual(self.answer(contest, self.tasks[0], "4242").status_code, 404)

    def test_admins_do_not_answer(self):
        contest = self.contest()
        response = self.answer(contest, self.tasks[0], "4242", who=self.owner)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["code"], "admin")

    def test_task_from_another_contest(self):
        contest = self.contest()
        other = self.contest()
        response = self.answer(contest, self.tasks[0], "4242")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "bad_task")
        self.assertEqual(other.tasks.count(), 1)

    def test_empty_and_too_long(self):
        contest = self.contest()
        self.assertEqual(self.answer(contest, self.tasks[0], "   ").json()["code"], "empty")
        self.assertEqual(self.answer(contest, self.tasks[0], "1" * 101).json()["code"], "too_long")

    def test_a_task_without_an_answer_records_nothing(self):
        contest = self.contest(tasks=[{"answer": " ; "}])
        response = self.answer(contest, self.tasks[0], "1")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "no_answer")
        self.assertFalse(TaskSubmission.objects.exists())

    def test_answer_works_from_the_first_request(self):
        contest = self.contest()
        response = self.answer(contest, self.tasks[0], "4242", who=CustomUser(email="new@example.com"))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(CustomUser.objects.filter(email="new@example.com").exists())

    def test_race_on_the_unique_index_awards_nothing(self):
        from unittest import mock

        from django.db import IntegrityError

        contest = self.contest()
        before = self.rating()
        with mock.patch.object(TaskSubmission.objects, "create", side_effect=IntegrityError("twin")):
            response = self.answer(contest, self.tasks[0], "4242")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "already_solved")
        self.assertEqual(self.rating(), before)

    def test_manual_approval_does_not_double_count(self):
        contest = self.contest()
        task = self.tasks[0]
        TaskSubmission.objects.create(student=self.student, task=task, contest=contest, status="approved")
        wrong = TaskSubmission.objects.create(student=self.student, task=task, contest=contest, status="rejected")
        before = self.rating()

        response = self.client.post(f"/api/submissions/{wrong.id}/approve/", **auth_headers(self.owner.email))

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "already_counted")
        self.assertEqual(response.json()["error"], "Уже засчитано.")
        self.assertEqual(self.rating(), before)
        self.assertEqual(TaskSubmission.objects.get(pk=wrong.pk).status, "rejected")

    def test_manual_approval_of_a_wrong_attempt_awards_points(self):
        contest = self.contest(tasks=[{"points": 70}])
        wrong = TaskSubmission.objects.create(student=self.student, task=self.tasks[0], contest=contest, status="rejected")
        before = self.rating()

        response = self.client.post(f"/api/submissions/{wrong.id}/approve/", **auth_headers(self.owner.email))

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.rating(), before + 70)


class StandingsTests(ContestBase):
    def setUp(self):
        super().setUp()
        self.student.username = "aruzhan"
        self.student.show_in_leaderboard = True
        self.student.save()
        self.timur = CustomUser.objects.create_user(
            username="timur", email="timur@example.com", password="x", show_in_leaderboard=True,
        )
        self.hidden = CustomUser.objects.create_user(
            username="hidden_kid", email="hidden@example.com", password="x", first_name="Скрытый",
        )
        self.dana = CustomUser.objects.create_user(
            username="dana", email="dana@example.com", password="x", show_in_leaderboard=True,
        )
        self.cup = self.contest(tasks=[{"points": 100}, {"points": 50}])
        self.first, self.second = self.tasks

    def attempt(self, who, task, minutes, correct, answer="ответ-ученика"):
        row = TaskSubmission.objects.create(
            student=who, task=task, contest=self.cup, file_url_or_code=answer,
            status="approved" if correct else "rejected",
        )
        TaskSubmission.objects.filter(pk=row.pk).update(created_at=self.cup.start_time + timedelta(minutes=minutes))
        return row

    def table(self, who=None):
        return self.get(f"/api/contests/{self.cup.id}/standings/", who=who)

    def test_table_orders_by_points_then_penalty(self):
        self.attempt(self.student, self.first, 15, False)
        self.attempt(self.student, self.first, 20, True)
        for minute in (2, 4, 6):
            self.attempt(self.timur, self.first, minute, False)
        self.attempt(self.timur, self.first, 10, True)
        self.attempt(self.hidden, self.second, 5, True)
        self.attempt(self.dana, self.first, 30, False)

        rows = self.table().json()

        self.assertEqual([row["name"] for row in rows], ["aruzhan", "timur", "Участник", "dana"])
        self.assertEqual([row["place"] for row in rows], [1, 1, 3, 4])
        self.assertEqual([row["points"] for row in rows], [100, 100, 50, 0])
        self.assertEqual([row["penalty"] for row in rows], [25, 25, 5, 0])
        self.assertEqual([row["me"] for row in rows], [True, False, False, False])
        self.assertEqual(rows[2]["marks"], ["none", "solved"])
        self.assertEqual(rows[3]["marks"], ["tried", "none"])
        self.assertEqual(set(rows[0]), {"place", "name", "me", "points", "solved", "penalty", "marks"})

    def test_hidden_student_is_a_participant(self):
        self.attempt(self.hidden, self.second, 5, True)
        response = self.table()
        self.assertEqual(response.json()[0]["name"], "Участник")
        body = response.content.decode()
        for secret in ("hidden_kid", "hidden@example.com", "Скрытый"):
            self.assertNotIn(secret, body)

    def test_hidden_student_sees_their_own_name(self):
        self.attempt(self.hidden, self.second, 5, True)
        [row] = self.table(who=self.hidden).json()
        self.assertEqual((row["name"], row["me"]), ("hidden_kid", True))

    def test_feed_never_contains_answers(self):
        self.attempt(self.timur, self.first, 3, False, answer="секретный-ответ")
        self.attempt(self.hidden, self.first, 7, True, answer="4242")

        response = self.get(f"/api/contests/{self.cup.id}/attempts/")

        body = response.content.decode()
        self.assertNotIn("секретный-ответ", body)
        self.assertNotIn("4242", body)
        self.assertNotIn("hidden_kid", body)
        rows = response.json()
        self.assertEqual(set(rows[0]), {"id", "at", "name", "me", "task", "correct"})
        self.assertEqual([(row["name"], row["at"], row["task"], row["correct"]) for row in rows],
                         [("Участник", 420, 1, True), ("timur", 180, 1, False)])

    def test_feed_mine_filter(self):
        own = self.attempt(self.student, self.second, 9, False)
        self.attempt(self.timur, self.first, 3, False)
        rows = self.get(f"/api/contests/{self.cup.id}/attempts/?mine=1").json()
        self.assertEqual([(row["id"], row["me"], row["task"]) for row in rows], [(own.id, True, 2)])

    def test_nothing_before_start(self):
        later = self.contest(state="upcoming")
        self.assertEqual(self.get(f"/api/contests/{later.id}/standings/").json(), [])
        self.assertEqual(self.get(f"/api/contests/{later.id}/attempts/").json(), [])

    def test_drafts_have_no_table(self):
        draft = self.contest(published=False)
        self.assertEqual(self.get(f"/api/contests/{draft.id}/standings/").status_code, 404)


class SubmissionListTests(ContestBase):
    def test_admin_sees_which_contest_an_attempt_came_from(self):
        contest = self.contest(title="Осенний кубок")
        TaskSubmission.objects.create(student=self.student, task=self.tasks[0], contest=contest, status="rejected")
        [row] = self.get("/api/submissions/", who=self.owner).json()
        self.assertEqual((row["contest"], row["contest_title"]), (contest.id, "Осенний кубок"))

    def test_an_attempt_outside_a_contest_has_no_title(self):
        self.contest()
        TaskSubmission.objects.create(student=self.student, task=self.tasks[0], status="approved")
        [row] = self.get("/api/submissions/", who=self.owner).json()
        self.assertEqual((row["contest"], row["contest_title"]), (None, ""))

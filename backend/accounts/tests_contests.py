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

    def test_contests_list_refuses_writes(self):
        response = self.client.post(
            "/api/contests/", data=json.dumps({"title": "x"}), content_type="application/json",
            **auth_headers(self.owner.email),
        )
        self.assertEqual(response.status_code, 405)

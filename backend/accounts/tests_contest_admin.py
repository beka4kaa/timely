"""Админка контестов: PDF задач и сами контесты."""

import io

import pypdfium2 as pdfium
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from config.testing import auth_headers

from .contest_rules import MAX_PDF_BYTES
from .models import ContestFile, CustomUser


def make_pdf(pages: int = 1) -> bytes:
    pdf = pdfium.PdfDocument.new()
    for _ in range(pages):
        pdf.new_page(200, 200)
    buffer = io.BytesIO()
    pdf.save(buffer)
    pdf.close()
    return buffer.getvalue()


class AdminBase(TestCase):
    def setUp(self):
        self.client = Client()
        self.owner = CustomUser.objects.create_user(
            username="owner@example.com", email="owner@example.com", password="x", is_staff=True,
        )
        self.moderator = CustomUser.objects.create_user(
            username="mod@example.com", email="mod@example.com", password="x", is_moderator=True,
        )
        self.student = CustomUser.objects.create_user(
            username="student@example.com", email="student@example.com", password="x",
        )

    def upload(self, data: bytes, name: str = "zadacha.pdf", who=None):
        who = who or self.owner
        return self.client.post(
            "/api/admin/contest-files/",
            {"file": SimpleUploadedFile(name, data, content_type="application/pdf")},
            **auth_headers(who.email),
        )


class ContestFileTests(AdminBase):
    def test_admin_uploads_a_pdf(self):
        data = make_pdf(2)
        response = self.upload(data, name="../../Задача 1.pdf")

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(set(body), {"id", "name", "size", "pages"})
        self.assertEqual(body["pages"], 2)
        self.assertEqual(body["size"], len(data))
        self.assertEqual(body["name"], "Задача 1.pdf")
        row = ContestFile.objects.get(pk=body["id"])
        self.assertEqual(len(row.sha256), 64)
        self.assertEqual(row.uploaded_by, self.owner)
        self.assertEqual(bytes(row.data), data)

    def test_moderator_uploads_too(self):
        self.assertEqual(self.upload(make_pdf(), who=self.moderator).status_code, 201)

    def test_student_cannot_upload_or_download(self):
        self.assertEqual(self.upload(make_pdf(), who=self.student).status_code, 403)
        stored = self.upload(make_pdf()).json()
        response = self.client.get(f"/api/admin/contest-files/{stored['id']}/", **auth_headers(self.student.email))
        self.assertEqual(response.status_code, 403)

    def test_not_a_pdf_is_refused(self):
        response = self.upload(b"hello", name="a.pdf")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "not_pdf")
        self.assertEqual(response.json()["error"], "Это не PDF.")

    def test_a_broken_pdf_is_refused(self):
        response = self.upload(b"%PDF-1.4 garbage")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "broken")

    def test_too_big_is_refused(self):
        response = self.upload(b"%PDF-" + b"0" * (MAX_PDF_BYTES - 4))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "too_big")
        self.assertEqual(response.json()["error"], "PDF больше 10 МБ.")

    def test_no_file_is_refused(self):
        response = self.client.post("/api/admin/contest-files/", {}, **auth_headers(self.owner.email))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "no_file")

    def test_download_headers(self):
        data = make_pdf()
        stored = self.upload(data).json()

        response = self.client.get(f"/api/admin/contest-files/{stored['id']}/", **auth_headers(self.owner.email))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertEqual(response["Content-Disposition"], f'attachment; filename="fajl-{stored["id"]}.pdf"')
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(response["X-Content-Type-Options"], "nosniff")
        self.assertEqual(response.content, data)


import json
from datetime import timedelta

from django.utils import timezone

from .models import Contest, Task, TaskSubmission


class AdminContestTests(AdminBase):
    def setUp(self):
        super().setUp()
        self.now = timezone.now()

    def pdf(self, text=""):
        return ContestFile.objects.create(data=b"%PDF-1.7", name="z.pdf", size=8, sha256="0" * 64, text=text)

    def payload(self, **overrides):
        start = overrides.pop("start", self.now + timedelta(days=1))
        end = overrides.pop("end", start + timedelta(hours=3))
        data = {
            "title": "Осенний кубок",
            "description": "Пять задач",
            "start_time": start.isoformat(),
            "end_time": end.isoformat(),
            "tier": 2,
            "art": "waves",
            "tasks": [
                {"answer": "60", "points": 150, "statement_file": self.pdf().pk, "solution_file": None},
                {"answer": "3/4; 0,75", "points": 100, "statement_file": self.pdf().pk, "solution_file": None},
            ],
        }
        data.update(overrides)
        return data

    def send(self, method, path, data=None, who=None):
        call = getattr(self.client, method)
        kwargs = {"content_type": "application/json"} if data is not None else {}
        body = json.dumps(data) if data is not None else None
        args = (path, body) if body is not None else (path,)
        return call(*args, **kwargs, **auth_headers((who or self.owner).email))

    def create(self, who=None, **overrides):
        return self.send("post", "/api/admin/contests/", self.payload(**overrides), who=who)

    def publish(self, contest_id, who=None):
        return self.send("post", f"/api/admin/contests/{contest_id}/publish/", who=who)

    def started(self, **overrides):
        """Опубликованный контест, который начался час назад."""
        created = self.create(start=self.now - timedelta(hours=1), **overrides).json()
        self.assertEqual(self.publish(created["id"]).status_code, 200)
        return created

    def test_students_cannot_use_admin_contests(self):
        self.assertEqual(self.send("get", "/api/admin/contests/", who=self.student).status_code, 403)
        self.assertEqual(self.create(who=self.student).status_code, 403)

    def test_admin_creates_a_draft_with_tasks(self):
        response = self.create()

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertFalse(body["is_published"])
        self.assertEqual((body["tier"], body["art"], body["tier_cap"], body["points_total"]), (2, "waves", 400, 250))
        self.assertEqual([task["number"] for task in body["tasks"]], [1, 2])
        self.assertEqual(body["tasks"][1]["answer"], "3/4; 0,75")
        self.assertEqual(set(body["tasks"][0]["statement"]), {"id", "name", "size", "pages"})
        contest = Contest.objects.get(pk=body["id"])
        tasks = sorted(contest.tasks.all(), key=lambda task: task.position)
        self.assertEqual([(task.position, task.status, task.author) for task in tasks], [(0, "active", self.owner), (1, "active", self.owner)])
        self.assertEqual(self.send("get", "/api/contests/", who=self.student).json(), [])

    def test_drafts_save_without_files_and_answers(self):
        response = self.create(tasks=[{"answer": "", "points": 10, "statement_file": None, "solution_file": None}])
        self.assertEqual(response.status_code, 201, response.content)

    def test_publish_checks_the_rules(self):
        draft = self.create(tier=5, tasks=[
            {"answer": "", "points": 40, "statement_file": None, "solution_file": None},
            {"answer": "1", "points": 20, "statement_file": self.pdf().pk, "solution_file": None},
        ]).json()

        refused = self.publish(draft["id"])
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json()["code"], "not_ready")
        self.assertEqual([problem["code"] for problem in refused.json()["problems"]], ["no_statement", "no_answer", "over_cap"])

        fixed = self.send("patch", f"/api/admin/contests/{draft['id']}/", self.payload(tier=5, tasks=[
            {"id": draft["tasks"][0]["id"], "answer": "2", "points": 30, "statement_file": self.pdf().pk, "solution_file": None},
            {"id": draft["tasks"][1]["id"], "answer": "1", "points": 20, "statement_file": self.pdf().pk, "solution_file": None},
        ]))
        self.assertEqual(fixed.status_code, 200, fixed.content)
        published = self.publish(draft["id"])
        self.assertEqual(published.status_code, 200, published.content)
        self.assertTrue(published.json()["is_published"])
        self.assertEqual(len(self.send("get", "/api/contests/", who=self.student).json()), 1)

    def test_invalid_input_lists_problems(self):
        response = self.create(art="x", tier=9, start_time="завтра", tasks=[
            {"answer": "1", "points": 0, "statement_file": 999999, "solution_file": None},
        ])
        self.assertEqual(response.status_code, 400)
        codes = [problem["code"] for problem in response.json()["problems"]]
        self.assertEqual(codes, ["dates", "tier", "art", "bad_points", "bad_file"])

    def test_moderator_and_top_tiers(self):
        refused = self.create(who=self.moderator, tier=1)
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.json()["code"], "tier_forbidden")

        owners = self.create(tier=2).json()
        patch = self.send("patch", f"/api/admin/contests/{owners['id']}/", self.payload(tier=3), who=self.moderator)
        self.assertEqual(patch.status_code, 403)
        self.assertEqual(self.send("delete", f"/api/admin/contests/{owners['id']}/", who=self.moderator).status_code, 403)
        self.assertEqual(self.publish(owners["id"], who=self.moderator).status_code, 403)

        own = self.create(who=self.moderator, tier=3, tasks=[
            {"answer": "1", "points": 100, "statement_file": self.pdf().pk, "solution_file": None},
        ])
        self.assertEqual(own.status_code, 201, own.content)

    def test_published_upcoming_stays_valid(self):
        draft = self.create().json()
        self.assertEqual(self.publish(draft["id"]).status_code, 200)

        greedy = self.payload(tasks=[
            {"id": draft["tasks"][0]["id"], "answer": "60", "points": 350, "statement_file": self.pdf().pk, "solution_file": None},
            {"id": draft["tasks"][1]["id"], "answer": "1", "points": 100, "statement_file": self.pdf().pk, "solution_file": None},
        ])
        response = self.send("patch", f"/api/admin/contests/{draft['id']}/", greedy)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "not_ready")
        self.assertEqual(Task.objects.get(pk=draft["tasks"][0]["id"]).points, 150)

    def test_locked_after_start(self):
        contest = self.started()
        tasks = contest["tasks"]
        same = [
            {"id": task["id"], "answer": task["answer"], "points": task["points"],
             "statement_file": task["statement"]["id"], "solution_file": None}
            for task in tasks
        ]
        start = self.now - timedelta(hours=1)
        base = dict(start=start, end=start + timedelta(hours=3))

        changed_answer = [dict(same[0], answer="61"), same[1]]
        changed_points = [dict(same[0], points=10), same[1]]
        changed_statement = [dict(same[0], statement_file=self.pdf().pk), same[1]]
        for name, data in [
            ("answer", self.payload(**base, tasks=changed_answer)),
            ("points", self.payload(**base, tasks=changed_points)),
            ("statement", self.payload(**base, tasks=changed_statement)),
            ("tier", self.payload(**base, tier=3, tasks=same)),
            ("start", self.payload(start=start - timedelta(minutes=5), end=base["end"], tasks=same)),
            ("removed", self.payload(**base, tasks=same[:1])),
        ]:
            with self.subTest(name):
                response = self.send("patch", f"/api/admin/contests/{contest['id']}/", data)
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(response.json()["code"], "locked")

        solution = self.pdf()
        allowed = self.payload(
            start=start, end=start + timedelta(hours=5), title="Новое имя", description="Новое", art="spiral",
            tasks=[dict(same[0], solution_file=solution.pk), same[1]],
        )
        response = self.send("patch", f"/api/admin/contests/{contest['id']}/", allowed)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual((body["title"], body["art"]), ("Новое имя", "spiral"))
        self.assertEqual(body["tasks"][0]["solution"]["id"], solution.pk)
        self.assertTrue(body["locked"])

    def test_end_cannot_move_after_it_passed(self):
        contest = self.started()
        Contest.objects.filter(pk=contest["id"]).update(
            start_time=self.now - timedelta(days=1), end_time=self.now - timedelta(hours=20),
        )
        fresh = self.send("get", f"/api/admin/contests/{contest['id']}/").json()
        same = [
            {"id": task["id"], "answer": task["answer"], "points": task["points"],
             "statement_file": task["statement"]["id"], "solution_file": None}
            for task in fresh["tasks"]
        ]
        start = Contest.objects.get(pk=contest["id"]).start_time
        response = self.send("patch", f"/api/admin/contests/{contest['id']}/", self.payload(
            start=start, end=self.now + timedelta(hours=2), tasks=same,
        ))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "locked")

    def test_replacing_tasks_keeps_legacy_text_and_cleans_files(self):
        old_file = self.pdf()
        legacy = Task.objects.create(author=self.owner, title="Сумма цифр", condition_text="Старое условие", status="active")
        contest = Contest.objects.create(
            title="Старый", start_time=self.now + timedelta(days=1), end_time=self.now + timedelta(days=1, hours=3),
        )
        contest.tasks.set([legacy])
        second = Task.objects.create(author=self.owner, status="active", statement_file=old_file, position=1)
        contest.tasks.add(second)

        new_file = self.pdf()
        response = self.send("patch", f"/api/admin/contests/{contest.pk}/", self.payload(tasks=[
            {"id": legacy.pk, "answer": "15", "points": 50, "statement_file": new_file.pk, "solution_file": None},
        ]))

        self.assertEqual(response.status_code, 200, response.content)
        legacy.refresh_from_db()
        self.assertEqual((legacy.title, legacy.condition_text, legacy.answer), ("Сумма цифр", "Старое условие", "15"))
        self.assertFalse(Task.objects.filter(pk=second.pk).exists())
        self.assertFalse(ContestFile.objects.filter(pk=old_file.pk).exists())
        self.assertTrue(ContestFile.objects.filter(pk=new_file.pk).exists())

    def test_a_task_of_another_contest_cannot_be_taken(self):
        other = self.create().json()
        mine = self.create().json()
        stolen = self.payload(tasks=[
            {"id": other["tasks"][0]["id"], "answer": "1", "points": 10, "statement_file": None, "solution_file": None},
        ])
        response = self.send("patch", f"/api/admin/contests/{mine['id']}/", stolen)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["problems"][0]["code"], "bad_task")

    def test_unpublish_only_before_start(self):
        upcoming = self.create().json()
        self.publish(upcoming["id"])
        response = self.send("post", f"/api/admin/contests/{upcoming['id']}/unpublish/")
        self.assertEqual((response.status_code, response.json()["is_published"]), (200, False))

        running = self.started()
        refused = self.send("post", f"/api/admin/contests/{running['id']}/unpublish/")
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.json()["code"], "started")

    def test_delete_rules(self):
        draft = self.create().json()
        file_id = draft["tasks"][0]["statement"]["id"]
        self.assertEqual(self.send("delete", f"/api/admin/contests/{draft['id']}/").status_code, 204)
        self.assertFalse(Contest.objects.filter(pk=draft["id"]).exists())
        self.assertFalse(Task.objects.filter(pk=draft["tasks"][0]["id"]).exists())
        self.assertFalse(ContestFile.objects.filter(pk=file_id).exists())

        running = self.started()
        TaskSubmission.objects.create(
            student=self.student, task_id=running["tasks"][0]["id"], contest_id=running["id"], status="rejected",
        )
        refused = self.send("delete", f"/api/admin/contests/{running['id']}/")
        self.assertEqual(refused.status_code, 409)
        self.assertEqual(refused.json()["code"], "has_answers")

    def test_list_counts_participants(self):
        running = self.started()
        for who in (self.student, self.student, self.moderator):
            TaskSubmission.objects.create(
                student=who, task_id=running["tasks"][0]["id"], contest_id=running["id"], status="rejected",
            )
        self.create()
        rows = self.send("get", "/api/admin/contests/").json()
        counted = next(row for row in rows if row["id"] == running["id"])
        self.assertEqual((counted["participants"], counted["attempts"], counted["can_delete"]), (2, 3, False))
        self.assertEqual(len(rows), 2)

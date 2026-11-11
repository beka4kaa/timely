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

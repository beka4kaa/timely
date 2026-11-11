"""Книги выключены флагом BOOKS_ENABLED: загрузка и обработка отвечают 404."""

from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from curriculum.models import CoursePlan, Document, IngestionJob
from curriculum.planning.providers import (
    FakeCoursePlanningProvider,
    FakeCourseReviewProvider,
)
from curriculum.tests.pdf_fixtures import textbook_pdf
from curriculum.tests.test_api import OWNER, _ApiBase, _auth


@override_settings(BOOKS_ENABLED=False)
class BooksOffTests(_ApiBase):
    def _assert_off(self, response):
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "books_disabled")

    def test_upload_is_refused_and_creates_nothing(self):
        response = self.client.post(
            "/api/curriculum/documents/upload/",
            {
                "file": SimpleUploadedFile(
                    "book.pdf", textbook_pdf(), content_type="application/pdf"
                )
            },
            **_auth(OWNER),
        )
        self._assert_off(response)
        self.assertEqual(Document.objects.count(), 0)

    def test_plain_create_is_refused_and_creates_nothing(self):
        response = self.client.post(
            "/api/curriculum/documents/", {"title": "Книга"}, **_auth(OWNER)
        )
        self._assert_off(response)
        self.assertEqual(Document.objects.count(), 0)

    def test_ingest_is_refused_and_starts_no_job(self):
        document = self._make_document(OWNER, ingest=False)
        response = self.client.post(
            f"/api/curriculum/documents/{document.pk}/ingest/", **_auth(OWNER)
        )
        self._assert_off(response)
        self.assertEqual(IngestionJob.objects.count(), 0)

    def test_generate_plan_from_book_is_refused(self):
        goal = self._make_goal()
        document = self._make_document(OWNER)
        response = self.client.post(
            "/api/curriculum/plans/generate/",
            {"goal_id": str(goal.pk), "document_id": str(document.pk)},
            **_auth(OWNER),
        )
        self._assert_off(response)
        self.assertEqual(CoursePlan.objects.count(), 0)

    def test_rebuild_plan_from_book_is_refused(self):
        goal = self._make_goal()
        document = self._make_document(OWNER)
        with override_settings(BOOKS_ENABLED=True), mock.patch(
            "curriculum.services.plans.get_planning_provider",
            return_value=FakeCoursePlanningProvider(),
        ), mock.patch(
            "curriculum.services.plans.get_review_provider",
            return_value=FakeCourseReviewProvider(),
        ):
            created = self.client.post(
                "/api/curriculum/plans/generate/",
                {"goal_id": str(goal.pk), "document_id": str(document.pk)},
                **_auth(OWNER),
            )
        plan_id = created.json()["plan"]["id"]
        response = self.client.post(
            f"/api/curriculum/plans/{plan_id}/rebuild/", **_auth(OWNER)
        )
        self._assert_off(response)
        self.assertEqual(CoursePlan.objects.count(), 1)

    def test_listing_documents_still_works(self):
        self._make_document(OWNER, ingest=False)
        response = self.client.get("/api/curriculum/documents/", **_auth(OWNER))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 1)

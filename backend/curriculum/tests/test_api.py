"""HTTP-слой: изоляция пользователей и запрет на выдачу решений."""

import tempfile
from datetime import timedelta
from unittest import mock

from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from curriculum import storage as storage_module
from curriculum.models import (
    CoursePlan,
    Document,
    DocumentFile,
    ExtractedSolution,
    IngestionJob,
    KnowledgeChunk,
    LearningGoal,
)
from curriculum.ocr import NullOcrProvider
from curriculum.planning.providers import (
    FakeCoursePlanningProvider,
    FakeCourseReviewProvider,
)
from curriculum.services import goals as goals_service
from curriculum.services.ingestion import ingest_document
from curriculum.tests.pdf_fixtures import textbook_pdf
from curriculum.tests.test_upload import minimal_pdf

OWNER = "owner@example.com"
INTRUDER = "intruder@example.com"

# Секретный текст решения из фикстуры: он не должен встретиться ни в одном
# ответе API.
SOLUTION_MARKERS = ("s = v0 t", "F = m a")


def _auth(email: str) -> dict:
    """Заголовок, который проставляет `config.middleware`."""
    return {"HTTP_X_USER_EMAIL": email}


class _ApiBase(TestCase):
    def setUp(self):
        storage_module.set_storage(
            storage_module.LocalFileStorage(tempfile.mkdtemp())
        )

    def _make_goal(self, email: str = OWNER) -> LearningGoal:
        goal = goals_service.create_goal(
            user_email=email, original_text="механика кинематика с нуля"
        )
        goals_service.normalize_goal(
            goal, provider=goals_service.FakeGoalNormalizationProvider()
        )
        goals_service.confirm_goal(goal)
        return goal

    def _make_document(self, email: str = OWNER, ingest: bool = True) -> Document:
        pdf = textbook_pdf()
        document = Document.objects.create(user_email=email, title="Механика")
        key = storage_module.build_storage_key(
            user_email=email, document_id=str(document.pk), filename="book.pdf"
        )
        storage_module.get_storage().save(key, pdf)
        DocumentFile.objects.create(
            document=document,
            original_filename="book.pdf",
            sanitized_filename="book.pdf",
            storage_key=key,
            mime_type="application/pdf",
            byte_size=len(pdf),
            content_hash=storage_module.content_hash(pdf),
        )
        if ingest:
            ingest_document(document, ocr_provider=NullOcrProvider())
            document.refresh_from_db()
        return document


class AuthenticationTests(_ApiBase):
    def test_goal_list_without_header_is_empty(self):
        self._make_goal()
        response = self.client.get("/api/curriculum/goals/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_goal_create_without_header_rejected(self):
        response = self.client.post(
            "/api/curriculum/goals/", {"original_text": "физика"}
        )
        self.assertEqual(response.status_code, 401)

    def test_document_list_without_header_is_empty(self):
        self._make_document(ingest=False)
        response = self.client.get("/api/curriculum/documents/")
        self.assertEqual(response.json(), [])

    def test_plan_list_without_header_is_empty(self):
        response = self.client.get("/api/curriculum/plans/")
        self.assertEqual(response.json(), [])


class UserIsolationTests(_ApiBase):
    def test_intruder_cannot_list_foreign_goal(self):
        self._make_goal(OWNER)
        response = self.client.get("/api/curriculum/goals/", **_auth(INTRUDER))
        self.assertEqual(response.json(), [])

    def test_intruder_cannot_read_foreign_goal(self):
        goal = self._make_goal(OWNER)
        response = self.client.get(
            f"/api/curriculum/goals/{goal.pk}/", **_auth(INTRUDER)
        )
        self.assertEqual(response.status_code, 404)

    def test_intruder_cannot_read_foreign_document(self):
        document = self._make_document(OWNER, ingest=False)
        response = self.client.get(
            f"/api/curriculum/documents/{document.pk}/", **_auth(INTRUDER)
        )
        self.assertEqual(response.status_code, 404)

    def test_intruder_cannot_ingest_foreign_document(self):
        document = self._make_document(OWNER, ingest=False)
        response = self.client.post(
            f"/api/curriculum/documents/{document.pk}/ingest/", **_auth(INTRUDER)
        )
        self.assertEqual(response.status_code, 404)

    def test_intruder_cannot_confirm_foreign_goal(self):
        goal = self._make_goal(OWNER)
        response = self.client.post(
            f"/api/curriculum/goals/{goal.pk}/confirm/",
            {"normalized_subject": "Взлом"},
            **_auth(INTRUDER),
        )
        self.assertEqual(response.status_code, 404)

    def test_owner_sees_own_goal(self):
        goal = self._make_goal(OWNER)
        response = self.client.get(
            f"/api/curriculum/goals/{goal.pk}/", **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["id"], str(goal.pk))


class GoalEndpointTests(_ApiBase):
    def test_create_goal(self):
        response = self.client.post(
            "/api/curriculum/goals/",
            {"original_text": "механика с нуля"},
            **_auth(OWNER),
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["status"], LearningGoal.Status.DRAFT)

    def test_normalize_endpoint_keeps_original_text(self):
        goal = goals_service.create_goal(
            user_email=OWNER, original_text="механика кинематика"
        )
        with mock.patch.object(
            goals_service,
            "get_normalization_provider",
            return_value=goals_service.FakeGoalNormalizationProvider(),
        ):
            response = self.client.post(
                f"/api/curriculum/goals/{goal.pk}/normalize/", **_auth(OWNER)
            )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["original_text"], "механика кинематика")
        self.assertFalse(body["normalization_confirmed"])

    def test_confirm_endpoint(self):
        goal = goals_service.create_goal(user_email=OWNER, original_text="физика")
        response = self.client.post(
            f"/api/curriculum/goals/{goal.pk}/confirm/",
            {"normalized_subject": "Физика", "normalized_direction": "Механика"},
            **_auth(OWNER),
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body["normalization_confirmed"])
        self.assertEqual(body["status"], LearningGoal.Status.CONFIRMED)

    def test_confirm_without_subject_is_400(self):
        goal = goals_service.create_goal(user_email=OWNER, original_text="физика")
        response = self.client.post(
            f"/api/curriculum/goals/{goal.pk}/confirm/", {}, **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 400)

    def test_patch_cannot_forge_normalization_fields(self):
        """Поля нормализации read-only: подделать «модель подтвердила» нельзя."""
        goal = self._make_goal(OWNER)
        response = self.client.patch(
            f"/api/curriculum/goals/{goal.pk}/",
            {"normalized_subject": "Подделка", "normalization_confirmed": False},
            content_type="application/json",
            **_auth(OWNER),
        )
        self.assertEqual(response.status_code, 200)
        goal.refresh_from_db()
        self.assertNotEqual(goal.normalized_subject, "Подделка")


class UploadEndpointTests(_ApiBase):
    def _upload(
        self,
        content: bytes,
        name: str = "book.pdf",
        email: str = OWNER,
        content_type: str | None = None,
    ):
        from django.core.files.uploadedfile import SimpleUploadedFile

        declared_type = content_type or (
            "application/epub+zip"
            if name.lower().endswith(".epub")
            else "application/pdf"
        )
        return self.client.post(
            "/api/curriculum/documents/upload/",
            {
                "file": SimpleUploadedFile(
                    name, content, content_type=declared_type
                )
            },
            **_auth(email),
        )

    def test_accepts_valid_pdf(self):
        response = self._upload(textbook_pdf())
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(
            body["document"]["ingestion_status"], Document.Status.UPLOADED
        )
        self.assertEqual(body["document"]["file"]["mime_type"], "application/pdf")

    def test_accepts_valid_epub(self):
        from curriculum.tests.test_epub import SIMPLE

        response = self._upload(SIMPLE, name="Механика.epub")

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(
            body["document"]["ingestion_status"], Document.Status.UPLOADED
        )
        self.assertEqual(
            body["document"]["file"]["mime_type"], "application/epub+zip"
        )
        self.assertEqual(body["document"]["page_count"], 0)

    def test_rejects_non_pdf(self):
        response = self._upload(b"just some text, definitely not a pdf", "notes.txt")
        self.assertEqual(response.status_code, 400)
        self.assertIn("code", response.json())

    def test_rejects_empty_file(self):
        response = self._upload(b"")
        self.assertEqual(response.status_code, 400)

    def test_upload_requires_user(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        response = self.client.post(
            "/api/curriculum/documents/upload/",
            {
                "file": SimpleUploadedFile(
                    "book.pdf", textbook_pdf(), content_type="application/pdf"
                )
            },
        )
        self.assertEqual(response.status_code, 401)

    def test_storage_key_not_exposed(self):
        """`storage_key` — внутренний адрес и наружу не отдаётся."""
        response = self._upload(textbook_pdf())
        self.assertNotIn("storage_key", response.json()["document"]["file"])

    def test_warnings_surface_to_client(self):
        response = self._upload(minimal_pdf(2))
        self.assertEqual(response.status_code, 201)
        self.assertIn("antivirus_not_configured", response.json()["warnings"])

    def test_upload_then_ingest_flow(self):
        """Контракт асинхронный: 202 на постановку, результат — опросом.

        Исполнитель сейчас синхронный, поэтому к моменту опроса документ уже
        готов; когда обработка уедет в Celery, поменяется только это.
        """
        upload = self._upload(textbook_pdf())
        document_id = upload.json()["document"]["id"]
        response = self.client.post(
            f"/api/curriculum/documents/{document_id}/ingest/", **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 202)
        self.assertIn("poll_url", response.json())

        state = self.client.get(
            f"/api/curriculum/documents/{document_id}/status/", **_auth(OWNER)
        )
        self.assertEqual(state.status_code, 200)
        body = state.json()
        self.assertEqual(body["ingestion_status"], Document.Status.READY)
        self.assertTrue(body["is_terminal"])
        self.assertEqual(body["progress"], 1.0)
        self.assertGreater(body["stats"]["chunks"], 0)

    def test_failed_ingestion_surfaces_in_status_not_500(self):
        """Провал обработки — не ошибка ПОСТАНОВКИ.

        Раньше endpoint отвечал 422 сразу, потому что успевал всё обработать
        внутри запроса. Теперь постановка всегда успешна, а причина провала
        приезжает первым же опросом статуса.
        """
        document = Document.objects.create(user_email=OWNER, title="Без файла")
        response = self.client.post(
            f"/api/curriculum/documents/{document.pk}/ingest/", **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 202)

        state = self.client.get(
            f"/api/curriculum/documents/{document.pk}/status/", **_auth(OWNER)
        ).json()
        self.assertEqual(state["ingestion_status"], Document.Status.FAILED)
        self.assertTrue(state["is_terminal"])
        self.assertEqual(state["job"]["error_code"], "no_file")

    def test_status_reports_progress_and_attempts(self):
        upload = self._upload(textbook_pdf())
        document_id = upload.json()["document"]["id"]
        self.client.post(
            f"/api/curriculum/documents/{document_id}/ingest/", **_auth(OWNER)
        )
        body = self.client.get(
            f"/api/curriculum/documents/{document_id}/status/", **_auth(OWNER)
        ).json()

        self.assertEqual(body["document_id"], document_id)
        self.assertEqual(body["step_index"], body["step_total"])
        self.assertEqual(body["phase_total"], 4)
        self.assertTrue(body["step_label"])
        self.assertGreater(len(body["attempts"]), 0)
        self.assertTrue(all(a["succeeded"] for a in body["attempts"]))

    @override_settings(CURRICULUM_INGEST_STALE_AFTER_SECONDS=60)
    def test_stale_status_is_terminal_consistent_and_read_only(self):
        document = Document.objects.create(
            user_email=OWNER,
            title="Зависший учебник",
            ingestion_status=Document.Status.RECONSTRUCTING,
        )
        job = IngestionJob.objects.create(
            document=document,
            user_email=OWNER,
            status=Document.Status.RECONSTRUCTING,
            started_at=timezone.now() - timedelta(hours=2),
        )
        IngestionJob.objects.filter(pk=job.pk).update(
            updated_at=timezone.now() - timedelta(hours=2)
        )

        url = f"/api/curriculum/documents/{document.pk}/status/"
        first = self.client.get(url, **_auth(OWNER)).json()
        second = self.client.get(url, **_auth(OWNER)).json()

        for body in (first, second):
            self.assertTrue(body["stalled"])
            self.assertTrue(body["is_terminal"])
            self.assertEqual(body["ingestion_status"], Document.Status.FAILED)
            self.assertEqual(body["job"]["status"], Document.Status.FAILED)
            self.assertEqual(body["job"]["error_code"], "stalled")
            self.assertNotIn("памят", body["job"]["error_message"].lower())

        # GET не перезаписывает состояние: воркер мог ожить между чтением и
        # ответом. Повторный POST сам проверит stale и поставит job заново.
        job.refresh_from_db()
        document.refresh_from_db()
        self.assertEqual(job.status, Document.Status.RECONSTRUCTING)
        self.assertEqual(document.ingestion_status, Document.Status.RECONSTRUCTING)

    @override_settings(CURRICULUM_INGEST_STALE_AFTER_SECONDS=60)
    def test_fresh_queued_status_remains_nonterminal(self):
        document = Document.objects.create(
            user_email=OWNER,
            title="Учебник в очереди",
            ingestion_status=Document.Status.QUEUED,
        )
        IngestionJob.objects.create(
            document=document,
            user_email=OWNER,
            status=Document.Status.QUEUED,
        )

        body = self.client.get(
            f"/api/curriculum/documents/{document.pk}/status/", **_auth(OWNER)
        ).json()

        self.assertFalse(body["stalled"])
        self.assertFalse(body["is_terminal"])
        self.assertEqual(body["ingestion_status"], Document.Status.QUEUED)
        self.assertEqual(body["job"]["status"], Document.Status.QUEUED)
        self.assertEqual(body["step_index"], 1)

    def test_heartbeat_between_stale_checks_keeps_status_nonterminal(self):
        document = Document.objects.create(
            user_email=OWNER,
            title="Оживший воркер",
            ingestion_status=Document.Status.OCR,
        )
        IngestionJob.objects.create(
            document=document,
            user_email=OWNER,
            status=Document.Status.OCR,
        )

        with mock.patch(
            "curriculum.views.dispatch.is_stale",
            side_effect=(True, False),
        ):
            body = self.client.get(
                f"/api/curriculum/documents/{document.pk}/status/",
                **_auth(OWNER),
            ).json()

        self.assertFalse(body["stalled"])
        self.assertFalse(body["is_terminal"])
        self.assertEqual(body["ingestion_status"], Document.Status.OCR)
        self.assertEqual(body["job"]["status"], Document.Status.OCR)

    def test_status_requires_ownership(self):
        upload = self._upload(textbook_pdf())
        document_id = upload.json()["document"]["id"]
        response = self.client.get(
            f"/api/curriculum/documents/{document_id}/status/", **_auth(INTRUDER)
        )
        self.assertEqual(response.status_code, 404)

    def test_ingest_accepts_json_content_type(self):
        """Страховка на будущее, а не регрессия.

        Фронтенд (`src/lib/auth-fetch.ts`) ставит `Content-Type: application/json`
        на КАЖДЫЙ запрос, включая POST без тела. Сегодня `ingest` это переживает даже
        с multipart-парсерами: он не читает `request.data`, а парсеры DRF ленивые.
        Тест зафиксирует момент, когда в action появится доступ к `request.data` —
        тогда без JSON-парсера он немедленно начнёт отвечать 415.
        """
        upload = self._upload(textbook_pdf())
        document_id = upload.json()["document"]["id"]
        response = self.client.post(
            f"/api/curriculum/documents/{document_id}/ingest/",
            data="",
            content_type="application/json",
            **_auth(OWNER),
        )
        self.assertNotEqual(response.status_code, 415)
        self.assertEqual(response.status_code, 202)

    def test_document_patch_accepts_json(self):
        """Регрессия: с `parser_classes` на классе это отвечало 415 (проверено)."""
        upload = self._upload(textbook_pdf())
        document_id = upload.json()["document"]["id"]
        response = self.client.patch(
            f"/api/curriculum/documents/{document_id}/",
            data={"title": "Новое название"},
            content_type="application/json",
            **_auth(OWNER),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["title"], "Новое название")


class SolutionLeakageTests(_ApiBase):
    """Самая важная группа: решения не должны утечь ни одним endpoint'ом."""

    def setUp(self):
        super().setUp()
        self.document = self._make_document(OWNER)
        # Убедимся, что решения в БД вообще есть — иначе тест проходит впустую.
        self.assertGreater(
            ExtractedSolution.objects.filter(document=self.document).count(), 0
        )

    def _assert_clean(self, payload: str, where: str):
        for marker in SOLUTION_MARKERS:
            self.assertNotIn(marker, payload, f"решение утекло в {where}")

    def test_tasks_endpoint_returns_statements_without_solutions(self):
        response = self.client.get(
            f"/api/curriculum/documents/{self.document.pk}/tasks/", **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.json()), 0)
        self._assert_clean(response.content.decode(), "documents/tasks")

    def test_chunks_endpoint_excludes_restricted(self):
        response = self.client.get(
            f"/api/curriculum/documents/{self.document.pk}/chunks/", **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 200)
        types = {row["chunk_type"] for row in response.json()}
        self.assertNotIn("solution", types)
        self._assert_clean(response.content.decode(), "documents/chunks")

    def test_document_detail_has_no_solution(self):
        response = self.client.get(
            f"/api/curriculum/documents/{self.document.pk}/", **_auth(OWNER)
        )
        self._assert_clean(response.content.decode(), "documents/detail")

    def test_sections_endpoint_has_no_solution(self):
        response = self.client.get(
            f"/api/curriculum/documents/{self.document.pk}/sections/", **_auth(OWNER)
        )
        self._assert_clean(response.content.decode(), "documents/sections")

    def test_generated_plan_response_has_no_solution(self):
        goal = self._make_goal(OWNER)
        with mock.patch(
            "curriculum.services.plans.get_planning_provider",
            return_value=FakeCoursePlanningProvider(),
        ), mock.patch(
            "curriculum.services.plans.get_review_provider",
            return_value=FakeCourseReviewProvider(),
        ):
            response = self.client.post(
                "/api/curriculum/plans/generate/",
                {"goal_id": str(goal.pk), "document_id": str(self.document.pk)},
                **_auth(OWNER),
            )
        self.assertEqual(response.status_code, 201, response.content)
        self._assert_clean(response.content.decode(), "plans/generate")

    def test_restricted_chunks_exist_but_are_filtered(self):
        """Проверяем, что фильтр реально работает, а не что данных нет."""
        restricted = KnowledgeChunk.objects.filter(
            document_id=self.document.pk,
            solution_visibility=KnowledgeChunk.SolutionVisibility.RESTRICTED,
        )
        self.assertGreater(restricted.count(), 0)
        response = self.client.get(
            f"/api/curriculum/documents/{self.document.pk}/chunks/", **_auth(OWNER)
        )
        returned = {row["id"] for row in response.json()}
        for chunk in restricted:
            self.assertNotIn(str(chunk.pk), returned)


class PlanEndpointTests(_ApiBase):
    def setUp(self):
        super().setUp()
        self.goal = self._make_goal(OWNER)
        self.document = self._make_document(OWNER)

    def _generate(self, email: str = OWNER):
        with mock.patch(
            "curriculum.services.plans.get_planning_provider",
            return_value=FakeCoursePlanningProvider(),
        ), mock.patch(
            "curriculum.services.plans.get_review_provider",
            return_value=FakeCourseReviewProvider(),
        ):
            return self.client.post(
                "/api/curriculum/plans/generate/",
                {"goal_id": str(self.goal.pk), "document_id": str(self.document.pk)},
                **_auth(email),
            )

    def test_generate_creates_plan(self):
        response = self._generate()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(
            body["plan"]["status"], CoursePlan.Status.AWAITING_APPROVAL
        )
        self.assertGreater(len(body["plan"]["modules"]), 0)

    def test_generate_reports_provenance_and_coverage(self):
        body = self._generate().json()
        self.assertEqual(body["planner_model"], "fake-planner")
        self.assertIsNotNone(body["coverage_ratio"])
        self.assertEqual(
            body["coverage_ratio"], body["provenance_coverage"]["ratio"]
        )
        self.assertEqual(
            body["plan"]["coverage_ratio"], body["coverage_ratio"]
        )
        topic = body["plan"]["modules"][0]["topics"][0]
        self.assertIn("sources", topic)
        self.assertIn("prerequisites", topic)

    def test_provenance_coverage_survives_cold_plan_get(self):
        generated = self._generate().json()
        response = self.client.get(
            f"/api/curriculum/plans/{generated['plan']['id']}/", **_auth(OWNER)
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["provenance_coverage"],
            generated["provenance_coverage"],
        )

    def test_generate_rejects_foreign_goal(self):
        response = self._generate(email=INTRUDER)
        self.assertEqual(response.status_code, 404)

    def test_generate_on_unprocessed_document_is_422(self):
        raw = self._make_document(OWNER, ingest=False)
        with mock.patch(
            "curriculum.services.plans.get_planning_provider",
            return_value=FakeCoursePlanningProvider(),
        ):
            response = self.client.post(
                "/api/curriculum/plans/generate/",
                {"goal_id": str(self.goal.pk), "document_id": str(raw.pk)},
                **_auth(OWNER),
            )
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.json()["code"], "plan_rejected")

    def test_direct_plan_creation_blocked(self):
        """План нельзя собрать POST'ом в обход валидатора."""
        response = self.client.post(
            "/api/curriculum/plans/", {"title": "Самодельный"}, **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 405)

    def test_approve_activates_and_enrolls(self):
        plan_id = self._generate().json()["plan"]["id"]
        response = self.client.post(
            f"/api/curriculum/plans/{plan_id}/approve/", **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["plan"]["status"], CoursePlan.Status.ACTIVE)
        self.assertEqual(body["enrollment"]["version_number"], 1)

    def test_intruder_cannot_approve(self):
        plan_id = self._generate().json()["plan"]["id"]
        response = self.client.post(
            f"/api/curriculum/plans/{plan_id}/approve/", **_auth(INTRUDER)
        )
        self.assertEqual(response.status_code, 404)

    def test_versions_endpoint(self):
        plan_id = self._generate().json()["plan"]["id"]
        response = self.client.get(
            f"/api/curriculum/plans/{plan_id}/versions/", **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()[0]["version"], 1)

    def test_study_order_endpoint(self):
        plan_id = self._generate().json()["plan"]["id"]
        response = self.client.get(
            f"/api/curriculum/plans/{plan_id}/study_order/", **_auth(OWNER)
        )
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.json()["external_ids"]), 0)

    def test_enrollments_scoped_to_user(self):
        plan_id = self._generate().json()["plan"]["id"]
        self.client.post(f"/api/curriculum/plans/{plan_id}/approve/", **_auth(OWNER))
        self.assertEqual(
            len(self.client.get(
                "/api/curriculum/enrollments/", **_auth(OWNER)
            ).json()),
            1,
        )
        self.assertEqual(
            self.client.get(
                "/api/curriculum/enrollments/", **_auth(INTRUDER)
            ).json(),
            [],
        )


class RouteRegistrationTests(TestCase):
    def test_curriculum_routes_registered(self):
        for name in (
            "curriculum-goals-list",
            "curriculum-documents-list",
            "curriculum-plans-list",
            "curriculum-enrollments-list",
        ):
            self.assertTrue(reverse(name).startswith("/api/curriculum/"))

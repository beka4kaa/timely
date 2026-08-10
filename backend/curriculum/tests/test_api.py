"""HTTP-слой: изоляция пользователей и запрет на выдачу решений."""

import tempfile
from datetime import timedelta
from unittest import mock

from django.db import models
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from curriculum import storage as storage_module
from curriculum.models import (
    CourseEnrollment,
    CourseDependency,
    CoursePlan,
    CourseTopic,
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
        goal_id: str | None = None,
    ):
        from django.core.files.uploadedfile import SimpleUploadedFile

        declared_type = content_type or (
            "application/epub+zip"
            if name.lower().endswith(".epub")
            else "application/pdf"
        )
        payload: dict = {
            "file": SimpleUploadedFile(name, content, content_type=declared_type)
        }
        if goal_id is not None:
            payload["goal_id"] = goal_id
        return self.client.post(
            "/api/curriculum/documents/upload/",
            payload,
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


class CatalogTests(_ApiBase):
    """Каталог предметов: книга знает свой предмет.

    До этого документ соединялся с целью только через уже построенный план,
    поэтому книга в обработке в карточке предмета показаться не могла — ровно в
    тот момент, когда ученику и нужно видеть, что происходит.
    """

    def _upload(self, goal_id=None, email: str = OWNER):
        from django.core.files.uploadedfile import SimpleUploadedFile

        payload: dict = {
            "file": SimpleUploadedFile(
                "book.pdf", textbook_pdf(), content_type="application/pdf"
            )
        }
        if goal_id is not None:
            payload["goal_id"] = str(goal_id)
        return self.client.post(
            "/api/curriculum/documents/upload/", payload, **_auth(email)
        )

    def test_upload_attaches_book_to_subject(self):
        goal = self._make_goal()
        response = self._upload(goal_id=goal.pk)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["document"]["goal"], str(goal.pk))

    def test_upload_without_subject_still_works(self):
        # Загрузка вне каталога остаётся рабочей: предмет необязателен.
        response = self._upload()
        self.assertEqual(response.status_code, 201)
        self.assertIsNone(response.json()["document"]["goal"])

    def test_cannot_attach_book_to_someone_elses_subject(self):
        """Проверяется владелец, а не факт существования цели.

        Иначе чужой предмет можно было бы «занять» своей книгой и увидеть его в
        своём каталоге.
        """
        stranger_goal = self._make_goal(email=INTRUDER)
        response = self._upload(goal_id=stranger_goal.pk, email=OWNER)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["code"], "goal_not_found")
        self.assertEqual(Document.objects.filter(user_email=OWNER).count(), 0)

    def test_subject_cannot_be_reassigned_through_patch(self):
        """`goal` только для чтения.

        Обычный `PATCH` брал бы queryset из всех целей подряд, и книгу можно
        было бы привязать к чужому предмету в обход проверки при загрузке.
        """
        goal = self._make_goal()
        stranger_goal = self._make_goal(email=INTRUDER)
        document = Document.objects.get(pk=self._upload(goal_id=goal.pk).json()["document"]["id"])

        response = self.client.patch(
            f"/api/curriculum/documents/{document.pk}/",
            {"goal": str(stranger_goal.pk)},
            content_type="application/json",
            **_auth(OWNER),
        )

        self.assertEqual(response.status_code, 200)
        document.refresh_from_db()
        self.assertEqual(document.goal_id, goal.pk)

    def test_books_can_be_filtered_by_subject(self):
        first = self._make_goal()
        second = goals_service.create_goal(
            user_email=OWNER, original_text="алгебра производные"
        )
        self._upload(goal_id=first.pk)
        self._upload(goal_id=second.pk)

        response = self.client.get(
            f"/api/curriculum/documents/?goal={first.pk}", **_auth(OWNER)
        )

        self.assertEqual(response.status_code, 200)
        body = response.json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertEqual([row["goal"] for row in rows], [str(first.pk)])

    def test_deleting_a_subject_takes_its_books(self):
        # Предмет — единица, которой управляет ученик: удаляя его, он
        # рассчитывает, что книги и планы уйдут вместе с ним.
        goal = self._make_goal()
        self._upload(goal_id=goal.pk)
        self.assertEqual(Document.objects.filter(goal=goal).count(), 1)

        response = self.client.delete(
            f"/api/curriculum/goals/{goal.pk}/", **_auth(OWNER)
        )

        self.assertEqual(response.status_code, 204)
        self.assertEqual(Document.objects.count(), 0)

    def test_deleting_a_subject_with_active_studies(self):
        """Регрессия: кнопка «Удалить предмет» отвечала 500.

        `CourseEnrollment.version` — FK с `PROTECT`, и каскад от цели упирался
        в него: ученик, подтвердивший программу, больше не мог удалить свой
        собственный предмет. Воспроизведено на боевых данных.
        """
        goal = self._make_goal()
        document = self._make_document(OWNER)
        document.goal = goal
        document.save(update_fields=["goal"])
        with mock.patch(
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
        self.client.post(f"/api/curriculum/plans/{plan_id}/approve/", **_auth(OWNER))
        self.assertEqual(CourseEnrollment.objects.count(), 1)

        response = self.client.delete(
            f"/api/curriculum/goals/{goal.pk}/", **_auth(OWNER)
        )

        self.assertEqual(response.status_code, 204)
        self.assertEqual(LearningGoal.objects.count(), 0)
        self.assertEqual(CoursePlan.objects.count(), 0)
        self.assertEqual(CourseEnrollment.objects.count(), 0)
        self.assertEqual(Document.objects.count(), 0)

    def test_deleting_a_plan_with_active_studies(self):
        goal = self._make_goal()
        document = self._make_document(OWNER)
        with mock.patch(
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
        self.client.post(f"/api/curriculum/plans/{plan_id}/approve/", **_auth(OWNER))

        response = self.client.delete(
            f"/api/curriculum/plans/{plan_id}/", **_auth(OWNER)
        )

        self.assertEqual(response.status_code, 204)
        self.assertEqual(CoursePlan.objects.count(), 0)
        self.assertEqual(CourseEnrollment.objects.count(), 0)
        # Книга и предмет — не часть программы и остаются на месте.
        self.assertEqual(Document.objects.count(), 1)
        self.assertEqual(LearningGoal.objects.count(), 1)

    def test_book_without_subject_survives_subject_deletion(self):
        # `null=True` — книги, загруженные до каталога, ничьи. Удаление чужого
        # предмета не должно их задевать.
        goal = self._make_goal()
        self._upload()
        self.client.delete(f"/api/curriculum/goals/{goal.pk}/", **_auth(OWNER))
        self.assertEqual(Document.objects.count(), 1)


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


class PlanRebuildAndPaceTests(_ApiBase):
    """Что делать, если программа не понравилась."""

    def setUp(self):
        super().setUp()
        self.goal = self._make_goal(OWNER)
        self.document = self._make_document(OWNER)
        self.document.goal = self.goal
        self.document.save(update_fields=["goal"])
        self.plan = self._generate_plan()

    def _generate_plan(self):
        with mock.patch(
            "curriculum.services.plans.get_planning_provider",
            return_value=FakeCoursePlanningProvider(),
        ), mock.patch(
            "curriculum.services.plans.get_review_provider",
            return_value=FakeCourseReviewProvider(),
        ):
            response = self.client.post(
                "/api/curriculum/plans/generate/",
                {"goal_id": str(self.goal.pk), "document_id": str(self.document.pk)},
                **_auth(OWNER),
            )
        self.assertEqual(response.status_code, 201)
        return CoursePlan.objects.get(pk=response.json()["plan"]["id"])

    def _rebuild(self):
        with mock.patch(
            "curriculum.services.plans.get_planning_provider",
            return_value=FakeCoursePlanningProvider(),
        ), mock.patch(
            "curriculum.services.plans.get_review_provider",
            return_value=FakeCourseReviewProvider(),
        ):
            return self.client.post(
                f"/api/curriculum/plans/{self.plan.pk}/rebuild/", **_auth(OWNER)
            )

    def test_rebuild_archives_the_previous_plan(self):
        response = self._rebuild()

        self.assertEqual(response.status_code, 201)
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.status, CoursePlan.Status.ARCHIVED)
        fresh = CoursePlan.objects.get(pk=response.json()["plan"]["id"])
        self.assertNotEqual(fresh.pk, self.plan.pk)
        self.assertNotEqual(fresh.status, CoursePlan.Status.ARCHIVED)

    def test_catalog_shows_only_the_current_plan(self):
        """Иначе по одной книге видно две записи и непонятно, какая живая."""
        self._rebuild()

        response = self.client.get("/api/curriculum/plans/", **_auth(OWNER))
        body = response.json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertEqual([row["id"] for row in rows].count(str(self.plan.pk)), 0)
        self.assertEqual(len(rows), 1)

    def test_archived_plan_is_still_reachable(self):
        # История не пропадает: она скрыта из списка, а не удалена.
        self._rebuild()

        by_link = self.client.get(
            f"/api/curriculum/plans/{self.plan.pk}/", **_auth(OWNER)
        )
        self.assertEqual(by_link.status_code, 200)

        listed = self.client.get("/api/curriculum/plans/?archived=1", **_auth(OWNER))
        body = listed.json()
        rows = body["results"] if isinstance(body, dict) else body
        self.assertEqual(len(rows), 2)

    def test_failed_rebuild_leaves_the_old_plan_alone(self):
        """Ученик, нажавший «перестроить», не должен остаться без программы.

        Генерация идёт минутами и вполне может не удаться — архивировать
        прежнюю до успеха значит отобрать единственное, что у него есть.
        """

        class Broken:
            name = "broken"

            def generate_plan(self, request, context):
                raise RuntimeError("модель недоступна")

        with mock.patch(
            "curriculum.services.plans.get_planning_provider", return_value=Broken()
        ):
            response = self.client.post(
                f"/api/curriculum/plans/{self.plan.pk}/rebuild/", **_auth(OWNER)
            )

        self.assertEqual(response.status_code, 422)
        self.plan.refresh_from_db()
        self.assertNotEqual(self.plan.status, CoursePlan.Status.ARCHIVED)
        self.assertEqual(CoursePlan.objects.count(), 1)

    def test_rebuild_without_book_is_refused(self):
        self.plan.document = None
        self.plan.save(update_fields=["document"])

        response = self.client.post(
            f"/api/curriculum/plans/{self.plan.pk}/rebuild/", **_auth(OWNER)
        )

        self.assertEqual(response.status_code, 422)
        self.assertIn("Книга удалена", response.json()["error"])

    def test_pace_changes_forecast_without_calling_the_model(self):
        # Состав тем не меняется — меняется расписание. Вызов модели здесь был
        # бы платой ни за что.
        with mock.patch(
            "curriculum.services.plans.get_planning_provider"
        ) as planner, mock.patch(
            "curriculum.services.plans.get_review_provider"
        ) as reviewer:
            response = self.client.patch(
                f"/api/curriculum/plans/{self.plan.pk}/pace/",
                {"sessions_per_week": 5, "minutes_per_session": 30},
                content_type="application/json",
                **_auth(OWNER),
            )

        self.assertEqual(response.status_code, 200)
        planner.assert_not_called()
        reviewer.assert_not_called()
        self.plan.refresh_from_db()
        self.assertEqual(self.plan.recommended_sessions_per_week, 5)
        self.assertEqual(self.plan.recommended_session_minutes, 30)

    def test_pace_deadline_lands_on_the_subject(self):
        # Срок — свойство предмета: следующая программа по той же цели должна
        # его унаследовать.
        response = self.client.patch(
            f"/api/curriculum/plans/{self.plan.pk}/pace/",
            {"desired_finish_date": "2027-05-20"},
            content_type="application/json",
            **_auth(OWNER),
        )

        self.assertEqual(response.status_code, 200)
        self.goal.refresh_from_db()
        self.assertEqual(self.goal.desired_finish_date.isoformat(), "2027-05-20")

    def test_half_a_pace_is_refused(self):
        """Иначе вторая половина молча ушла бы в автоподбор."""
        response = self.client.patch(
            f"/api/curriculum/plans/{self.plan.pk}/pace/",
            {"sessions_per_week": 5},
            content_type="application/json",
            **_auth(OWNER),
        )
        self.assertEqual(response.status_code, 400)

    def test_pace_works_on_an_active_plan(self):
        # Темп занятий не меняет того, чему учат, поэтому запрет на правку
        # подтверждённой программы сюда не распространяется.
        self.plan.status = CoursePlan.Status.ACTIVE
        self.plan.save(update_fields=["status"])

        response = self.client.patch(
            f"/api/curriculum/plans/{self.plan.pk}/pace/",
            {"sessions_per_week": 2, "minutes_per_session": 60},
            content_type="application/json",
            **_auth(OWNER),
        )

        self.assertEqual(response.status_code, 200)

    def test_stranger_cannot_rebuild_someone_elses_plan(self):
        response = self.client.post(
            f"/api/curriculum/plans/{self.plan.pk}/rebuild/", **_auth(INTRUDER)
        )
        self.assertEqual(response.status_code, 404)


class PlanStructureTests(_ApiBase):
    """Ручная правка состава программы."""

    def setUp(self):
        super().setUp()
        self.goal = self._make_goal(OWNER)
        self.document = self._make_document(OWNER)
        with mock.patch(
            "curriculum.services.plans.get_planning_provider",
            return_value=FakeCoursePlanningProvider(),
        ), mock.patch(
            "curriculum.services.plans.get_review_provider",
            return_value=FakeCourseReviewProvider(),
        ):
            response = self.client.post(
                "/api/curriculum/plans/generate/",
                {"goal_id": str(self.goal.pk), "document_id": str(self.document.pk)},
                **_auth(OWNER),
            )
        self.plan = CoursePlan.objects.get(pk=response.json()["plan"]["id"])

    def _tree(self) -> list[dict]:
        """Текущий состав в том виде, в каком его принимает эндпоинт."""
        return [
            {
                "external_id": module.external_id,
                "title": module.title,
                "objective": module.objective,
                "topics": [
                    {
                        "external_id": topic.external_id,
                        "title": topic.title,
                        "objective": topic.objective,
                        "estimated_minutes": topic.estimated_minutes,
                    }
                    for topic in module.topics.all().order_by("order_index")
                ],
            }
            for module in self.plan.modules.all().order_by("order_index")
        ]

    def _put(self, modules: list[dict], email: str = OWNER):
        return self.client.put(
            f"/api/curriculum/plans/{self.plan.pk}/structure/",
            {"modules": modules},
            content_type="application/json",
            **_auth(email),
        )

    def test_rename_is_saved_and_makes_a_new_version(self):
        before = self.plan.current_version
        tree = self._tree()
        tree[0]["title"] = "Переименованный модуль"

        response = self._put(tree)

        self.assertEqual(response.status_code, 200)
        self.plan.refresh_from_db()
        self.assertEqual(
            self.plan.modules.order_by("order_index").first().title,
            "Переименованный модуль",
        )
        # Версия обязана вырасти: по ней `CourseEnrollment` отличает, чему
        # именно учился ученик.
        self.assertEqual(self.plan.current_version, before + 1)
        self.assertTrue(
            self.plan.versions.filter(version=self.plan.current_version).exists()
        )

    def test_dropping_a_topic_removes_it_and_its_dependencies(self):
        tree = self._tree()
        removed = tree[0]["topics"].pop(0)["external_id"]

        response = self._put(tree)

        self.assertEqual(response.status_code, 200)
        self.assertFalse(
            CourseTopic.objects.filter(
                module__plan=self.plan, external_id=removed
            ).exists()
        )
        # Ни одна зависимость не должна ссылаться на удалённую тему.
        self.assertEqual(
            CourseDependency.objects.filter(plan=self.plan)
            .filter(
                models.Q(topic__external_id=removed)
                | models.Q(depends_on__external_id=removed)
            )
            .count(),
            0,
        )

    def test_duration_of_module_and_plan_is_recomputed(self):
        # Числа считаются, а не принимаются на веру: иначе превью показало бы
        # ученику одно, а прогноз посчитал бы по другому.
        tree = self._tree()
        for topic in tree[0]["topics"]:
            topic["estimated_minutes"] = 20

        self._put(tree)

        self.plan.refresh_from_db()
        first = self.plan.modules.order_by("order_index").first()
        self.assertEqual(first.estimated_minutes, 20 * first.topics.count())
        self.assertEqual(
            self.plan.estimated_total_minutes,
            sum(
                topic.estimated_minutes
                for topic in CourseTopic.objects.filter(module__plan=self.plan)
            ),
        )

    def test_order_follows_the_array(self):
        # Порядок задаётся положением в массиве, а не отдельным полем: клиент
        # перетаскивает строки, и требовать от него ещё и пересчёт индексов
        # значит завести второй источник истины о порядке.
        tree = self._tree()
        first = tree[0]
        self.assertGreaterEqual(len(first["topics"]), 2, "нужны хотя бы две темы")
        first["topics"].reverse()
        expected = [topic["external_id"] for topic in first["topics"]]

        self._put(tree)

        self.plan.refresh_from_db()
        module = self.plan.modules.order_by("order_index").first()
        self.assertEqual(
            [t.external_id for t in module.topics.order_by("order_index")],
            expected,
        )

    def test_inventing_a_topic_is_refused(self):
        """У новой темы неоткуда взяться провенансу.

        Тема без `CourseSourceBinding` неотличима от выдуманной моделью —
        валидатор блокирует ровно такие.
        """
        tree = self._tree()
        tree[0]["topics"].append(
            {"external_id": "выдуманная", "title": "Новая тема"}
        )

        response = self._put(tree)

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["code"], "invalid_structure")

    def test_emptying_the_plan_is_refused(self):
        tree = self._tree()
        for module in tree:
            module["topics"] = []

        response = self._put(tree)

        self.assertEqual(response.status_code, 400)

    def test_active_plan_is_not_editable(self):
        # По активной программе уже занимаются, и версия защищена PROTECT.
        self.plan.status = CoursePlan.Status.ACTIVE
        self.plan.save(update_fields=["status"])

        response = self._put(self._tree())

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["code"], "plan_not_editable")

    def test_stranger_cannot_edit_someone_elses_plan(self):
        response = self._put(self._tree(), email=INTRUDER)
        self.assertEqual(response.status_code, 404)


class RouteRegistrationTests(TestCase):
    def test_curriculum_routes_registered(self):
        for name in (
            "curriculum-goals-list",
            "curriculum-documents-list",
            "curriculum-plans-list",
            "curriculum-enrollments-list",
        ):
            self.assertTrue(reverse(name).startswith("/api/curriculum/"))

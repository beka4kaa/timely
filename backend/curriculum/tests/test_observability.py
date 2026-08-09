import json

from django.test import SimpleTestCase, TestCase

from curriculum.models import Document, IngestionJob
from curriculum.observability import log_ingestion_event
from curriculum.services.dispatch import mark_queued


class IngestionEventPayloadTests(SimpleTestCase):
    def test_payload_is_ndjson_allowlist_without_book_content(self):
        with self.assertLogs("curriculum.ingestion.events", level="INFO") as captured:
            log_ingestion_event(
                "transition",
                document_id="doc-1",
                job_id="job-1",
                processing_version="7.0",
                from_status="queued",
                to_status="validating",
                duration_ms=12,
                text="Секретный текст учебника",
                embedding=[0.1, 0.2],
                error_message="внутренняя подробность",
            )

        payload = json.loads(captured.records[0].getMessage())
        self.assertEqual(payload["event"], "transition")
        self.assertEqual(payload["document_id"], "doc-1")
        self.assertEqual(payload["duration_ms"], 12)
        self.assertNotIn("text", payload)
        self.assertNotIn("embedding", payload)
        self.assertNotIn("error_message", payload)


class IngestionEventIntegrationTests(TestCase):
    def test_successful_queue_transition_emits_one_structured_event(self):
        document = Document.objects.create(user_email="a@b.c", title="Книга")
        job = IngestionJob.objects.create(document=document, user_email="a@b.c")

        with self.assertLogs("curriculum.ingestion.events", level="INFO") as captured:
            mark_queued(job)

        events = [json.loads(record.getMessage()) for record in captured.records]
        self.assertEqual([event["event"] for event in events], ["queued"])
        self.assertEqual(events[0]["to_status"], Document.Status.QUEUED)

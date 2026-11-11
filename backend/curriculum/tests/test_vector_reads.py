"""Выборки кусков, которым вектор не нужен, его не читают."""

import re

from django.db import connection, transaction
from django.test.utils import CaptureQueriesContext

from curriculum.models import KnowledgeChunk
from curriculum.services import plans as plans_service
from curriculum.services.plans import _lock_planning_source_snapshot
from curriculum.services.search import SearchRequest, search_chunks
from curriculum.tests.test_services import EMAIL, _PlanBase

EMBEDDING_COLUMN = re.compile(r'"curriculum_knowledgechunk"\."embedding"(?!_)')


def chunk_selects_with_vectors(queries):
    return [
        q["sql"]
        for q in queries
        if q["sql"].lstrip().upper().startswith("SELECT")
        and "curriculum_knowledgechunk" in q["sql"]
        and EMBEDDING_COLUMN.search(q["sql"])
    ]


class VectorReadsTests(_PlanBase):
    def test_search_does_not_load_vectors(self):
        with CaptureQueriesContext(connection) as ctx:
            search_chunks(
                SearchRequest(
                    user_email=EMAIL,
                    query="сила",
                    document_ids=[],
                    limit=5,
                    mode="explain",
                )
            )
        self.assertEqual(chunk_selects_with_vectors(ctx.captured_queries), [])

    def test_planning_context_does_not_load_vectors(self):
        with CaptureQueriesContext(connection) as ctx:
            plans_service.retrieve_planning_context(self.goal, self.document)
        self.assertEqual(chunk_selects_with_vectors(ctx.captured_queries), [])

    def test_plan_source_lock_does_not_load_vectors(self):
        ids = [
            str(pk)
            for pk in KnowledgeChunk.objects.filter(
                document_id=self.document.pk
            ).values_list("pk", flat=True)
        ]
        with CaptureQueriesContext(connection) as ctx:
            with transaction.atomic():
                _lock_planning_source_snapshot(
                    self.document,
                    processing_version=self.document.processing_version,
                    chunk_ids=ids,
                )
        self.assertEqual(chunk_selects_with_vectors(ctx.captured_queries), [])

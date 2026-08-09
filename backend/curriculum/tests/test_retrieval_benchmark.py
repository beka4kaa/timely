from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from curriculum.models import Document, DocumentSection, KnowledgeChunk
from curriculum.retrieval import RetrievableChunk
from curriculum.retrieval_benchmark import (
    RetrievalQueryCase,
    run_retrieval_benchmark,
)


def _chunk(chunk_id: str, path: str) -> RetrievableChunk:
    return RetrievableChunk(
        chunk_id=chunk_id,
        document_id="d1",
        owner_email="a@b.c",
        chunk_type="prose",
        text=f"текст {path}",
        section_path=path,
    )


class StaticRetriever:
    def __init__(self, rows):
        self.rows = rows
        self.limits = []

    def search(self, query, candidates, *, limit):
        self.limits.append(limit)
        return list(self.rows)[:limit]


class RetrievalBenchmarkTests(TestCase):
    def test_compares_same_candidates_and_reports_recall_mrr(self):
        wrong = _chunk("c1", "2")
        relevant = _chunk("c2", "1")
        lexical = StaticRetriever([(wrong, 1.0), (relevant, 0.5)])
        dense = StaticRetriever([(relevant, 0.9)])
        result = run_retrieval_benchmark(
            cases=[RetrievalQueryCase("Ньютон", frozenset({"1"}))],
            candidates=[wrong, relevant],
            lexical=lexical,
            dense=dense,
            limit=10,
        )

        self.assertEqual(result["variants"]["lexical"]["recall_at_k"], 1.0)
        self.assertEqual(result["variants"]["lexical"]["mrr_at_k"], 0.5)
        self.assertEqual(result["variants"]["dense"]["mrr_at_k"], 1.0)
        self.assertEqual(result["variants"]["hybrid"]["solution_leakage"], 0)
        self.assertEqual(lexical.limits, [40])
        self.assertEqual(dense.limits, [40])

    def test_management_command_is_dry_run_by_default(self):
        document = Document.objects.create(
            user_email="a@b.c",
            title="Книга",
            ingestion_status=Document.Status.READY,
        )
        section = DocumentSection.objects.create(
            document=document,
            kind="chapter",
            title="Законы Ньютона",
            path="1",
            order_index=0,
        )
        KnowledgeChunk.objects.create(
            document_id=document.pk,
            section_id=section.pk,
            section_path="1",
            normalized_text="Второй закон Ньютона",
            content_hash="h" * 64,
        )
        output = StringIO()

        call_command(
            "curriculum_retrieval_eval",
            document=str(document.pk),
            stdout=output,
        )

        self.assertIn("dry-run", output.getvalue())
        self.assertIn("Запросов: 1", output.getvalue())

    def test_management_command_rejects_non_finite_or_non_positive_budgets(self):
        document_id = "00000000-0000-0000-0000-000000000000"
        for option in ("max_usd", "usd_per_million_tokens"):
            for value in (0.0, -1.0, float("nan"), float("inf")):
                with self.subTest(option=option, value=value):
                    with self.assertRaises(CommandError):
                        call_command(
                            "curriculum_retrieval_eval",
                            document=document_id,
                            stdout=StringIO(),
                            **{option: value},
                        )

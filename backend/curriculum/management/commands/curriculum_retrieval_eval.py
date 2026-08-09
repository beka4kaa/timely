from __future__ import annotations

import json
import math
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError

from ai_engine.usage import usage_scope
from curriculum.embeddings import estimate_tokens
from curriculum.models import Document, DocumentSection, KnowledgeChunk
from curriculum.retrieval import (
    RetrievalPolicy,
    apply_access_policy,
    get_dense_retriever,
    get_lexical_retriever,
)
from curriculum.retrieval_benchmark import RetrievalQueryCase, run_retrieval_benchmark
from curriculum.services.chunk_view import as_retrievable


def _positive_finite(value: float, *, option: str) -> float:
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise CommandError(f"{option} должен быть конечным числом больше нуля.")
    return number


class Command(BaseCommand):
    help = "Сравнивает lexical/dense/hybrid retrieval на одном access-filtered corpus."

    def add_arguments(self, parser):
        parser.add_argument("--document", required=True, help="UUID документа")
        parser.add_argument(
            "--gold-set",
            help="JSON: [{query, relevant_section_paths:[...]}]; без него берётся TOC smoke-set",
        )
        parser.add_argument("--max-queries", type=int, default=30)
        parser.add_argument("--limit", type=int, default=10)
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Разрешить query embeddings; без флага только dry-run",
        )
        parser.add_argument("--max-usd", type=float, default=0.01)
        parser.add_argument("--usd-per-million-tokens", type=float, default=0.02)

    def handle(self, *args, **options):
        price = _positive_finite(
            options["usd_per_million_tokens"],
            option="--usd-per-million-tokens",
        )
        max_usd = _positive_finite(options["max_usd"], option="--max-usd")
        document = Document.objects.filter(pk=options["document"]).first()
        if document is None:
            raise CommandError("Документ не найден.")

        cases = self._cases(document, options.get("gold_set"))
        max_queries = max(1, min(int(options["max_queries"]), 100))
        cases = cases[:max_queries]
        if not cases:
            raise CommandError("Нет запросов для evaluation.")

        chunks = [
            as_retrievable(chunk, document)
            for chunk in KnowledgeChunk.objects.filter(document=document)
            .select_related("task")
            .order_by("page_start", "id")
        ]
        candidates = apply_access_policy(
            chunks,
            user_email=document.user_email,
            policy=RetrievalPolicy(mode="solve"),
            document_ids=[str(document.pk)],
        )
        if not candidates:
            raise CommandError("В документе нет доступных фрагментов.")

        query_tokens = sum(estimate_tokens(case.query) for case in cases)
        estimated_usd = query_tokens / 1_000_000 * price
        self.stdout.write(
            f"Запросов: {len(cases)}, кандидатов: {len(candidates)}, "
            f"query tokens: ~{query_tokens}, оценка: ${estimated_usd:.6f}"
        )
        if not options["execute"]:
            self.stdout.write(
                self.style.WARNING(
                    "Это dry-run: retrieval не запускался. Добавьте --execute."
                )
            )
            return
        if estimated_usd > max_usd:
            raise CommandError(
                f"Оценка ${estimated_usd:.6f} превышает --max-usd "
                f"${max_usd:.6f}."
            )

        with usage_scope(
            user_email=document.user_email,
            feature="curriculum_retrieval_eval",
        ):
            result = run_retrieval_benchmark(
                cases=cases,
                candidates=candidates,
                lexical=get_lexical_retriever(),
                dense=get_dense_retriever(),
                limit=max(1, min(int(options["limit"]), 50)),
            )
        self.stdout.write(json.dumps(result, ensure_ascii=False, sort_keys=True))

    def _cases(self, document: Document, gold_path: str | None) -> list[RetrievalQueryCase]:
        if gold_path:
            try:
                payload = json.loads(Path(gold_path).read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise CommandError("Gold set не читается как JSON.") from exc
            if not isinstance(payload, list):
                raise CommandError("Gold set должен быть JSON-массивом.")
            cases = []
            for row in payload:
                if not isinstance(row, dict):
                    raise CommandError("Каждый gold query должен быть объектом.")
                query = str(row.get("query", "")).strip()
                paths = frozenset(
                    str(path).strip()
                    for path in row.get("relevant_section_paths", [])
                    if str(path).strip()
                )
                if query and paths:
                    cases.append(RetrievalQueryCase(query, paths))
            return cases

        by_title: dict[str, set[str]] = {}
        for title, path in (
            DocumentSection.objects.filter(document=document)
            .exclude(title="")
            .exclude(path="")
            .order_by("order_index", "path")
            .values_list("title", "path")
        ):
            by_title.setdefault(title.strip(), set()).add(path)
        return [
            RetrievalQueryCase(query=title, relevant_section_paths=frozenset(paths))
            for title, paths in by_title.items()
            if title
        ]

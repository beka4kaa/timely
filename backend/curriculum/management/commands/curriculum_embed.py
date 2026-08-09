"""Индексация книг векторами: разово, вручную, с оценкой стоимости заранее.

Штатно эмбеддинги считаются внутри обработки книги. Эта команда нужна для трёх
случаев, которых пайплайн не покрывает:

* книги, загруженные ДО подключения эмбеддингов (у них статус `skipped`);
* повторный прогон после того, как батчи упали по сети (`failed`);
* смена модели эмбеддингов — тогда пересчитать надо всё.

`--dry-run` печатает объём работы и оценку стоимости, не делая ни одного
платного вызова. Это режим по умолчанию для проверки: увидеть цену ДО того, как
она потрачена, важнее, чем сэкономить одну команду.
"""

from __future__ import annotations

import math

from django.core.management.base import BaseCommand, CommandError

from curriculum.embeddings import get_embedding_provider
from curriculum.models import Document, KnowledgeChunk
from curriculum.services.embedding_index import (
    estimate_document_index,
    index_document_chunks,
)


def _positive_finite(value: float, *, option: str) -> float:
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise CommandError(f"{option} должен быть конечным числом больше нуля.")
    return number


class Command(BaseCommand):
    help = "Считает эмбеддинги фрагментов книги (или всех книг пользователя)."

    def add_arguments(self, parser):
        parser.add_argument("--document", help="UUID документа")
        parser.add_argument("--user", help="Email владельца: все его документы")
        parser.add_argument(
            "--execute",
            action="store_true",
            help="Разрешить платные вызовы; без флага команда всегда dry-run",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Явно зафиксировать dry-run (режим и так используется по умолчанию)",
        )
        parser.add_argument(
            "--reset-failed",
            action="store_true",
            help="Вернуть в очередь фрагменты со статусом failed и skipped",
        )
        parser.add_argument(
            "--usd-per-million-tokens",
            type=float,
            default=0.02,
            help="Цена модели для оценки (по умолчанию 0.02 — text-embedding-3-small)",
        )
        parser.add_argument(
            "--max-usd",
            type=float,
            default=0.05,
            help="Предельная оценка стоимости для --execute (по умолчанию $0.05)",
        )
        parser.add_argument(
            "--reindex-all",
            action="store_true",
            help="Пересчитать даже READY-векторы текущей модели",
        )

    def handle(self, *args, **options):
        price = _positive_finite(
            options["usd_per_million_tokens"],
            option="--usd-per-million-tokens",
        )
        max_usd = _positive_finite(options["max_usd"], option="--max-usd")
        documents = self._documents(options)
        if not documents:
            raise CommandError("Не найдено ни одного документа по этим условиям.")

        provider = get_embedding_provider()
        model = getattr(provider, "model", "") or provider.name
        configured = provider.name != "null-embedding"
        execute = bool(options["execute"])
        if execute and options["dry_run"]:
            raise CommandError("Выберите одно: --execute или --dry-run.")

        self.stdout.write(f"Провайдер: {provider.name}")
        self.stdout.write(f"Модель:    {model if configured else '— не настроена —'}")
        if not configured and execute:
            raise CommandError(
                "EMBEDDING_MODEL и EMBEDDING_BASE_URL не заданы: считать нечем. "
                "Прогон без них только пометит фрагменты как skipped."
            )

        total_billable = 0
        total_tokens = 0
        estimates = []
        for document in documents:
            estimate = estimate_document_index(
                document,
                model=model,
                include_ready=bool(options["reindex_all"]),
            )
            estimates.append((document, estimate))
            total_billable += estimate.billable_chunks
            total_tokens += estimate.approx_tokens

            self.stdout.write(
                f"\n{document.title[:60]} ({document.pk})\n"
                f"  в очереди:        {estimate.chunks}\n"
                f"  уже посчитано:    {estimate.reusable} (переиспользуется даром)\n"
                f"  к оплате:         {estimate.billable_chunks}\n"
                f"  примерно токенов: {estimate.approx_tokens}"
                + ("\n  ВНИМАНИЕ: часть фрагментов отсечена потолком" if estimate.capped else "")
            )

        cost = total_tokens / 1_000_000 * price
        self.stdout.write(
            f"\nИтого к оплате: {total_billable} фрагментов, ~{total_tokens} токенов, "
            f"≈ ${cost:.4f}"
        )
        if not execute:
            self.stdout.write(
                self.style.WARNING(
                    "Это dry-run по умолчанию: ни одного вызова не сделано. "
                    "Для запуска добавьте --execute."
                )
            )
            return

        if cost > max_usd:
            raise CommandError(
                f"Оценка ${cost:.4f} превышает --max-usd ${max_usd:.4f}."
            )

        if options["reset_failed"] and not options["reindex_all"]:
            reset = KnowledgeChunk.objects.filter(
                document__in=documents,
                embedding_status__in=[
                    KnowledgeChunk.EmbeddingStatus.FAILED,
                    KnowledgeChunk.EmbeddingStatus.SKIPPED,
                ],
            ).update(embedding_status=KnowledgeChunk.EmbeddingStatus.PENDING)
            self.stdout.write(f"Возвращено в очередь: {reset}")

        from ai_engine.usage import usage_scope

        for document, _estimate in estimates:
            with usage_scope(
                user_email=document.user_email,
                feature="curriculum_embedding_backfill",
            ):
                outcome = index_document_chunks(
                    document,
                    provider=provider,
                    force_reindex=bool(options["reindex_all"]),
                )
            self.stdout.write(
                f"  → посчитано {outcome.embedded}, переиспользовано {outcome.reused}, "
                f"пропущено {outcome.skipped}, не удалось {outcome.failed}"
            )
            for warning in outcome.warnings:
                self.stdout.write(self.style.WARNING(f"  ! {warning}"))

    def _documents(self, options) -> list[Document]:
        queryset = Document.objects.all().order_by("created_at")
        if options.get("document"):
            queryset = queryset.filter(pk=options["document"])
        if options.get("user"):
            queryset = queryset.filter(user_email=options["user"])
        if not options.get("document") and not options.get("user"):
            raise CommandError(
                "Укажите --document или --user: молча индексировать всю базу "
                "команда не будет."
            )
        return list(queryset)

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

from django.core.management.base import BaseCommand, CommandError

from curriculum.embeddings import get_embedding_provider
from curriculum.models import Document, KnowledgeChunk
from curriculum.services.embedding_index import (
    estimate_document_index,
    index_document_chunks,
)


class Command(BaseCommand):
    help = "Считает эмбеддинги фрагментов книги (или всех книг пользователя)."

    def add_arguments(self, parser):
        parser.add_argument("--document", help="UUID документа")
        parser.add_argument("--user", help="Email владельца: все его документы")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Показать объём работы и оценку стоимости, ничего не вызывая",
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

    def handle(self, *args, **options):
        documents = self._documents(options)
        if not documents:
            raise CommandError("Не найдено ни одного документа по этим условиям.")

        provider = get_embedding_provider()
        model = getattr(provider, "model", "") or provider.name
        configured = provider.name != "null-embedding"

        self.stdout.write(f"Провайдер: {provider.name}")
        self.stdout.write(f"Модель:    {model if configured else '— не настроена —'}")
        if not configured and not options["dry_run"]:
            raise CommandError(
                "EMBEDDING_MODEL и EMBEDDING_BASE_URL не заданы: считать нечем. "
                "Прогон без них только пометит фрагменты как skipped."
            )

        if options["reset_failed"] and not options["dry_run"]:
            reset = KnowledgeChunk.objects.filter(
                document__in=documents,
                embedding_status__in=[
                    KnowledgeChunk.EmbeddingStatus.FAILED,
                    KnowledgeChunk.EmbeddingStatus.SKIPPED,
                ],
            ).update(embedding_status=KnowledgeChunk.EmbeddingStatus.PENDING)
            self.stdout.write(f"Возвращено в очередь: {reset}")

        total_billable = 0
        total_tokens = 0
        for document in documents:
            estimate = estimate_document_index(document, model=model)
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

            if options["dry_run"]:
                continue

            outcome = index_document_chunks(document, provider=provider)
            self.stdout.write(
                f"  → посчитано {outcome.embedded}, переиспользовано {outcome.reused}, "
                f"пропущено {outcome.skipped}, не удалось {outcome.failed}"
            )
            for warning in outcome.warnings:
                self.stdout.write(self.style.WARNING(f"  ! {warning}"))

        cost = total_tokens / 1_000_000 * options["usd_per_million_tokens"]
        self.stdout.write(
            f"\nИтого к оплате: {total_billable} фрагментов, ~{total_tokens} токенов, "
            f"≈ ${cost:.4f}"
        )
        if options["dry_run"]:
            self.stdout.write(
                self.style.WARNING("Это dry-run: ни одного вызова не сделано.")
            )

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

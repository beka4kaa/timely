"""Диагностика поискового индекса: построен ли он и что с ним не так.

Ни одного вызова модели и ни одного платного запроса — команду можно гонять
сколько угодно.
"""

from __future__ import annotations

import json

from django.core.management.base import BaseCommand, CommandError

from curriculum.embeddings import get_embedding_provider
from curriculum.index_stats import collect_index_stats
from curriculum.models import Document


class Command(BaseCommand):
    help = "Показывает состояние поискового индекса книги."

    def add_arguments(self, parser):
        parser.add_argument("--document", help="UUID документа; без него — все")
        parser.add_argument("--email", help="Только книги этого пользователя")
        parser.add_argument("--json", action="store_true", help="Вывод в JSON")

    def handle(self, *args, **options):
        documents = Document.objects.all().order_by("created_at")
        if options.get("document"):
            documents = documents.filter(pk=options["document"])
        if options.get("email"):
            documents = documents.filter(user_email=options["email"])
        documents = list(documents)
        if not documents:
            raise CommandError("Не найдено ни одного документа по этим условиям.")

        provider = get_embedding_provider()
        # Тот же идентификатор, что пишет `embedding_index` и ищет
        # `PgVectorDenseRetriever`. Считать его иначе значит диагностировать
        # не то, что работает в проде.
        active_model = (
            ""
            if provider.name == "null-embedding"
            else (getattr(provider, "model", "") or provider.name)
        )

        reports = [
            collect_index_stats(document, active_model=active_model)
            for document in documents
        ]

        if options["json"]:
            self.stdout.write(
                json.dumps(
                    [report.as_dict() for report in reports],
                    ensure_ascii=False,
                    indent=2,
                )
            )
            return

        for report in reports:
            self._render(report)

    def _render(self, report) -> None:
        self.stdout.write("")
        self.stdout.write(
            self.style.MIGRATE_HEADING(report.title or report.document_id)
        )
        self.stdout.write(
            f"  язык: {report.language or '—'} · версия: {report.processing_version}"
            f" · страниц: {report.page_count}"
        )
        self.stdout.write(f"  фрагментов: {report.total_chunks}")
        for status, count in sorted(report.by_status.items()):
            self.stdout.write(f"      {status}: {count}")

        self.stdout.write(
            f"  модель запроса: {report.active_model or 'не настроена'}"
        )
        for model, count in sorted(report.models.items()):
            mark = "✓" if model == report.active_model else "✗"
            self.stdout.write(f"      {mark} {model}: {count}")
        self.stdout.write(
            f"  доступно плотному поиску: {report.searchable_chunks}"
            f" из {report.total_chunks}"
        )
        self.stdout.write(
            "  размер фрагмента, токенов: "
            f"мин {report.tokens_min} · медиана {report.tokens_median}"
            f" · p95 {report.tokens_p95} · макс {report.tokens_max}"
        )

        problems = report.problems()
        if not problems:
            self.stdout.write(self.style.SUCCESS("  индекс в порядке"))
            return
        for problem in problems:
            self.stdout.write(self.style.WARNING(f"  ! {problem}"))

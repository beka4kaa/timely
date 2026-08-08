"""Прогон настоящего PDF через пайплайн целиком, из командной строки.

Зачем отдельная команда: обработка синхронная (очереди в проекте нет), и учебник
на несколько сотен страниц незачем гонять через веб-запрос. Здесь же удобно
смотреть, что именно извлеклось.

Без заданного `OCR_MODEL` сканированные страницы останутся без текста, но
команда не упадёт и в сеть не пойдёт: `get_ocr_provider()` вернёт
`NullOcrProvider`.
"""

from __future__ import annotations

import os

from django.core.management.base import BaseCommand, CommandError

from curriculum import storage as storage_module
from curriculum.models import Document, DocumentFile, ExtractedSolution, ExtractedTask
from curriculum.services.ingestion import MAX_PAGES_PER_RUN, ingest_document
from curriculum.upload_validation import UploadRejected, validate_pdf_upload


class Command(BaseCommand):
    help = "Загружает PDF и проводит его по пайплайну curriculum."

    def add_arguments(self, parser):
        parser.add_argument("pdf_path", help="Путь к PDF-файлу")
        parser.add_argument(
            "--user-email", required=True, help="Владелец документа"
        )
        parser.add_argument("--title", default="", help="Название книги")
        parser.add_argument(
            "--max-pages",
            type=int,
            default=MAX_PAGES_PER_RUN,
            help=f"Сколько страниц обрабатывать (по умолчанию {MAX_PAGES_PER_RUN})",
        )
        parser.add_argument(
            "--show-blocks",
            action="store_true",
            help="Напечатать извлечённые блоки",
        )

    def handle(self, *args, **options):
        path = options["pdf_path"]
        if not os.path.isfile(path):
            raise CommandError(f"Файл не найден: {path}")

        with open(path, "rb") as handle:
            data = handle.read()

        try:
            validated = validate_pdf_upload(
                data=data, filename=os.path.basename(path)
            )
        except UploadRejected as exc:
            raise CommandError(f"PDF отклонён ({exc.code}): {exc.message}") from exc

        for warning in validated.warnings:
            self.stdout.write(self.style.WARNING(f"предупреждение: {warning}"))

        email = options["user_email"]
        document = Document.objects.create(
            user_email=email,
            title=(options["title"] or validated.sanitized_filename)[:400],
            page_count=validated.page_count,
            source_type=Document.SourceType.UPLOAD,
        )
        store = storage_module.get_storage()
        key = storage_module.build_storage_key(
            user_email=email,
            document_id=str(document.pk),
            filename=validated.sanitized_filename,
        )
        store.save(key, data)
        DocumentFile.objects.create(
            document=document,
            original_filename=os.path.basename(path)[:400],
            sanitized_filename=validated.sanitized_filename,
            storage_backend=store.backend_name,
            storage_key=key,
            mime_type=validated.mime_type,
            byte_size=validated.byte_size,
            content_hash=validated.sha256,
        )

        self.stdout.write(f"Документ {document.pk} создан, обрабатываю…")
        outcome = ingest_document(document, max_pages=options["max_pages"])
        document.refresh_from_db()

        if not outcome.succeeded:
            self.stdout.write(
                self.style.ERROR(
                    f"Статус: {outcome.job.status} "
                    f"({outcome.job.error_code}: {outcome.job.error_message})"
                )
            )
        else:
            self.stdout.write(self.style.SUCCESS(f"Статус: {outcome.job.status}"))

        self.stdout.write(
            f"страниц={outcome.pages} ocr={outcome.ocr_pages} "
            f"разделов={outcome.sections} блоков={outcome.blocks} "
            f"задач={outcome.tasks} решений={outcome.solutions} "
            f"фрагментов={outcome.chunks}"
        )
        self.stdout.write(f"page_count документа: {document.page_count}")
        for warning in outcome.warnings:
            self.stdout.write(self.style.WARNING(f"предупреждение: {warning}"))

        sections = document.sections.all().order_by("order_index")[:40]
        if sections:
            self.stdout.write("\nОглавление:")
            for section in sections:
                self.stdout.write(
                    f"  {section.path or '—':10} {section.kind:10} {section.title[:60]}"
                )

        tasks = ExtractedTask.objects.filter(document=document)[:10]
        if tasks:
            self.stdout.write("\nЗадачи (условия, без решений):")
            for task in tasks:
                self.stdout.write(
                    f"  №{task.number_label or '—':8} стр.{task.page_start:<4} "
                    f"{task.statement[:70]}"
                )
            self.stdout.write(
                f"Решений сохранено отдельно: "
                f"{ExtractedSolution.objects.filter(document=document).count()}"
            )

        if options["show_blocks"]:
            self.stdout.write("\nБлоки:")
            for block in document.blocks.all().order_by("reading_order")[:60]:
                self.stdout.write(
                    f"  {block.reading_order:4} {block.kind:11} "
                    f"стр.{block.page.page_number:<4} {block.normalized_text[:60]}"
                )

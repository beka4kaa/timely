"""Перенос чанков с векторами из основной базы в векторную.

Одноразовая по смыслу, но **повторяемая по устройству**: связь до домашнего ПК
идёт через tailnet и рвётся, а обрыв на середине не должен требовать разбора,
что уже уехало, а что нет. Поэтому запись идёт с `ignore_conflicts=True`, и
повторный запуск просто дозаливает недостающее.

Исходные строки НЕ удаляются. Удаление — отдельное осознанное действие после
того, как поиск проверен на новой базе; команда только копирует.
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from curriculum.models import KnowledgeChunk

# Размер пачки. Вектор на 1536 чисел весит порядка 12 КБ в питоновском виде, так
# что тысяча строк — это уже десятки мегабайт в памяти. Держим сотнями: по сети
# через DERP-релей крупная пачка ещё и рискует упереться в таймаут.
BATCH_SIZE = 200

SOURCE = "default"


class Command(BaseCommand):
    help = "Копирует KnowledgeChunk из основной базы в векторную (vector_db)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Показать объём переноса, ничего не записывая",
        )
        parser.add_argument(
            "--batch-size",
            type=int,
            default=BATCH_SIZE,
            help=f"Размер пачки при записи (по умолчанию {BATCH_SIZE})",
        )
        parser.add_argument(
            "--document",
            help="Перенести только чанки одного документа (UUID)",
        )

    def handle(self, *args, **options):
        target = getattr(settings, "VECTOR_DB_ALIAS", "vector_db")
        if not getattr(settings, "VECTOR_DB_CONFIGURED", False):
            raise CommandError(
                "VECTOR_DB_URL не задан: переносить некуда. Без него `vector_db` — "
                "это та же самая база, и копирование не имеет смысла."
            )
        if target not in connections:
            raise CommandError(f"База «{target}» не описана в DATABASES.")

        source_qs = KnowledgeChunk.objects.using(SOURCE)
        target_qs = KnowledgeChunk.objects.using(target)
        if options.get("document"):
            source_qs = source_qs.filter(document_id=options["document"])
            target_qs = target_qs.filter(document_id=options["document"])

        total = source_qs.count()
        already = target_qs.count()
        self.stdout.write(f"в основной базе:  {total}")
        self.stdout.write(f"в векторной базе: {already}")

        if options["dry_run"]:
            self.stdout.write(
                self.style.WARNING(
                    f"dry-run: поехало бы не больше {max(0, total - already)} строк, "
                    "ничего не записано."
                )
            )
            return

        batch_size = max(1, int(options["batch_size"]))

        # ── Проход 1: строки БЕЗ самоссылок ──────────────────────────────────
        #
        # `parent`, `previous` и `next` ссылаются на саму таблицу чанков, и эти
        # ключи никуда не делись — они внутри одной базы. Вставлять в порядке
        # первичного ключа нельзя: у чанка есть сосед, которого ещё не
        # существует, и база отвергает вставку. Поэтому связи проставляются
        # вторым проходом, когда все строки уже на месте.
        written = 0
        batch: list[KnowledgeChunk] = []
        # `iterator`, а не срез списка: сотни строк с векторами — это сотни
        # мегабайт, если поднять их разом.
        for chunk in source_qs.order_by("pk").iterator(chunk_size=batch_size):
            chunk.parent_id = None
            chunk.previous_id = None
            chunk.next_id = None
            batch.append(chunk)
            if len(batch) >= batch_size:
                written += self._write(batch, target)
                batch = []
                self.stdout.write(f"  перенесено {written} из {total}…")
        if batch:
            written += self._write(batch, target)

        # ── Проход 2: связи между соседями ───────────────────────────────────
        self.stdout.write("  проставляю связи между фрагментами…")
        linked = 0
        link_batch: list[KnowledgeChunk] = []
        for chunk in source_qs.order_by("pk").iterator(chunk_size=batch_size):
            link_batch.append(chunk)
            if len(link_batch) >= batch_size:
                linked += self._link(link_batch, target)
                link_batch = []
        if link_batch:
            linked += self._link(link_batch, target)
        self.stdout.write(f"  связей обновлено: {linked}")

        moved = target_qs.count()
        self.stdout.write("")
        self.stdout.write(f"записано за прогон: {written}")
        self.stdout.write(f"итого в векторной базе: {moved} из {total}")

        if moved == total:
            self.stdout.write(self.style.SUCCESS("Сходится."))
        else:
            # Не ошибка команды, а факт для человека: часть строк могла не
            # доехать из-за обрыва сети. Повторный запуск дозальёт.
            self.stdout.write(
                self.style.WARNING(
                    f"Расхождение: не хватает {total - moved}. "
                    "Запустите команду ещё раз — дубликатов не будет."
                )
            )

    def _write(self, batch: list[KnowledgeChunk], target: str) -> int:
        """Пишет пачку. Уже существующие строки пропускаются.

        `ignore_conflicts` — это и есть повторяемость: первичный ключ у чанка
        свой (UUID из основной базы), поэтому повторная заливка тех же строк
        ничего не дублирует и ничего не перезаписывает.
        """
        KnowledgeChunk.objects.using(target).bulk_create(
            batch, batch_size=len(batch), ignore_conflicts=True
        )
        return len(batch)

    def _link(self, batch: list[KnowledgeChunk], target: str) -> int:
        """Второй проход: проставляет `parent`/`previous`/`next`.

        К этому моменту все строки уже вставлены, поэтому самоссылки больше не
        упираются в отсутствующего соседа.
        """
        KnowledgeChunk.objects.using(target).bulk_update(
            batch,
            ["parent_id", "previous_id", "next_id"],
            batch_size=len(batch),
        )
        return len(batch)

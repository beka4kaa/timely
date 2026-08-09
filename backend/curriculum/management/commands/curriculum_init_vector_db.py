"""Создание схемы в векторной базе.

Историю миграций приложения на этой базе прогнать НЕЛЬЗЯ, и это не обходится
настройкой роутера: `0001_initial` создаёт таблицу чанков вместе с внешними
ключами на документы, разделы и задачи, а их в векторной базе быть не должно.
Разрешить создание этих таблиц тоже не выход — `LearningGoal` тянет ключи в
приложение `mind`, то есть за собой пришлось бы тащить пол-схемы проекта.

Поэтому таблица создаётся из ТЕКУЩЕГО состояния модели, где кросс-базовых
ключей уже нет (см. миграцию `0007`): остались только самоссылки
`parent`/`previous`/`next`, а они внутри той же таблицы. `schema_editor` строит
её одним вызовом, после чего доклады́ваются расширение и два индекса — те же,
что создают миграции `0003` и `0006`.

Команда идемпотентна: повторный запуск ничего не ломает и не дублирует.
"""

from __future__ import annotations

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from curriculum.models import KnowledgeChunk

# Имена и SQL повторяют миграции `0003_chunk_embeddings` и
# `0006_chunk_russian_fts_index`. Импортировать оттуда нельзя: имена модулей
# миграций начинаются с цифры.
HNSW_INDEX = "curriculum_chunk_embedding_hnsw"
FTS_INDEX = "curriculum_chunk_fts_ru_gin"

CREATE_HNSW = f"""
CREATE INDEX IF NOT EXISTS {HNSW_INDEX}
ON curriculum_knowledgechunk
USING hnsw (embedding vector_cosine_ops)
"""

CREATE_FTS = f"""
CREATE INDEX IF NOT EXISTS {FTS_INDEX}
ON curriculum_knowledgechunk
USING GIN (to_tsvector('russian', COALESCE(normalized_text, '')))
"""


class Command(BaseCommand):
    help = "Создаёт таблицу чанков, расширение и индексы в векторной базе."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Показать, что будет сделано, ничего не создавая",
        )

    def handle(self, *args, **options):
        alias = getattr(settings, "VECTOR_DB_ALIAS", "vector_db")
        if not getattr(settings, "VECTOR_DB_CONFIGURED", False):
            raise CommandError(
                "VECTOR_DB_URL не задан: создавать схему негде. Без него "
                "`vector_db` — та же самая база."
            )

        connection = connections[alias]
        if connection.vendor != "postgresql":
            raise CommandError(
                f"Векторная база должна быть PostgreSQL, а не {connection.vendor}."
            )

        table = KnowledgeChunk._meta.db_table
        existing = table in connection.introspection.table_names()

        self.stdout.write(f"база:    {connection.settings_dict.get('HOST')}")
        self.stdout.write(f"таблица: {table} — {'уже есть' if existing else 'будет создана'}")

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("dry-run: ничего не создано."))
            return

        with connection.cursor() as cursor:
            cursor.execute("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
            if not cursor.fetchone():
                # На beka4ka-pc расширение уже поставлено, но команда должна
                # работать и на чистой базе.
                cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
                self.stdout.write("расширение vector установлено")

        if not existing:
            with connection.schema_editor() as schema_editor:
                schema_editor.create_model(KnowledgeChunk)
            self.stdout.write(self.style.SUCCESS("таблица создана"))

        with connection.cursor() as cursor:
            cursor.execute(CREATE_HNSW)
            cursor.execute(CREATE_FTS)
        self.stdout.write("индексы HNSW и русский FTS на месте")

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT indexname FROM pg_indexes WHERE tablename = %s ORDER BY 1",
                [table],
            )
            names = [row[0] for row in cursor.fetchall()]
        self.stdout.write("\nиндексы в векторной базе:")
        for name in names:
            self.stdout.write(f"  {name}")

        self.stdout.write(
            self.style.SUCCESS(
                "\nГотово. Дальше: curriculum_move_vectors --dry-run, затем без него."
            )
        )

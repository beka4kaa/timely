"""Таблица кусков и оба её индекса, если их нет в базе.

Пока куски могли лежать во второй базе (`VECTOR_DB_URL`), в основной базе
таблицы `curriculum_knowledgechunk` могло не быть, хотя миграции `0001`–`0016`
записаны в ней как выполненные. Обычный `migrate` их не повторит. Эта миграция
ставит расширение `vector`, создаёт таблицу в историческом состоянии `0016`
(колонка `vector(1536)`) и оба индекса: HNSW из `0003` и русский полнотекстовый
из `0006`. Индексы строят функции тех миграций, SQL здесь не копируется.

Каждый шаг выполняется, только если его результата ещё нет. На базе, где
таблица и оба индекса на месте, миграция не выполняет ни одного DDL. Postgres
проверяет занятость таблицы и класс операторов раньше, чем `IF NOT EXISTS`,
поэтому безусловный `CREATE INDEX` падает:

- с «pending trigger events», если в той же транзакции уже вставлены куски:
  ждут отложенные проверки самоссылок `parent`, `previous` и `next`;
- с «operator class "vector_cosine_ops" does not accept data type halfvec»,
  когда колонка уже `halfvec` (после `0018`).

Обратная операция ничего не делает: таблица могла быть и до этой миграции, и
снести её при откате значит потерять куски.
"""

import importlib

from django.db import migrations

TABLE_NAME = "curriculum_knowledgechunk"


def _relation_exists(connection, name: str) -> bool:
    """Есть ли в схеме `public` таблица или индекс с таким именем."""
    with connection.cursor() as cursor:
        cursor.execute("select to_regclass(%s)", [f"public.{name}"])
        return cursor.fetchone()[0] is not None


def ensure_chunk_table(apps, schema_editor) -> None:
    """Расширение, таблица кусков и оба индекса: каждое, только если его нет."""
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return

    # Имена модулей миграций начинаются с цифры, обычный import их не возьмёт.
    m0003 = importlib.import_module("curriculum.migrations.0003_chunk_embeddings")
    m0006 = importlib.import_module("curriculum.migrations.0006_chunk_russian_fts_index")

    m0003.ensure_vector_extension(apps, schema_editor)

    if not _relation_exists(connection, TABLE_NAME):
        schema_editor.create_model(apps.get_model("curriculum", "KnowledgeChunk"))

    if not _relation_exists(connection, m0003.INDEX_NAME):
        m0003.create_hnsw_index(apps, schema_editor)
    if not _relation_exists(connection, m0006.INDEX_NAME):
        m0006.create_russian_fts_index(apps, schema_editor)


class Migration(migrations.Migration):

    dependencies = [
        ("curriculum", "0016_studymaterial_courseplan_material_and_more"),
    ]

    operations = [
        migrations.RunPython(
            ensure_chunk_table, migrations.RunPython.noop, elidable=False
        ),
    ]

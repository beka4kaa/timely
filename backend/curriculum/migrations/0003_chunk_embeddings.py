"""Векторы фрагментов: колонка, статус индексации и HNSW.

Три вещи в этой миграции зависят от бэкенда, и все три под гейтом
`connection.vendor == "postgresql"`: тесты проекта идут на SQLite, где нет ни
расширения `vector`, ни метода доступа `hnsw`.

Сама колонка `embedding` создаётся ВЕЗДЕ — SQLite принимает произвольное имя
типа и хранит значение как текст. Это сознательно: одна схема моделей на все
бэкенды, а различается только то, что физически невозможно на SQLite —
расширение, оператор `<=>` и индекс. Плотный поиск на SQLite не выполняется:
`get_dense_retriever()` там отдаёт прежний `InMemoryDenseRetriever`.

Индекс создаётся сырым SQL, а не через `AddIndex(HnswIndex(...))`, и в
`Meta.indexes` его нет намеренно. Иначе состояние миграций утверждало бы, что
индекс есть на любом бэкенде, и `makemigrations` бесконечно предлагал бы его
пересоздать на SQLite, где его быть не может.
"""

import pgvector.django.vector
from django.db import migrations, models

INDEX_NAME = "curriculum_chunk_embedding_hnsw"

# `vector_cosine_ops`, потому что ищем по косинусной близости (`<=>`).
# Оператор и класс операторов обязаны совпадать, иначе индекс просто не будет
# использован, а запрос молча уйдёт в полный перебор.
CREATE_INDEX_SQL = f"""
CREATE INDEX IF NOT EXISTS {INDEX_NAME}
ON curriculum_knowledgechunk
USING hnsw (embedding vector_cosine_ops)
"""

DROP_INDEX_SQL = f"DROP INDEX IF EXISTS {INDEX_NAME}"


def ensure_vector_extension(apps, schema_editor):
    """`CREATE EXTENSION vector`, но только если его действительно нет.

    Проверка перед созданием не косметическая: рабочая роль приложения обычно
    НЕ суперюзер. На сервере, где расширение уже поставил администратор,
    безусловный вызов уронил бы миграцию на ровном месте.

    Если расширения нет и поставить его нельзя, миграция падает ЗДЕСЬ с
    понятным текстом. Без этой проверки она падала бы на следующей операции с
    сообщением «type "vector" does not exist», по которому невозможно догадаться,
    что именно надо попросить у администратора базы.
    """
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        cursor.execute("select 1 from pg_extension where extname = 'vector'")
        if cursor.fetchone():
            return

        cursor.execute(
            "select 1 from pg_available_extensions where name = 'vector'"
        )
        if not cursor.fetchone():
            raise RuntimeError(
                "На этом сервере PostgreSQL нет расширения `vector`. "
                "Установить его может только администратор сервера "
                "(пакет pgvector), из миграции это невозможно."
            )

        try:
            cursor.execute("CREATE EXTENSION IF NOT EXISTS vector")
        except Exception as exc:  # noqa: BLE001 — переводим в понятный текст
            raise RuntimeError(
                "Расширение `vector` доступно, но текущая роль не может его "
                "установить. У управляемых баз (Northflank, RDS и подобные) "
                "pgvector помечен `trusted = false`, поэтому `CREATE EXTENSION` "
                "требует суперюзера. Попросите администратора выполнить "
                "`CREATE EXTENSION vector;` в этой базе и повторите миграцию. "
                f"Исходная ошибка: {exc}"
            ) from exc


def drop_vector_extension(apps, schema_editor):
    """Расширение при откате НЕ удаляем.

    Оно может обслуживать другие таблицы этой базы, и снос ради отката одной
    миграции — это потеря чужих данных.
    """
    return


def create_hnsw_index(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        cursor.execute(CREATE_INDEX_SQL)


def drop_hnsw_index(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        cursor.execute(DROP_INDEX_SQL)


class Migration(migrations.Migration):

    dependencies = [
        ("curriculum", "0002_ingestionjob_celery_task_id_ingestionjob_warnings"),
    ]

    operations = [
        # Расширение — первым: без типа `vector` следующая операция не выполнится.
        migrations.RunPython(
            ensure_vector_extension, drop_vector_extension, elidable=False
        ),
        migrations.AddField(
            model_name="knowledgechunk",
            name="embedded_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="knowledgechunk",
            name="embedding",
            field=pgvector.django.vector.VectorField(
                blank=True, dimensions=1536, null=True
            ),
        ),
        migrations.AddField(
            model_name="knowledgechunk",
            name="embedding_model",
            field=models.CharField(blank=True, default="", max_length=120),
        ),
        migrations.AlterField(
            model_name="knowledgechunk",
            name="embedding_status",
            field=models.CharField(
                choices=[
                    ("pending", "Ждёт вектора"),
                    ("ready", "Вектор посчитан"),
                    ("skipped", "Пропущен"),
                    ("failed", "Не удалось"),
                ],
                db_index=True,
                default="pending",
                max_length=16,
            ),
        ),
        migrations.AddIndex(
            model_name="knowledgechunk",
            index=models.Index(
                fields=["document", "embedding_status"],
                name="curriculum__documen_65c710_idx",
            ),
        ),
        # HNSW — последним: строится по уже существующей колонке.
        migrations.RunPython(create_hnsw_index, drop_hnsw_index, elidable=False),
    ]

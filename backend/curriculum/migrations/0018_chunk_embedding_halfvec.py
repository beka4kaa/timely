"""Вектор куска в половинной точности: колонка `embedding` становится `halfvec(1536)`.

Места под векторы вдвое меньше (2 байта на измерение вместо 4), качество поиска
не теряется. Пересчитывать векторы не нужно: старые значения Postgres приводит
сам, `AlterField` пишет `USING embedding::halfvec(1536)`.

Операции по порядку:

1. Проверка pgvector и снятие HNSW. Тип `halfvec` есть в pgvector с 0.7, и при
   старом расширении миграция падает с понятным текстом раньше любых изменений.
   Индекс по `vector_cosine_ops` снимается до смены типа: этот класс операторов
   не принимает `halfvec`, и `ALTER COLUMN TYPE` упал бы на перестройке индекса.
2. Смена типа колонки.
3. HNSW заново, теперь по `halfvec_cosine_ops`. Класс операторов индекса обязан
   совпадать с типом колонки, иначе запрос с `<=>` молча уходит в полный
   перебор.

Расширение миграция не обновляет. Пересборка образа Postgres меняет только
`default_version`, а `extversion` стоящего расширения меняет одна команда
`ALTER EXTENSION vector UPDATE`, её выполняют в базе руками.

Откат идёт в обратном порядке: снять индекс по `halfvec`, вернуть колонке тип
`vector(1536)` и построить индекс функцией `0003`, как он был.
"""

import importlib
import re

import pgvector.django.halfvec
from django.db import migrations

# Имя то же, что у индекса из `0003`: снимается именно он, а `0017` по этому
# имени проверяет, есть ли индекс.
INDEX_NAME = "curriculum_chunk_embedding_hnsw"

CREATE_HALFVEC_INDEX_SQL = f"""
CREATE INDEX IF NOT EXISTS {INDEX_NAME}
ON curriculum_knowledgechunk
USING hnsw (embedding halfvec_cosine_ops)
"""

DROP_INDEX_SQL = f"DROP INDEX IF EXISTS {INDEX_NAME}"


def pgvector_version(text: str) -> tuple[int, ...]:
    """'0.8.0' → (0, 8). Строки сравнивать нельзя: '0.10.0' < '0.7.0'."""
    return tuple(int(part) for part in re.findall(r"\d+", text)[:2])


def require_halfvec_and_drop_index(apps, schema_editor):
    """Нужен pgvector 0.7+, иначе стоп до любых изменений. Затем снять HNSW."""
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        cursor.execute("select extversion from pg_extension where extname = 'vector'")
        row = cursor.fetchone()
        if row is None or pgvector_version(row[0]) < (0, 7):
            raise RuntimeError(
                f"pgvector ({row[0] if row else 'не установлен'}) не умеет halfvec, нужен 0.7+. "
                "Если default_version в pg_available_extensions ниже 0.7, сначала пересоберите "
                "сервис Postgres на свежем образе postgres-ssl той же основной версии. "
                "Затем выполните в базе ALTER EXTENSION vector UPDATE; и повторите выкладку."
            )
        cursor.execute(DROP_INDEX_SQL)


def restore_vector_index(apps, schema_editor):
    """Откат: HNSW по `vector_cosine_ops`, как его строит `0003`."""
    # Имена модулей миграций начинаются с цифры, обычный import их не возьмёт.
    m0003 = importlib.import_module("curriculum.migrations.0003_chunk_embeddings")
    m0003.create_hnsw_index(apps, schema_editor)


def create_halfvec_index(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        cursor.execute(CREATE_HALFVEC_INDEX_SQL)


def drop_halfvec_index(apps, schema_editor):
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        cursor.execute(DROP_INDEX_SQL)


class Migration(migrations.Migration):

    dependencies = [
        ("curriculum", "0017_chunk_table_if_missing"),
    ]

    operations = [
        migrations.RunPython(
            require_halfvec_and_drop_index, restore_vector_index, elidable=False
        ),
        migrations.AlterField(
            model_name="knowledgechunk",
            name="embedding",
            field=pgvector.django.halfvec.HalfVectorField(
                blank=True, dimensions=1536, null=True
            ),
        ),
        migrations.RunPython(
            create_halfvec_index, drop_halfvec_index, elidable=False
        ),
    ]

"""Ссылки чанка на документ, раздел и задачу перестают быть внешними ключами.

Таблица чанков уезжает в отдельную базу на своё железо
(см. `curriculum/routers.py`): рост идёт почти целиком в ней — около 40 МБ на
учебник вместе с индексами. Django не поддерживает связи между базами, поэтому
`document`, `section` и `task` становятся обычными UUID-полями. Самоссылки
(`parent`/`previous`/`next`) остаются внешними ключами: они внутри одной базы.

**Миграция написана руками намеренно.** `makemigrations` на такой правке
предлагает `RemoveField` + `AddField`, а это `DROP COLUMN` — то есть потеря всех
векторов. Здесь же меняется только состояние Django, а в базе снимаются три
ограничения. Колонки не трогаются: `document_id`, `section_id` и `task_id` уже
имеют тип `uuid` (первичные ключи всех трёх моделей — UUID), их содержимое
остаётся ровно тем же.

Индексы тоже не пересоздаются: их имена закреплены в `Meta` явно.
"""

from django.db import migrations, models

# Имена ограничений в боевой базе. Django строит их из имени таблицы, колонки и
# хеша, поэтому вычислить их на лету нельзя — они выписаны из `pg_constraint`.
FOREIGN_KEYS_TO_DROP = (
    "curriculum_knowledge_document_id_d1d8acde_fk_curriculu",
    "curriculum_knowledge_section_id_174ebcd1_fk_curriculu",
    "curriculum_knowledge_task_id_b8d66bcf_fk_curriculu",
)


def drop_cross_database_foreign_keys(apps, schema_editor):
    """Снимает три ограничения. Колонки и данные не трогаются.

    Только PostgreSQL: на SQLite ограничение нельзя снять без перестроения
    таблицы, а тестовая база и так создаётся с нуля. Оставшийся там внешний ключ
    безвреден — тесты всегда создают настоящий документ, а удаление документа
    каскадом лишь дублирует работу сигнала.
    """
    connection = schema_editor.connection
    if connection.vendor != "postgresql":
        return
    with connection.cursor() as cursor:
        for name in FOREIGN_KEYS_TO_DROP:
            # IF EXISTS: миграция должна проходить и на базе, где таблицу уже
            # создали заново (например, на свежей векторной базе).
            cursor.execute(
                f'ALTER TABLE curriculum_knowledgechunk '
                f'DROP CONSTRAINT IF EXISTS "{name}"'
            )


def restore_cross_database_foreign_keys(apps, schema_editor):
    """Откат не восстанавливает ключи.

    Вернуть их можно только если данные снова лежат в одной базе. Молча создать
    ограничение, которое сошлётся на таблицу в другой базе, нельзя — оно просто
    не создастся. Возврат делается осознанно, вместе с переносом данных обратно.
    """
    return


class Migration(migrations.Migration):

    dependencies = [
        ("curriculum", "0006_chunk_russian_fts_index"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    drop_cross_database_foreign_keys,
                    restore_cross_database_foreign_keys,
                    elidable=False,
                ),
            ],
            state_operations=[
                # Индексы лежат на ТЕХ ЖЕ колонках и с теми же именами, но в
                # состоянии Django описаны через старые поля. Пересоздание —
                # только в состоянии: в базе им ничего делать не нужно.
                migrations.RemoveIndex(
                    model_name="knowledgechunk", name="curriculum__documen_3069a9_idx"
                ),
                migrations.RemoveIndex(
                    model_name="knowledgechunk", name="curriculum__documen_161724_idx"
                ),
                migrations.RemoveIndex(
                    model_name="knowledgechunk", name="curriculum__documen_65c710_idx"
                ),
                migrations.RemoveField(model_name="knowledgechunk", name="document"),
                migrations.RemoveField(model_name="knowledgechunk", name="section"),
                migrations.RemoveField(model_name="knowledgechunk", name="task"),
                migrations.AddField(
                    model_name="knowledgechunk",
                    name="document_id",
                    field=models.UUIDField(db_index=True, default=None),
                    preserve_default=False,
                ),
                migrations.AddField(
                    model_name="knowledgechunk",
                    name="section_id",
                    field=models.UUIDField(blank=True, db_index=True, null=True),
                ),
                migrations.AddField(
                    model_name="knowledgechunk",
                    name="task_id",
                    field=models.UUIDField(blank=True, db_index=True, null=True),
                ),
                migrations.AddIndex(
                    model_name="knowledgechunk",
                    index=models.Index(
                        fields=["document_id", "chunk_type"],
                        name="curriculum__documen_3069a9_idx",
                    ),
                ),
                migrations.AddIndex(
                    model_name="knowledgechunk",
                    index=models.Index(
                        fields=["document_id", "page_start"],
                        name="curriculum__documen_161724_idx",
                    ),
                ),
                migrations.AddIndex(
                    model_name="knowledgechunk",
                    index=models.Index(
                        fields=["document_id", "embedding_status"],
                        name="curriculum__documen_65c710_idx",
                    ),
                ),
            ],
        ),
    ]

from django.db import migrations


INDEX_NAME = "curriculum_chunk_fts_ru_gin"


def create_russian_fts_index(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute(
        f"""
        CREATE INDEX IF NOT EXISTS {INDEX_NAME}
        ON curriculum_knowledgechunk
        USING GIN (
            to_tsvector('russian', COALESCE(normalized_text, ''))
        )
        """
    )


def drop_russian_fts_index(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    schema_editor.execute(f"DROP INDEX IF EXISTS {INDEX_NAME}")


class Migration(migrations.Migration):
    dependencies = [("curriculum", "0005_queued_ingestion_status")]

    operations = [
        migrations.RunPython(
            create_russian_fts_index,
            reverse_code=drop_russian_fts_index,
        )
    ]

from django.db import migrations, models

# Метка, с которой `curriculum.embeddings` пишет расход эмбеддингов. Строка
# записана здесь, а не импортирована: миграция должна делать то же, что в день
# выкладки, даже если код потом поменяется. Совпадение с кодом держит тест
# `test_migration_backfills_the_feature_embed_records` в curriculum.
EMBEDDING_FEATURE = "curriculum_embedding"


def mark_embeddings_unmetered(apps, schema_editor):
    """События эмбеддингов, записанные до выкладки, тоже выходят из окон лимита.

    Иначе они считались бы до 5 часов в коротком окне и до понедельника в
    недельном. Дата не важна: история и окна должны показывать одно и то же.
    """
    AIUsageEvent = apps.get_model("ai_engine", "AIUsageEvent")
    AIUsageEvent.objects.filter(feature=EMBEDDING_FEATURE).update(metered=False)


class Migration(migrations.Migration):

    dependencies = [
        ("ai_engine", "0009_aiusagequotastate"),
    ]

    operations = [
        migrations.AddField(
            model_name="aiusageevent",
            name="metered",
            field=models.BooleanField(db_default=True, default=True),
        ),
        migrations.RunPython(mark_embeddings_unmetered, migrations.RunPython.noop),
    ]

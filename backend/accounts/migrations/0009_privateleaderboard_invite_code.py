"""Код группы, шаг первый из трёх: пустое поле.

Уникальность приходит последней, а данные живут в своей миграции: на PostgreSQL
изменение данных и схемы в одной транзакции может упасть на «pending trigger events».
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0008_customuser_show_in_leaderboard")]

    operations = [
        migrations.AddField(
            model_name="privateleaderboard",
            name="invite_code",
            field=models.CharField(editable=False, max_length=10, null=True),
        ),
    ]

"""Показ в рейтинге только по согласию.

Новый аккаунт теперь скрыт, пока ученик сам не включит показ. Строки, которые уже
есть, остаются видимыми: это решение, а не умолчание. Они сегодня в рейтинге, и
молча убрать их значило бы сломать чужие места и группы. Выключить показ каждый
может в настройках.

Обратной операции у backfill нет: при откате схемы поле исчезает вместе со
значениями, и восстанавливать нечего.
"""

from django.db import migrations, models


def keep_existing_visible(apps, schema_editor):
    CustomUser = apps.get_model("accounts", "CustomUser")
    CustomUser.objects.update(show_in_leaderboard=True)


class Migration(migrations.Migration):
    dependencies = [("accounts", "0007_customuser_bio")]

    operations = [
        migrations.AddField(
            model_name="customuser",
            name="show_in_leaderboard",
            field=models.BooleanField(default=False),
        ),
        migrations.RunPython(keep_existing_visible, migrations.RunPython.noop),
    ]

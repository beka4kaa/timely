"""Разделы открыты по умолчанию.

Флаг `has_full_access` задумывался как выдача доступа, а работал как запрет:
умолчание `False` закрывало «План», «Курс» и ещё восемь страниц каждому, кто
завёлся в Django, пока админ не щёлкнет тумблер вручную. Теперь наоборот —
открыто, а флаг нужен, чтобы закрыть.

Backfill обязателен: уже существующие строки остались бы с `False`, а для
интерфейса это неотличимо от осознанного запрета, и такие аккаунты продолжили
бы упираться в ту же стену.

Обратной операции у backfill нет намеренно. Вернуть всем `False` значило бы
затереть и те запреты, которые кто-то поставил руками, — откат схемы такой
ценой не окупается.
"""

from django.db import migrations, models


def open_access(apps, schema_editor):
    CustomUser = apps.get_model("accounts", "CustomUser")
    CustomUser.objects.filter(has_full_access=False).update(has_full_access=True)


class Migration(migrations.Migration):
    dependencies = [("accounts", "0005_customuser_ai_plan")]

    operations = [
        migrations.AlterField(
            model_name="customuser",
            name="has_full_access",
            field=models.BooleanField(db_index=True, default=True),
        ),
        migrations.RunPython(open_access, migrations.RunPython.noop),
    ]

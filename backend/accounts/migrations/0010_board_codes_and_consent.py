"""В группу вступают только сами, поэтому в старых группах остаётся один создатель.

Раньше создатель мог добавить любого, и никого из добавленных не спрашивали. Оставить
их значило бы оставить и эту запись, и группу с чужим названием у них в списке. Уйти
из такой группы было нельзя. Кто захочет обратно, вступит по коду.

Обратной операции нет намеренно: снять согласие можно, а выдать его задним числом нельзя.
"""

from django.db import migrations

from accounts.models import new_invite_code


def give_codes_and_keep_only_owners(apps, schema_editor):
    PrivateLeaderboard = apps.get_model("accounts", "PrivateLeaderboard")
    for board in PrivateLeaderboard.objects.all():
        board.invite_code = new_invite_code()
        board.save(update_fields=["invite_code"])
        board.members.set([board.owner_id])


class Migration(migrations.Migration):
    dependencies = [("accounts", "0009_privateleaderboard_invite_code")]

    operations = [
        migrations.RunPython(give_codes_and_keep_only_owners, migrations.RunPython.noop),
    ]

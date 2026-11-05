from django.db import migrations, models

import accounts.models


class Migration(migrations.Migration):
    dependencies = [("accounts", "0010_board_codes_and_consent")]

    operations = [
        migrations.AlterField(
            model_name="privateleaderboard",
            name="invite_code",
            field=models.CharField(
                default=accounts.models.new_invite_code, editable=False, max_length=10, unique=True
            ),
        ),
    ]

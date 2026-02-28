from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('diary', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='weeklytemplate',
            name='custom_presets',
            field=models.JSONField(default=list),
        ),
    ]

# Generated manually - add user_email to Subject and MindSession

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('mind', '0002_alter_mindsession_id_alter_reviewlog_id_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='subject',
            name='user_email',
            field=models.EmailField(blank=True, db_index=True, max_length=254, null=True),
        ),
        migrations.AddField(
            model_name='mindsession',
            name='user_email',
            field=models.EmailField(blank=True, db_index=True, max_length=254, null=True),
        ),
    ]

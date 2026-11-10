from django.db import migrations, models
from django.db.models import Count, Min


def drop_copies(apps, schema_editor):
    """
    Одна и та же фаза могла записаться не раз: две вкладки сразу или повторная
    отправка после потерянного ответа. Перед уникальным индексом оставляем первую
    запись каждой фазы, остальные убираем: иначе индекс не встанет, а время фокуса
    так и было бы посчитано дважды.
    """
    Session = apps.get_model('pomodoro', 'FocusSession')
    if schema_editor.connection.vendor == 'postgresql':
        # Пока новый контейнер мигрирует, старый ещё принимает запросы. Блокировка
        # останавливает запись в таблицу до конца миграции (чтение идёт), иначе копия,
        # вставленная между чисткой и индексом, сорвала бы создание индекса.
        table = schema_editor.quote_name(Session._meta.db_table)
        schema_editor.execute(f'LOCK TABLE {table} IN SHARE ROW EXCLUSIVE MODE')

    copies = (
        Session.objects.order_by()
        .values('user_email', 'kind', 'started_at')
        .annotate(total=Count('id'), keep=Min('id'))
        .filter(total__gt=1)
    )
    for group in copies:
        Session.objects.filter(
            user_email=group['user_email'],
            kind=group['kind'],
            started_at=group['started_at'],
        ).exclude(pk=group['keep']).delete()


class Migration(migrations.Migration):

    dependencies = [
        ('pomodoro', '0001_initial'),
    ]

    operations = [
        # Обратно копии не возвращаем: откат просто снимает индекс.
        migrations.RunPython(drop_copies, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='focussession',
            constraint=models.UniqueConstraint(
                fields=('user_email', 'kind', 'started_at'),
                name='pomodoro_session_once',
            ),
        ),
    ]

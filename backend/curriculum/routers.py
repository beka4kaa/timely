"""Маршрутизация векторной таблицы в отдельную базу.

В `vector_db` уезжает ровно одна модель — `KnowledgeChunk`. Она и есть то, что
растёт: 897 чанков занимают 23 МБ таблицы плюс 12 МБ индексов, около 40 МБ на
учебник. Остальные модели остаются в `default`.

**Почему роутера мало и пришлось разорвать связи.** Django не поддерживает
внешние ключи между базами. Пока `KnowledgeChunk.document` был `ForeignKey`,
одного роутера хватило бы ровно до первого обращения: `chunk.document` пошёл бы
искать таблицу документов в `vector_db`, где её нет, а `Document.delete()`
собрал бы каскад в своей базе и оставил чанки сиротами. Поэтому `document`,
`section` и `task` теперь обычные `UUIDField`, а целостность держит сигнал в
`curriculum/signals.py`. Самоссылки (`parent`/`previous`/`next`) остались
внешними ключами: они внутри одной базы и проблемы не создают.

**Пустой `VECTOR_DB_URL` выключает роутер целиком.** Тогда `vector_db` — копия
`default`, и приложение ведёт себя как однобазовое. Это режим тестов и локальной
разработки: гонять их через домашний ПК в tailnet было бы и медленно, и
ненадёжно.
"""

from __future__ import annotations

from django.conf import settings

# Одна модель, а не всё приложение. Список, а не строка, — чтобы добавление
# второй векторной таблицы не превращалось в правку логики.
VECTOR_MODELS = frozenset({"knowledgechunk"})

VECTOR_APP_LABEL = "curriculum"


def _alias() -> str:
    return getattr(settings, "VECTOR_DB_ALIAS", "vector_db")


def _enabled() -> bool:
    """Роутер работает, только когда вторая база действительно настроена."""
    return bool(getattr(settings, "VECTOR_DB_CONFIGURED", False))


def _is_vector_model(model) -> bool:
    return (
        model._meta.app_label == VECTOR_APP_LABEL
        and model._meta.model_name in VECTOR_MODELS
    )


class VectorDatabaseRouter:
    """Отправляет `KnowledgeChunk` в `vector_db`, остальное — как было."""

    def db_for_read(self, model, **hints):
        if _enabled() and _is_vector_model(model):
            return _alias()
        return None

    def db_for_write(self, model, **hints):
        if _enabled() and _is_vector_model(model):
            return _alias()
        return None

    def allow_relation(self, obj1, obj2, **hints):
        """Связь между базами запрещена явно.

        Возврат `None` («решай сам») здесь опаснее: Django счёл бы связь
        допустимой, и забытый внешний ключ проявился бы не отказом, а тихим
        запросом не в ту базу. Пусть падает громко.
        """
        if not _enabled():
            return None
        vector_1 = _is_vector_model(obj1.__class__)
        vector_2 = _is_vector_model(obj2.__class__)
        if vector_1 != vector_2:
            return False
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        """Таблица чанков создаётся только в `vector_db`, прочее — только в `default`.

        Без этого `migrate --database=vector_db` создал бы на домашнем ПК все
        таблицы проекта, а в основной базе осталась бы неиспользуемая таблица
        чанков — два места с одной и той же схемой и ни одного источника правды.
        """
        if not _enabled():
            return None

        is_vector_table = (
            app_label == VECTOR_APP_LABEL
            and (model_name or "") in VECTOR_MODELS
        )
        if is_vector_table:
            return db == _alias()
        if db == _alias():
            # В векторной базе не место ничему, кроме векторной таблицы.
            return False
        return None

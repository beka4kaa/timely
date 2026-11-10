from django.apps import AppConfig


class DemoConfig(AppConfig):
    """Демо для проверяющих акселератора: свой мир и свой ученик на посетителя.

    Приложение стоит всегда, но работает только при `settings.DEMO_MODE`. Моделей
    у него нет: всё, что оно создаёт, лежит в обычных таблицах остальных приложений.
    """

    default_auto_field = "django.db.models.BigAutoField"
    name = "demo"

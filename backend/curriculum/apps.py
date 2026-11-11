from django.apps import AppConfig


class CurriculumConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'curriculum'
    verbose_name = 'Учебные цели, источники и программы'

    def ready(self) -> None:
        # Подключает сигналы кусков: у них нет внешних ключей на документ, раздел
        # и задачу, поэтому каскада СУБД нет — см. `curriculum/signals.py`.
        from . import signals  # noqa: F401  — импорт ради регистрации обработчика

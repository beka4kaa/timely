from django.apps import AppConfig


class CurriculumConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'curriculum'
    verbose_name = 'Учебные цели, источники и программы'

    def ready(self) -> None:
        # Подключает удаление чанков вслед за документом. У чанков больше нет
        # внешнего ключа на документ (они в отдельной базе), поэтому каскад СУБД
        # их не уносит — см. `curriculum/signals.py`.
        from . import signals  # noqa: F401  — импорт ради регистрации обработчика

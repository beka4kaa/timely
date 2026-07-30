from django.db import models


class FocusSession(models.Model):
    """
    Одна завершённая фаза помодоро — фокус или перерыв.

    Пишется только когда фаза закончилась (естественно или досрочно) и длилась
    не меньше минуты. Длина пресета хранится в минутах, а не индексом: набор
    ритмов со временем изменится, а старая история должна остаться читаемой.
    """

    FOCUS = 'focus'
    BREAK = 'break'
    KIND_CHOICES = [
        (FOCUS, 'Фокус'),
        (BREAK, 'Перерыв'),
    ]

    user_email = models.EmailField(db_index=True)
    kind = models.CharField(max_length=8, choices=KIND_CHOICES, default=FOCUS)
    # Момент начала фазы присылает клиент: таймер может закончиться, пока
    # вкладка свёрнута, а отправиться — заметно позже.
    started_at = models.DateTimeField(db_index=True)
    seconds = models.PositiveIntegerField()
    planned_seconds = models.PositiveIntegerField()
    preset_focus_min = models.PositiveSmallIntegerField()
    preset_break_min = models.PositiveSmallIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-started_at']
        indexes = [models.Index(fields=['user_email', '-started_at'])]

    def __str__(self) -> str:
        return f'{self.user_email} · {self.kind} · {self.seconds}s'

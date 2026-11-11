"""
Интервальное повторение темы по FSRS: чистый расчёт.

Зачем модуль
────────────
Один алгоритм повторения на весь проект: кнопки повторения
(`TopicViewSet.review`), инструмент тьютора `schedule_review` и подписи сроков
на кнопках считают здесь. Раньше это был упрощённый SM-2: он не смотрел, сколько
дней реально прошло, а после нескольких «не вспомнил» ease_factor застревал на
1,3 и тема навсегда оставалась с интервалом в два дня.

Формулы не наши. Считает официальный пакет `fsrs` (open-spaced-repetition, MIT),
версия закреплена в requirements.txt. Здесь только перевод полей темы в его
карточку и обратно, и четыре решения о настройке планировщика:

* шагов обучения в минутах нет (`learning_steps=()`, `relearning_steps=()`).
  Тему повторяют на «Сейчас» и в плане по дням: «вернуть через 10 минут» там
  означало бы, что тема тут же снова висит просроченной. Пакет поддерживает это
  явно, и любая оценка сразу даёт срок в днях;
* без случайного разброса сроков (`enable_fuzzing=False`). Иначе функция
  перестала бы быть чистой, а тем у ученика десятки, а не тысячи карточек;
* срок не длиннее учебного года (`maximum_interval=365` вместо 36500 дней
  пакета). Тема, которую не трогали дольше, по сути новая;
* веса по умолчанию пакета. Подбирать их под учеников Timely будем по журналу
  повторений (`LearningEvent` с `activity="review"`), когда их наберётся
  несколько тысяч.

Функция чистая: ни БД, ни `now()`. Момент приходит аргументом, поэтому поведение
проверяется таблицей (`mind/tests.py`).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

from fsrs import Card, Rating, Scheduler, State
from fsrs.scheduler import MAX_DIFFICULTY, MIN_DIFFICULTY, STABILITY_MIN

# Оценки повторения, как их присылает фронтенд (`mind/topics/{id}/review/`).
# Подписи на кнопках, от худшей к лучшей: «Не вспомнил», «С трудом», «Вспомнил», «Легко».
RATING_AGAIN = "AGAIN"
RATING_HARD = "HARD"
RATING_GOOD = "GOOD"
RATING_EASY = "EASY"

REVIEW_RATINGS = (RATING_AGAIN, RATING_HARD, RATING_GOOD, RATING_EASY)

_FSRS_RATINGS = {
    RATING_AGAIN: Rating.Again,
    RATING_HARD: Rating.Hard,
    RATING_GOOD: Rating.Good,
    RATING_EASY: Rating.Easy,
}

# Цель вспоминания. 0,9 — умолчание пакета. Перед контрольной 0,95: срок короче,
# повторения сами становятся чаще (`mind/reviews.py`).
DEFAULT_DESIRED_RETENTION = 0.9
EXAM_DESIRED_RETENTION = 0.95
# Разумные края цели. Вне их настройка считается ошибкой и заменяется умолчанием.
MIN_DESIRED_RETENTION = 0.7
MAX_DESIRED_RETENTION = 0.99

# `mind.Topic.fsrs_state` хранит `fsrs.State` как есть. У новой темы Learning:
# так в пакете выглядит карточка, которую ещё ни разу не оценивали. Шагов
# обучения нет, поэтому после первой же оценки тема навсегда в Review.
STATE_NEW = int(State.Learning)
STATE_REVIEW = int(State.Review)

# Статусы темы (mind.Topic.STATUS_CHOICES) выводятся из устойчивости: сколько дней
# память держится на 90%. Неделя и три недели совпадают со старыми шагами плана
# 7 и 21 день. По весам пакета первое «Легко» (8,3 дня) сразу даёт SUCCESS, как и
# в прежнем расчёте, а три «Вспомнил» вовремя доводят тему до MASTERED.
#
# Успешный ответ («С трудом», «Вспомнил», «Легко») статус не понижает: тему могли
# отметить «усвоено» руками, и «Вспомнил» не повод сказать «знаю немного». Статус
# из устойчивости заново ставит только «Не вспомнил».
STATUS_NOT_STARTED = "NOT_STARTED"
STATUS_MEDIUM = "MEDIUM"
STATUS_SUCCESS = "SUCCESS"
STATUS_MASTERED = "MASTERED"
SUCCESS_STABILITY_DAYS = 7
MASTERED_STABILITY_DAYS = 21
_STATUS_RANK = {STATUS_NOT_STARTED: 0, STATUS_MEDIUM: 1, STATUS_SUCCESS: 2, STATUS_MASTERED: 3}

# Старые поля SM-2 остаются для чтения (фильтр слабых тем `ease_factor < 2`,
# сводка тьютора) и для отката. `ease_factor` отражает сложность FSRS по той же
# прямой, что и миграция 0005, только в обратную сторону: 3,0 ↔ 1, 1,3 ↔ 10.
MIN_EASE_FACTOR = 1.3
MAX_EASE_FACTOR = 3.0

# Потолок срока вместо 36500 дней пакета. Веса по умолчанию растят срок быстро:
# пятое «Вспомнил» подряд дало бы 497 дней.
MAX_INTERVAL_DAYS = 365

# Пакету нужен id карточки. Без него конструктор спит миллисекунду, чтобы id из
# времени не совпали; нам id не нужен вовсе.
_CARD_ID = 0


@dataclass(frozen=True)
class TopicMemory:
    """Что тема помнит о прошлых повторениях. Поля `mind.Topic`, без Django."""

    stability: float | None = None
    difficulty: float | None = None
    state: int = STATE_NEW
    reps: int = 0
    lapses: int = 0
    last_review: datetime | None = None
    # Статус темы сейчас: успешный ответ его не понижает.
    status: str = STATUS_NOT_STARTED

    @property
    def is_new(self) -> bool:
        """Памяти нет. Без даты прошлого повторения шанс вспомнить не посчитать.

        Испорченные числа (NaN, бесконечность) тоже считаются отсутствием памяти:
        поля темы можно править PATCH'ем, и формулы пакета на них бы упали.
        """
        if self.stability is None or self.difficulty is None or self.last_review is None:
            return True
        return not (math.isfinite(self.stability) and math.isfinite(self.difficulty))


@dataclass(frozen=True)
class ReviewOutcome:
    """Что должно стать с темой после повторения."""

    rating: str
    reviewed_at: datetime
    stability: float
    difficulty: float
    state: int
    reps: int
    lapses: int
    interval_days: int
    next_review_at: datetime
    status: str
    ease_factor: float
    # Шанс вспомнить в момент ответа, до оценки. `None` у новой темы.
    recall_probability: float | None
    desired_retention: float

    def memory(self) -> TopicMemory:
        """Память темы после этого повторения: для следующего расчёта."""
        return TopicMemory(
            stability=self.stability,
            difficulty=self.difficulty,
            state=self.state,
            reps=self.reps,
            lapses=self.lapses,
            last_review=self.reviewed_at,
            status=self.status,
        )


def normalize_rating(value: Any) -> str:
    """Оценка из запроса. Неизвестная считается «Вспомнил», как и раньше во вью."""
    text = str(value or "").strip().upper()
    return text if text in _FSRS_RATINGS else RATING_GOOD


def clean_retention(value: Any) -> float:
    """Цель вспоминания из настройки. Не число или вне 0,7–0,99 — умолчание 0,9.

    Настройка приходит строкой из окружения: «0,95» с запятой тоже число, а пустая
    строка значит «не задано».
    """
    if isinstance(value, str):
        value = value.strip().replace(",", ".")
    try:
        number = float(value)
    except (TypeError, ValueError):
        return DEFAULT_DESIRED_RETENTION
    if math.isnan(number) or not MIN_DESIRED_RETENTION <= number <= MAX_DESIRED_RETENTION:
        return DEFAULT_DESIRED_RETENTION
    return number


def status_from_stability(stability: float | None) -> str:
    """Статус темы для страницы слабых тем."""
    if stability is None:
        return STATUS_NOT_STARTED
    if stability >= MASTERED_STABILITY_DAYS:
        return STATUS_MASTERED
    if stability >= SUCCESS_STABILITY_DAYS:
        return STATUS_SUCCESS
    return STATUS_MEDIUM


def _status_after(rating: str, current: str, stability: float) -> str:
    """«Не вспомнил» ставит статус из устойчивости, успешный ответ его не понижает."""
    derived = status_from_stability(stability)
    if rating == RATING_AGAIN:
        return derived
    return current if _STATUS_RANK.get(current, 0) > _STATUS_RANK[derived] else derived


def ease_from_difficulty(difficulty: float) -> float:
    """Сложность FSRS (1–10) → ease_factor SM-2 (3,0–1,3). Обратная прямая миграции 0005."""
    share = (min(max(difficulty, MIN_DIFFICULTY), MAX_DIFFICULTY) - MIN_DIFFICULTY) / (
        MAX_DIFFICULTY - MIN_DIFFICULTY
    )
    return round(MAX_EASE_FACTOR - share * (MAX_EASE_FACTOR - MIN_EASE_FACTOR), 4)


def memory_of(topic: Any) -> TopicMemory:
    """Память из объекта с полями `mind.Topic`. Без импорта Django: годится и для тестов."""
    return TopicMemory(
        stability=getattr(topic, "fsrs_stability", None),
        difficulty=getattr(topic, "fsrs_difficulty", None),
        state=getattr(topic, "fsrs_state", None) or STATE_NEW,
        reps=getattr(topic, "fsrs_reps", None) or 0,
        lapses=getattr(topic, "fsrs_lapses", None) or 0,
        last_review=getattr(topic, "last_revised_at", None),
        status=getattr(topic, "status", None) or STATUS_NOT_STARTED,
    )


@lru_cache(maxsize=None)
def _scheduler(desired_retention: float) -> Scheduler:
    return Scheduler(
        desired_retention=desired_retention,
        learning_steps=(),
        relearning_steps=(),
        # Учебный год: тема, которую не трогали дольше, по сути новая.
        maximum_interval=MAX_INTERVAL_DAYS,
        enable_fuzzing=False,
    )


def _utc(moment: datetime) -> datetime:
    # Пакет принимает только UTC и сравнивает зону строго: `ZoneInfo("UTC")` из базы
    # он бы отверг. Наивное время — ошибка вызывающего кода, а не повод гадать зону.
    if moment.tzinfo is None:
        raise ValueError("Момент повторения должен быть с часовым поясом")
    return moment.astimezone(timezone.utc)


def _card(memory: TopicMemory, moment: datetime) -> Card:
    if memory.is_new:
        return Card(card_id=_CARD_ID, state=State.Learning, due=moment)
    return Card(
        card_id=_CARD_ID,
        state=State.Review,
        stability=max(float(memory.stability), STABILITY_MIN),
        difficulty=min(max(float(memory.difficulty), MIN_DIFFICULTY), MAX_DIFFICULTY),
        due=moment,
        last_review=_utc(memory.last_review),
    )


def recall_probability(memory: TopicMemory, now: datetime) -> float | None:
    """Шанс вспомнить тему в момент `now`. `None`, если тему ещё не повторяли.

    Число внутреннее: по нему сортируются темы, а ученику оно не показывается.
    """
    if memory.is_new:
        return None
    moment = _utc(now)
    return _scheduler(DEFAULT_DESIRED_RETENTION).get_card_retrievability(_card(memory, moment), moment)


def next_review(
    *,
    rating: Any,
    memory: TopicMemory,
    now: datetime,
    desired_retention: float = DEFAULT_DESIRED_RETENTION,
    next_test: date | None = None,
) -> ReviewOutcome:
    """Посчитать память и срок темы после оценки `rating` в момент `now`.

    `next_test` — ближайшая контрольная по предмету темы после сегодняшнего дня. Если
    она приходится на срок FSRS или раньше, тема вернётся за день до неё, но не
    раньше завтрашнего дня: иначе повторение перескочило бы через контрольную. Дни
    считаются в UTC, как и окно контрольных на сервере (`TIME_ZONE = "UTC"`).
    """
    moment = _utc(now)
    name = normalize_rating(rating)
    retention = clean_retention(desired_retention)
    scheduler = _scheduler(retention)

    card = _card(memory, moment)
    before = None if memory.is_new else scheduler.get_card_retrievability(card, moment)
    reviewed, _log = scheduler.review_card(card, _FSRS_RATINGS[name], review_datetime=moment)

    stability = float(reviewed.stability)
    difficulty = float(reviewed.difficulty)
    # Забыть можно только то, что уже держалось: первое «не вспомнил» не провал.
    lapse = 1 if name == RATING_AGAIN and not memory.is_new else 0
    interval = (reviewed.due - moment).days
    if next_test is not None:
        review_day = moment.date()
        if review_day < next_test <= review_day + timedelta(days=interval):
            interval = max(1, (next_test - review_day).days - 1)
    return ReviewOutcome(
        rating=name,
        reviewed_at=moment,
        stability=stability,
        difficulty=difficulty,
        state=int(reviewed.state),
        reps=memory.reps + 1,
        lapses=memory.lapses + lapse,
        interval_days=interval,
        next_review_at=moment + timedelta(days=interval),
        status=_status_after(name, memory.status, stability),
        ease_factor=ease_from_difficulty(difficulty),
        recall_probability=before,
        desired_retention=retention,
    )


def preview_intervals(
    memory: TopicMemory,
    now: datetime,
    desired_retention: float = DEFAULT_DESIRED_RETENTION,
    next_test: date | None = None,
) -> dict[str, int]:
    """Через сколько дней вернётся тема при каждой оценке: подпись на кнопке."""
    return {
        rating: next_review(
            rating=rating,
            memory=memory,
            now=now,
            desired_retention=desired_retention,
            next_test=next_test,
        ).interval_days
        for rating in REVIEW_RATINGS
    }

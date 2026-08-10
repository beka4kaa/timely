"""Сколько времени займёт тема. Считает backend, а не модель.

Модель возвращала одно и то же число для каждой темы: на «Механике» Мякишева
все 518 тем получили ровно по 45 минут, что дало 388 часов на школьный курс.
Это не оценка, а заполнение обязательного поля — у модели просто нет данных,
чтобы ответить иначе: она видит заголовки, а не объём материала.

У backend'а данные есть. После разбора оглавления известно, сколько страниц
занимает каждый раздел, какая у него роль и на каком он уровне. Из этого
получается число, которое хотя бы отличается для главы на две страницы и для
главы на сорок.

Модуль чистый: ни Django, ни сети. Коэффициенты собраны в одном месте и
покрыты тестами — иначе «магические» множители расползаются по коду и
перестают поддаваться проверке.
"""

from __future__ import annotations

from dataclasses import dataclass

# Базовая скорость работы с учебной страницей: прочитать, понять, разобрать
# пример. Не скорость чтения художественного текста — страница физики с
# выводом формулы требует возвратов и пересчётов.
BASE_MINUTES_PER_PAGE = 7.0

# Сколько токенов приходится на страницу учебника. Нужно там, где страниц нет:
# EPUB состоит из потока текста, и объём раздела известен только по его
# фрагментам.
TOKENS_PER_PAGE = 600

# Сложность темы масштабирует всё: на трудной странице ученик задерживается.
DIFFICULTY_MULTIPLIER: dict[str, float] = {
    "easy": 0.8,
    "medium": 1.0,
    "hard": 1.35,
}

# Разрыв между текущим и целевым уровнем. Тому, кто начинает с нуля, нужен
# запас на prerequisite'ы, которых у уверенного ученика уже нет.
LEVEL_MULTIPLIER: dict[str, float] = {
    "none": 1.35,
    "beginner": 1.2,
    "school_basic": 1.0,
    "school_confident": 0.9,
    "advanced": 0.8,
    "university": 0.8,
}

# Доли внутри темы. Теория — чтение и разбор, практика — самостоятельные
# задачи, проверка — короткий контроль в конце.
BALANCE_SPLIT: dict[str, tuple[float, float]] = {
    # (доля теории, доля практики); остаток уходит в проверку.
    "theory": (0.70, 0.20),
    "balanced": (0.50, 0.40),
    "practice": (0.30, 0.60),
}

# Границы разумного. Тема короче четверти часа не стоит отдельной строки в
# плане, а тема длиннее четырёх часов не помещается в занятие и должна была
# быть разделена.
MIN_TOPIC_MINUTES = 15
MAX_TOPIC_MINUTES = 240

# Короткая проверка в конце темы. Держится в узких границах: без неё тема
# заканчивается чтением, а полчаса контроля после сорока минут теории — уже не
# проверка, а отдельное занятие.
MIN_ASSESSMENT_MINUTES = 5
MAX_ASSESSMENT_MINUTES = 20

# Сколько минут приписать теме, у которой не нашлось ни одной страницы. Такое
# бывает у тем, собранных из разделов без подтверждённых границ.
FALLBACK_TOPIC_MINUTES = 45


@dataclass(frozen=True)
class Duration:
    """Разложенная оценка. `total` — то, что уходит в план."""

    theory_minutes: int
    practice_minutes: int
    assessment_minutes: int

    @property
    def total(self) -> int:
        return self.theory_minutes + self.practice_minutes + self.assessment_minutes

    def to_payload(self) -> dict:
        return {
            "theory_minutes": self.theory_minutes,
            "practice_minutes": self.practice_minutes,
            "assessment_minutes": self.assessment_minutes,
            "total_minutes": self.total,
        }


def _pages_from_tokens(content_tokens: int) -> int:
    """Объём текста → эквивалент страниц.

    Нужно для EPUB и других форматов без разбивки на страницы. Страница
    учебника — это порядка шестисот токенов вместе с формулами и подписями;
    точность здесь не важнее порядка величины, потому что дальше число всё
    равно умножается на сложность и уровень ученика.
    """
    tokens = max(0, int(content_tokens or 0))
    if tokens <= 0:
        return 0
    # Округление вверх: раздел короче страницы — это всё-таки одна страница
    # работы, а не ноль.
    return max(1, -(-tokens // TOKENS_PER_PAGE))


def covered_pages(ranges: list[tuple[int, int]]) -> int:
    """Сколько РАЗНЫХ страниц покрывают отрезки. Границы включительно.

    Складывать длины нельзя: тема, собранная из главы и двух её параграфов,
    ссылается на вложенные диапазоны, и наивная сумма насчитает страницы книги
    по два-три раза. Объединение отрезков даёт объём материала, а не объём
    ссылок на него.
    """
    normalized = sorted(
        (int(start), int(end))
        for start, end in ranges
        if start and end and int(end) >= int(start)
    )
    if not normalized:
        return 0

    total = 0
    current_start, current_end = normalized[0]
    for start, end in normalized[1:]:
        if start <= current_end + 1:  # смежные страницы — один отрезок
            current_end = max(current_end, end)
            continue
        total += current_end - current_start + 1
        current_start, current_end = start, end
    return total + current_end - current_start + 1


def _round_to_five(value: float) -> int:
    """Оценка времени с точностью до минуты — ложная точность."""
    return int(round(value / 5.0) * 5)


def estimate_topic_minutes(
    *,
    page_count: int,
    content_tokens: int = 0,
    difficulty: str = "medium",
    current_level: str = "school_basic",
    balance: str = "balanced",
) -> Duration:
    """Оценка по объёму материала, сложности и уровню ученика.

    `page_count` — сколько страниц книги покрывает тема. У EPUB страниц нет
    вовсе, и тогда объём берётся из `content_tokens` — суммы токенов
    фрагментов раздела. Без этого каждая тема электронной книги получала
    умолчание в 45 минут, то есть ровно то число, ради ухода от которого
    расчёт и делался.

    Ноль по обоим означает, что об объёме неизвестно ничего; тогда возвращается
    умолчание, а не ноль: тема без времени ломает прогноз сроков.
    """
    pages = max(0, int(page_count)) or _pages_from_tokens(content_tokens)
    if pages == 0:
        raw = float(FALLBACK_TOPIC_MINUTES)
    else:
        raw = (
            pages
            * BASE_MINUTES_PER_PAGE
            * DIFFICULTY_MULTIPLIER.get(difficulty, 1.0)
            * LEVEL_MULTIPLIER.get(current_level, 1.0)
        )

    total = min(MAX_TOPIC_MINUTES, max(MIN_TOPIC_MINUTES, raw))
    return split_total(total, balance)


def split_total(total_minutes: float, balance: str = "balanced") -> Duration:
    """Раскладывает готовое число минут на теорию, практику и проверку.

    Нужно отдельно от расчёта, потому что ученик может задать длительность темы
    руками. Разбивка тогда пересобирается из его числа, а не остаётся от
    прошлой оценки и не спорит с тем, что показано в плане.
    """
    total = max(0.0, float(total_minutes))
    if total <= 0:
        return Duration(theory_minutes=0, practice_minutes=0, assessment_minutes=0)

    rounded = _round_to_five(total)
    # Проверка выделяется первой и из общего времени, а не добавляется поверх:
    # иначе минимум в пять минут раздувал бы короткую тему на четверть.
    assessment = min(
        rounded, max(MIN_ASSESSMENT_MINUTES, min(MAX_ASSESSMENT_MINUTES, rounded // 10))
    )
    assessment = _round_to_five(assessment) or min(rounded, MIN_ASSESSMENT_MINUTES)

    theory_share, practice_share = BALANCE_SPLIT.get(balance, BALANCE_SPLIT["balanced"])
    remaining = rounded - assessment
    # Доли нормируются на остаток, поэтому смена баланса не меняет длительность
    # темы — только распределение внутри неё.
    theory_of_remaining = theory_share / (theory_share + practice_share)
    theory = min(remaining, _round_to_five(remaining * theory_of_remaining))
    return Duration(
        theory_minutes=theory,
        practice_minutes=remaining - theory,
        assessment_minutes=assessment,
    )

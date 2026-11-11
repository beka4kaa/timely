"""
Сигнал усталости ученика (PRODUCT.md §9.4, §6.10).

Тьютор должен заметить «не могу», «бесит», «опять неправильно» и предложить
перерыв или шаг назад по лестнице помощи, а не гнать ученика дальше по той же
задаче. Модуль — ЧИСТАЯ функция плюс тонкая обвязка над журналом:

* `fatigue_score` — реплики ученика и число неверных попыток подряд → число 0..1.
  Ни БД, ни сети, ни хранения: текст сообщений существует только в аргументе и
  нигде не сохраняется (§17.3, минимизация данных о несовершеннолетних).
* `fatigue_context_line` — одна строка для контекста тьютора или пустая строка.
* `build_fatigue_note` — достаёт неверные попытки из журнала и собирает строку.

Это НЕ санкция и НЕ отчёт: родителю ничего не уходит (§10.2), решение остаётся
за учеником. Результат нужен только затем, чтобы тьютор сменил тон и предложил.
"""

from __future__ import annotations

import logging
import re
from typing import Iterable, Sequence

logger = logging.getLogger(__name__)

# Порог, с которого тьютор получает строку в контекст. Подобран так, что одна
# сильная жалоба («надоело», «устал») уже достаточна, одна слабая — нет, а серия
# из четырёх неверных попыток без единого слова жалобы достаточна тоже.
FATIGUE_THRESHOLD = 0.5

# Сколько последних реплик ученика учитываем и как быстро старые теряют вес:
# усталость — состояние «сейчас», жалоба десятиминутной давности уже не про него.
MAX_MESSAGES = 5
_RECENCY_DECAY = 0.6

# Сильные жалобы — прямо говорят о состоянии. Слабые — раздражение или запинка,
# которые сами по себе ещё ничего не значат.
_STRONG_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"\bнадоел[оаи]?\b",
        r"\bустал[аи]?\b",
        r"\bбес(?:ит|ят|ишь)\b",
        r"\bдостал[оаи]?\b",
        r"\bне могу больше\b",
        r"\bне понимаю ничего\b",
        r"\bничего не понимаю\b",
        r"\bничего не получается\b",
        r"\bс меня хватит\b",
        r"\bхватит уже\b",
        r"\bзадолбал[оаи]?\b",
    )
)
_WEAK_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"\bне могу\b",
        r"\bопять (?:не|неправильно|ошибка|ошибся|ошиблась)\b",
        r"\bснова (?:не|неправильно|ошибка)\b",
        r"\bничего не выходит\b",
        r"\bне получается\b",
        r"\bне понимаю\b",
        r"\bхватит\b",
        r"\bсложно\b",
        r"\bтупой\b",
        r"\bтупая\b",
    )
)

# Слова облегчения: ученик справился и доволен. После «не»/«ни» слово не
# считается («не понял», «не ясно»). Они гасят счёт, в том числе
# накопленный серией неверных попыток.
_RELIEF_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"\bспасибо\b",
        r"(?<!не )(?<!ни )\bпонял[аи]?\b",
        r"(?<!не )(?<!ни )\bясно\b",
        r"\bтеперь понятно\b",
        r"\bполучилось\b",
        r"\bразобрал(?:ся|ась|ись)\b",
    )
)

_STRONG_WEIGHT = 0.5
_WEAK_WEIGHT = 0.3
_RELIEF_WEIGHT = 0.5
_WRONG_STREAK_WEIGHT = 0.15
_WRONG_STREAK_CAP = 0.6

# Сколько последних событий журнала смотрим, чтобы посчитать серию неверных.
JOURNAL_WINDOW = 10

FATIGUE_LINE = (
    "Похоже, ученик устал или злится. Мягко предложи короткий перерыв или шаг "
    "назад — задачу проще или подсказку на ступень выше. Не настаивай: "
    "решение остаётся за учеником."
)


def _normalize(text: str) -> str:
    return " ".join(str(text or "").lower().replace("ё", "е").split())


def _message_signal(text: str) -> float:
    """Вклад одной реплики: жалобы поднимают, облегчение снижает."""
    normalized = _normalize(text)
    if not normalized:
        return 0.0
    value = 0.0
    if any(p.search(normalized) for p in _STRONG_PATTERNS):
        value += _STRONG_WEIGHT
    elif any(p.search(normalized) for p in _WEAK_PATTERNS):
        value += _WEAK_WEIGHT
    if any(p.search(normalized) for p in _RELIEF_PATTERNS):
        value -= _RELIEF_WEIGHT
    return value


def fatigue_score(messages: Sequence[str], consecutive_wrong: int = 0) -> float:
    """Оценка усталости 0..1. Чистая функция.

    `messages` — реплики ученика от старых к новым; `consecutive_wrong` — сколько
    последних оценённых попыток подряд неверны. Старые реплики весят меньше.
    """
    recent = [str(item or "") for item in list(messages)[-MAX_MESSAGES:]]
    total = 0.0
    weight = 1.0
    for text in reversed(recent):
        total += _message_signal(text) * weight
        weight *= _RECENCY_DECAY

    streak = max(0, int(consecutive_wrong or 0))
    # Одна ошибка — норма учёбы, усталость начинается со второй подряд.
    total += min(_WRONG_STREAK_CAP, _WRONG_STREAK_WEIGHT * max(0, streak - 1) * 1.5)
    return round(max(0.0, min(1.0, total)), 4)


def fatigue_context_line(score: float) -> str:
    """Строка для контекста тьютора: пустая ниже порога, иначе ровно одна."""
    return FATIGUE_LINE if score >= FATIGUE_THRESHOLD else ""


def consecutive_wrong_attempts(results: Iterable[str]) -> int:
    """Сколько неверных попыток подряд в конце списка результатов (старые → новые).

    Результаты без оценки (объяснение, повторение, подсказка) серию не рвут и не
    продолжают: оценённая попытка — единственное, что говорит об успехе.
    """
    streak = 0
    for result in reversed(list(results)):
        if result == "incorrect":
            streak += 1
        elif result in ("correct", "partial"):
            break
    return streak


def build_fatigue_note(user_email: str, user_messages: Sequence[str]) -> str:
    """Собрать строку для системного контекста. Пустая строка — сигнала нет.

    Исключения наружу не летят: подсказка про перерыв — украшение ответа, а не
    его условие (как и память об ученике).
    """
    try:
        streak = 0
        email = (user_email or "").strip()
        if email:
            from .models import LearningEvent

            results = list(
                LearningEvent.objects.filter(
                    user_email=email, result__in=("correct", "incorrect", "partial")
                )
                .order_by("-created_at")
                .values_list("result", flat=True)[:JOURNAL_WINDOW]
            )
            streak = consecutive_wrong_attempts(reversed(results))
        return fatigue_context_line(fatigue_score(user_messages, streak))
    except Exception:  # noqa: BLE001
        logger.exception("[fatigue] не удалось оценить усталость")
        return ""

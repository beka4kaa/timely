"""
Политика помощи тьютора — сколько подсказок можно и можно ли готовый ответ.

Зачем
─────
До этого модуля «педагогика» жила только в промпте, а решение о том, давать
полный ответ или нет, принимала сама модель. Это неверно по двум причинам:

1. PRODUCT.md §3.3 прямо запрещает модели определять правила: модель выбирает
   педагогическое действие, но не права и не санкции.
2. Промпт не гарантия. `/api/ai/solve/` вообще отдавал полное решение всегда,
   а модель на просьбу «просто скажи ответ» её и выполняет.

Поэтому политика — обычные данные, а проверка — чистая функция, которую вызывает
backend ПЕРЕД тем, как отдать решение. Модель на это решение не влияет.

Лестница помощи (§5.5) — восемь ступеней, от «расскажи, что известно» до полного
решения. Ступень 7 (полное решение) доступна не всегда: её открывает
`allow_full_solution` и только после `required_attempts` самостоятельных попыток.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

# Лестница помощи из §5.5. Индекс в кортеже + 1 = номер ступени, поэтому
# HINT_LADDER[0] — первая ступень. Тексты нужны интерфейсу: ученик должен
# видеть, на какой ступени он находится, а не безымянную «подсказку N».
HINT_LADDER: tuple[str, ...] = (
    "Попросить ученика описать, что известно",
    "Обратить внимание на важную часть условия",
    "Напомнить связанную идею или формулу",
    "Предложить выбрать следующий шаг",
    "Показать аналогичный пример",
    "Показать часть решения текущей задачи",
    "Дать полное решение",
    "Дать аналогичную проверочную задачу",
)

# Ступень, на которой выдаётся готовое решение. Всё, что выше неё, политика
# должна пускать только при allow_full_solution — иначе «лестница» стала бы
# способом обойти запрет: восемь нажатий подряд и ответ на экране.
FULL_SOLUTION_RUNG = 7

MAX_HINT_RUNG = len(HINT_LADDER)


@dataclass(frozen=True)
class HelpPolicy:
    """Правила помощи для одной учебной активности.

    Неизменяемая: политика режима — это норма, а не состояние сессии. Счётчики
    попыток и текущая ступень живут на сессии, не здесь.
    """

    allow_full_solution: bool
    required_attempts: int
    hints_allowed: bool
    max_hint_level: int
    sources_allowed: bool
    calculator_allowed: bool
    rated: bool

    def as_dict(self) -> dict[str, Any]:
        """Для сохранения на сессии и отдачи фронтенду."""
        return {
            "allow_full_solution": self.allow_full_solution,
            "required_attempts": self.required_attempts,
            "hints_allowed": self.hints_allowed,
            "max_hint_level": self.max_hint_level,
            "sources_allowed": self.sources_allowed,
            "calculator_allowed": self.calculator_allowed,
            "rated": self.rated,
        }


@dataclass(frozen=True)
class HelpDecision:
    """Ответ на вопрос «можно ли сейчас выдать эту помощь».

    `reason` пишется для ученика, а не для лога: он попадает в чат, когда
    тьютор отказывается дать ответ, поэтому формулировка объясняет, что сделать
    дальше, а не просто «запрещено».
    """

    allowed: bool
    reason: str = ""
    granted_rung: int | None = None

    @property
    def rung_title(self) -> str:
        if self.granted_rung is None or not 1 <= self.granted_rung <= MAX_HINT_RUNG:
            return ""
        return HINT_LADDER[self.granted_rung - 1]


# ──────────────────────────────────────────────────────────────────────────────
# Готовые профили предпочтений (§5.6)
#
# Профиль — это ПОЖЕЛАНИЕ ученика, а не разрешение. resolve_policy ниже умеет
# только ужесточать политику режима, поэтому профиль «Быстро и по делу» не
# откроет полное решение там, где режим его запретил.
# ──────────────────────────────────────────────────────────────────────────────
HELP_PROFILES: dict[str, dict[str, Any]] = {
    "guide_me": {
        "title": "Направляй меня",
        "allow_full_solution": False,
        "max_hint_level": 4,
    },
    "explain_with_me": {
        "title": "Объясняй вместе со мной",
        "max_hint_level": 6,
    },
    "show_example": {
        "title": "Покажи пример",
        "max_hint_level": 5,
    },
    "fast": {
        "title": "Быстро и по делу",
        # Ничего не ужесточает: это просьба о краткости, а не о правах. Тон
        # задаётся промптом режима, права остаются прежними.
    },
    "exam_prep": {
        "title": "Подготовка к экзамену",
        "required_attempts": 2,
    },
}


def resolve_policy(base: HelpPolicy, user_prefs: dict[str, Any] | None = None) -> HelpPolicy:
    """Наложить предпочтения ученика на политику режима.

    Ключевое правило §5.6: «Ученик управляет стилем, но не может отменить
    правила контеста». Поэтому каждое поле объединяется в СТОРОНУ СТРОГОСТИ:
    булевы — через `and`, `required_attempts` — через `max`, `max_hint_level` —
    через `min`. Любое предпочтение может только сузить права, никогда расширить.

    `rated` не берётся из предпочтений вовсе: рейтинговость — свойство
    активности, и разрешать ученику её выключать значило бы разрешить
    «потренируюсь без рейтинга, если не получилось».
    """
    if not user_prefs:
        return base

    def flag(name: str, current: bool) -> bool:
        wanted = user_prefs.get(name)
        if not isinstance(wanted, bool):
            return current
        return current and wanted

    required_attempts = base.required_attempts
    wanted_attempts = user_prefs.get("required_attempts")
    if isinstance(wanted_attempts, int) and not isinstance(wanted_attempts, bool):
        required_attempts = max(required_attempts, wanted_attempts)

    max_hint_level = base.max_hint_level
    wanted_hints = user_prefs.get("max_hint_level")
    if isinstance(wanted_hints, int) and not isinstance(wanted_hints, bool):
        max_hint_level = min(max_hint_level, max(0, wanted_hints))

    return replace(
        base,
        allow_full_solution=flag("allow_full_solution", base.allow_full_solution),
        required_attempts=required_attempts,
        hints_allowed=flag("hints_allowed", base.hints_allowed),
        max_hint_level=max_hint_level,
        sources_allowed=flag("sources_allowed", base.sources_allowed),
        calculator_allowed=flag("calculator_allowed", base.calculator_allowed),
    )


def resolve_profile(base: HelpPolicy, profile: str | None) -> HelpPolicy:
    """`resolve_policy` для именованного профиля из §5.6."""
    prefs = HELP_PROFILES.get(str(profile or "").strip())
    return resolve_policy(base, prefs)


def check_help_allowed(
    policy: HelpPolicy,
    *,
    attempts: int = 0,
    hint_level: int = 0,
    wants_full_solution: bool = False,
) -> HelpDecision:
    """Можно ли выдать запрошенную помощь при текущей политике и состоянии.

    `hint_level` — сколько ступеней уже выдано (0 = ещё ни одной).
    `attempts` — сколько самостоятельных попыток сделал ученик.

    Чистая функция: ни сети, ни БД, ни времени — поэтому её можно звать из
    любого места и тестировать таблицей.
    """
    if wants_full_solution:
        if not policy.allow_full_solution:
            return HelpDecision(
                allowed=False,
                reason=(
                    "В этом режиме готовое решение недоступно. "
                    "Давай разберём задачу по шагам — с чего начнёшь?"
                ),
            )
        if attempts < policy.required_attempts:
            left = policy.required_attempts - attempts
            return HelpDecision(
                allowed=False,
                reason=(
                    f"Сначала попробуй сам — осталось попыток до разбора: {left}. "
                    "Можешь попросить подсказку."
                ),
            )
        return HelpDecision(allowed=True, granted_rung=FULL_SOLUTION_RUNG)

    if not policy.hints_allowed:
        return HelpDecision(
            allowed=False,
            reason="В этом режиме подсказки отключены.",
        )

    next_rung = hint_level + 1

    if next_rung > policy.max_hint_level or next_rung > MAX_HINT_RUNG:
        return HelpDecision(
            allowed=False,
            reason=(
                "Подсказки на этом этапе закончились. "
                "Попробуй сформулировать ответ — я проверю."
            ),
        )

    # Лестница не должна становиться обходом запрета: если полное решение
    # закрыто политикой, ступень 7 и выше недоступны, даже когда max_hint_level
    # формально их разрешает.
    if next_rung >= FULL_SOLUTION_RUNG and not policy.allow_full_solution:
        return HelpDecision(
            allowed=False,
            reason=(
                "Дальше идёт готовое решение, а в этом режиме оно недоступно. "
                "Скажи, где именно застрял, и разберём это место."
            ),
        )

    return HelpDecision(allowed=True, granted_rung=next_rung)

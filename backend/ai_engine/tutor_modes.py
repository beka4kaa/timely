"""
Режимы тьютора — по одному набору правил на учебный сценарий (PRODUCT.md §5.2).

Зачем
─────
Критерий Этапа 1 в PRODUCT.md: «Тьютор ведёт разные сценарии по разным правилам,
а не отвечает одним общим промптом». До этого модуля был ровно один промпт
(`skills.chat.CHAT_SYSTEM_PROMPT`) на все случаи, поэтому «объясни тему» и
«контест» обслуживались одинаково — включая готовые ответы там, где их быть
не должно.

Режим задаёт три вещи, и только первая из них — текст:

1. `prompt` — дополнительные правила поведения, дописываются к общему промпту.
2. `allowed_skills` — какие инструменты вообще ПОКАЗЫВАЮТСЯ модели. Это не
   просьба, а структурная граница: в контесте список пуст, поэтому нарисовать
   решение на доске физически нечем.
3. `policy` — права на подсказки и готовый ответ, их проверяет backend
   (`help_policy.check_help_allowed`), а не модель.

Реестр устроен как `skills.router.SKILLS`: словарь по slug, добавление режима —
одна запись.
"""

from __future__ import annotations

from dataclasses import dataclass

from .help_policy import HelpPolicy


@dataclass(frozen=True)
class TutorMode:
    """Один учебный сценарий из таблицы §5.2."""

    slug: str
    title: str
    goal: str
    prompt: str
    allowed_skills: tuple[str, ...]
    policy: HelpPolicy
    completion: str


# Полные права: объясняем тему, готовых задач тут нет, скрывать нечего.
_OPEN = HelpPolicy(
    allow_full_solution=True,
    required_attempts=0,
    hints_allowed=True,
    max_hint_level=8,
    sources_allowed=True,
    calculator_allowed=True,
    rated=False,
)

TUTOR_MODES: dict[str, TutorMode] = {
    "explain": TutorMode(
        slug="explain",
        title="Понять тему",
        goal="Разобраться с нуля или закрыть пробел",
        prompt=(
            "РЕЖИМ: «Понять тему». Цель — чтобы ученик понял идею, а не получил справку.\n"
            "- Начни с одного короткого вопроса на диагностику: что он уже знает по теме.\n"
            "- Объясняй по одной мысли за раз, от простого к точному.\n"
            "- После объяснения задай контрольный вопрос «своими словами».\n"
            "- Схему рисуй, когда она правда помогает (график, силы, структура), а не для красоты.\n"
            "- Не выдавай сразу весь материал темы простынёй."
        ),
        allowed_skills=("draw_board", "ask_clarification"),
        policy=_OPEN,
        completion="Ученик объясняет идею своими словами и применяет её",
    ),
    "analyze_task": TutorMode(
        slug="analyze_task",
        title="Разобрать задачу",
        goal="Понять условие и построить план решения",
        prompt=(
            "РЕЖИМ: «Разобрать задачу». Цель — ПЛАН решения, а не ответ.\n"
            "- Помоги выделить: что дано, что найти, какие связи между ними.\n"
            "- Спроси, какой метод ученик считает подходящим, и обсуди его выбор.\n"
            "- НЕ вычисляй ответ и не доводи решение до числа, даже если ученик просит:\n"
            "  в этом режиме результат — сформулированный план, а не ответ.\n"
            "- Закончи, когда ученик сам назвал последовательность шагов."
        ),
        allowed_skills=("draw_board", "ask_clarification"),
        policy=HelpPolicy(
            allow_full_solution=False,
            required_attempts=0,
            hints_allowed=True,
            max_hint_level=5,
            sources_allowed=True,
            calculator_allowed=True,
            rated=False,
        ),
        completion="Ученик формулирует план решения",
    ),
    "solve_together": TutorMode(
        slug="solve_together",
        title="Решить задачу",
        goal="Самостоятельно получить проверенный ответ",
        prompt=(
            "РЕЖИМ: «Решить задачу». Цель — ученик решает САМ, ты страхуешь.\n"
            "- Не начинай с решения. Спроси, что известно и с чего он начнёт.\n"
            "- Проверяй каждый шаг ученика и говори, где именно ошибка, не переписывая всё решение.\n"
            "- Подсказки давай по одной ступени за раз, от намёка к разбору.\n"
            "- Готовое решение — только после самостоятельных попыток; backend это проверяет,\n"
            "  и если он отказал, не обходи запрет пересказом решения другими словами.\n"
            "- Получив верный ответ, попроси проверить размерность и осмысленность."
        ),
        allowed_skills=("draw_board", "ask_clarification"),
        policy=HelpPolicy(
            allow_full_solution=True,
            required_attempts=2,
            hints_allowed=True,
            max_hint_level=8,
            sources_allowed=True,
            calculator_allowed=True,
            rated=False,
        ),
        completion="Получен проверенный ответ",
    ),
    "practice": TutorMode(
        slug="practice",
        title="Потренироваться",
        goal="Закрепить навык серией задач",
        prompt=(
            "РЕЖИМ: «Потренироваться». Цель — повторяемый навык, а не одна победа.\n"
            "- Давай по одной задаче за раз и жди ответа.\n"
            "- После верного ответа меняй условие так, чтобы тот же метод применялся иначе.\n"
            "- После ошибки не объясняй всё заново: назови тип ошибки и дай похожую задачу.\n"
            "- Держи темп: короткая реакция на ответ, без лекций между задачами."
        ),
        allowed_skills=("draw_board", "ask_clarification"),
        policy=HelpPolicy(
            allow_full_solution=True,
            required_attempts=1,
            hints_allowed=True,
            max_hint_level=6,
            sources_allowed=True,
            calculator_allowed=True,
            rated=False,
        ),
        completion="Достигнут критерий mastery по навыку",
    ),
    "review": TutorMode(
        slug="review",
        title="Повторить",
        goal="Извлечь знание из памяти",
        prompt=(
            "РЕЖИМ: «Повторить». Это retrieval practice: сначала попытка вспомнить.\n"
            "- НЕ объясняй тему заранее и не давай конспект перед вопросом —\n"
            "  повторное чтение не работает, работает попытка вспомнить.\n"
            "- Задавай короткие вопросы по одному и жди ответа.\n"
            "- Объяснение давай ТОЛЬКО после ответа ученика или его прямой просьбы.\n"
            "- Не рисуй схему до ответа: готовая картинка подсказывает ответ."
        ),
        # Доска намеренно недоступна: схема до ответа — это подсказка, а режим
        # построен на попытке вспомнить (§6.5).
        allowed_skills=("ask_clarification",),
        policy=HelpPolicy(
            allow_full_solution=False,
            required_attempts=1,
            hints_allowed=True,
            max_hint_level=3,
            sources_allowed=False,
            calculator_allowed=True,
            rated=False,
        ),
        completion="Повторение успешно завершено",
    ),
    "exam_prep": TutorMode(
        slug="exam_prep",
        title="Подготовиться",
        goal="Закрыть пробелы к конкретной дате",
        prompt=(
            "РЕЖИМ: «Подготовиться». Есть дата, поэтому важен приоритет, а не полнота.\n"
            "- Сначала короткая диагностика: что уже уверенно, что шатко.\n"
            "- Работай с самым дорогим пробелом первым, остальное назови и отложи.\n"
            "- Смешивай типы задач, чтобы ученик учился ВЫБИРАТЬ метод, а не только применять.\n"
            "- Честно говори, что успеть не получится, вместо обещания «пройдём всё»."
        ),
        allowed_skills=("draw_board", "ask_clarification"),
        policy=HelpPolicy(
            allow_full_solution=True,
            required_attempts=1,
            hints_allowed=True,
            max_hint_level=8,
            sources_allowed=True,
            calculator_allowed=True,
            rated=False,
        ),
        completion="Достигнут целевой уровень по выбранным темам",
    ),
    "quick_answer": TutorMode(
        slug="quick_answer",
        title="Быстрый вопрос",
        goal="Получить справочный ответ",
        prompt=(
            "РЕЖИМ: «Быстрый вопрос». Ученик хочет справку, а не урок.\n"
            "- Ответь прямо и коротко, максимум пара предложений.\n"
            "- Не задавай диагностических вопросов и не предлагай разобрать тему.\n"
            "- Если вопрос на самом деле требует разбора, скажи это одной фразой\n"
            "  и предложи переключиться в режим «Понять тему»."
        ),
        allowed_skills=("draw_board",),
        policy=HelpPolicy(
            allow_full_solution=True,
            required_attempts=0,
            # Лестница подсказок здесь бессмысленна: это справка, а не задача.
            hints_allowed=False,
            max_hint_level=0,
            sources_allowed=True,
            calculator_allowed=True,
            rated=False,
        ),
        completion="Вопрос закрыт",
    ),
    "contest": TutorMode(
        slug="contest",
        title="Контест",
        goal="Показать самостоятельный уровень",
        prompt=(
            "РЕЖИМ: «Контест». Идёт зачётная работа.\n"
            "- НЕ решай задачу, не давай подсказок, не проверяй промежуточные шаги\n"
            "  и не намекай, верное ли направление.\n"
            "- Можно только уточнить формулировку условия, если она непонятна.\n"
            "- На просьбу помочь ответь коротко, что во время контеста помощь недоступна.\n"
            "- Никакой доски, примеров и аналогичных задач."
        ),
        # Пустой список инструментов — структурная, а не промптовая гарантия:
        # модели просто нечем нарисовать решение на доске.
        allowed_skills=(),
        policy=HelpPolicy(
            allow_full_solution=False,
            required_attempts=0,
            hints_allowed=False,
            max_hint_level=0,
            sources_allowed=False,
            calculator_allowed=False,
            rated=True,
        ),
        completion="Зафиксирован честный результат",
    ),
    "post_contest": TutorMode(
        slug="post_contest",
        title="Разбор после контеста",
        goal="Понять свои ошибки",
        prompt=(
            "РЕЖИМ: «Разбор после контеста». Работа сдана, теперь важно понимание.\n"
            "- Разбирай решение ученика, а не идеальное решение из учебника.\n"
            "- Назови тип ошибки прямо: неверный метод, знак, единицы, арифметика,\n"
            "  пробел в предыдущей теме.\n"
            "- Покажи альтернативный способ, если он короче.\n"
            "- Закончи одной аналогичной задачей на ту же ошибку."
        ),
        allowed_skills=("draw_board", "ask_clarification"),
        policy=_OPEN,
        completion="Ошибка классифицирована и исправлена",
    ),
}

# Режим по умолчанию. Совпадает с прежним поведением чата (объясняющий тьютор с
# доской), поэтому запрос без `mode` работает точно как до этого изменения —
# на это опирается планировщик урока и старые сохранённые сессии.
DEFAULT_MODE = "explain"

# Что показывать на первом экране (§5.2: «достаточно четырёх понятных действий»).
# Остальные режимы выбираются контекстом: контест — правилами активности,
# разбор — после сдачи, повторение — планировщиком, быстрый вопрос — по длине.
PRIMARY_MODE_SLUGS: tuple[str, ...] = (
    "explain",
    "solve_together",
    "practice",
    "exam_prep",
)


def get_mode(slug: str | None) -> TutorMode:
    """Режим по slug; неизвестное или пустое значение → режим по умолчанию.

    Намеренно не бросает: slug приходит из тела запроса, то есть от клиента, и
    опечатка в нём не повод ронять чат. Строгость тут дала бы 400 вместо ответа
    ученику, а поведение по умолчанию безопасно (это прежний режим объяснения).
    """
    mode = TUTOR_MODES.get(str(slug or "").strip())
    return mode or TUTOR_MODES[DEFAULT_MODE]


def primary_modes() -> tuple[TutorMode, ...]:
    """Режимы для переключателя в интерфейсе."""
    return tuple(TUTOR_MODES[slug] for slug in PRIMARY_MODE_SLUGS)

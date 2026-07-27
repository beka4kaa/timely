"""
Скилл «задать уточняющий вопрос с вариантами ответа».

Зачем
─────
Раньше на размытый запрос («нарисуй силы») ассистент угадывал и часто рисовал
не то — а это дорого: одна иллюстрация это ~25с генерации плюс грунтинг. Тут
он вместо угадывания задаёт ОДИН вопрос и сразу предлагает готовые варианты,
чтобы ученик отвечал одним кликом, а не печатал.

Контракт ответа
───────────────
Скилл ничего не генерирует и не ходит в модель повторно: он просто упаковывает
аргументы tool_call в структуру, которую рисует фронтенд:

    {"question": "...", "options": [{"label", "description", "recommended"}, ...]}

Первый вариант помечается `recommended` — это подсказка «по умолчанию», а не
запрет выбирать остальные. Пункт «Написать свой ответ» фронтенд добавляет сам,
поэтому модели его перечислять не нужно.
"""

from __future__ import annotations

from typing import Any

from .base import Skill, SkillResult

# Больше четырёх вариантов человек уже не сравнивает — начинает читать как
# список, а не как выбор. Лишнее просто отбрасываем.
MAX_OPTIONS = 4

# Модель всё равно иногда дописывает свой пункт «Другое», хотя в описании тула
# это запрещено (наблюдалось вживую). Такой дубликат стоит рядом с кнопкой
# «Другое — напишу сам» от интерфейса и выглядит багом, поэтому отсекаем здесь.
#
# Сопоставляем по началу строки БЕЗ \b: граница слова после основы не работает
# («другое» — после «друг» идёт буква, и \b там нет). Основы подобраны так,
# чтобы не задеть настоящие варианты: «сам» отдельно не берём, иначе отвалился
# бы «самолёт», а «ино» — иначе «иномарка».
_OTHER_OPTION_PREFIXES = (
    "друго",       # другое, другой
    "друга",       # другая
    "иное",
    "прочее",
    "свой",
    "своя",
    "своё",
    "укажу",
    "укажите",
    "указать сам",
    "напишу",
    "введу",
    "other",
    "custom",
    "something else",
)


def _is_other_option(label: str) -> bool:
    normalized = label.strip().lower()
    return any(normalized.startswith(prefix) for prefix in _OTHER_OPTION_PREFIXES)


class ClarifySkill(Skill):
    name = "ask_clarification"
    description = (
        "Задать ученику ОДИН короткий уточняющий вопрос с готовыми вариантами ответа. "
        "Вызывай, только когда запрос допускает несколько РАЗНЫХ решений и выбор "
        "заметно меняет результат: например неясно, нужна одна схема или несколько, "
        "какой раздел физики имеется в виду, нужен ли вывод формулы. НЕ вызывай, "
        "если можно разумно ответить или нарисовать сразу — лишний вопрос раздражает. "
        "Никогда не спрашивай про оформление, стиль или цвета."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "question": {
                "type": "string",
                "description": "Вопрос одной фразой, на языке ученика.",
            },
            "options": {
                "type": "array",
                "minItems": 2,
                "maxItems": MAX_OPTIONS,
                "description": (
                    "Варианты ответа. Первый — самый вероятный, он будет отмечен как "
                    "рекомендуемый. Перечисляй только КОНКРЕТНЫЕ варианты. НЕ добавляй "
                    "пункт «Другое», «Свой вариант» или «Указать самому» — интерфейс "
                    "показывает такую кнопку сам, и твой дубликат будет выглядеть ошибкой."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {
                            "type": "string",
                            "description": "Короткий вариант, 1-5 слов.",
                        },
                        "description": {
                            "type": "string",
                            "description": "Одна фраза: что произойдёт при этом выборе.",
                        },
                    },
                    "required": ["label"],
                },
            },
        },
        "required": ["question", "options"],
    }

    def run(self, *, user_message: str, history: list, **kwargs: Any) -> SkillResult:
        question = str(kwargs.get("question") or "").strip()
        raw_options = kwargs.get("options")

        options: list[dict[str, Any]] = []
        if isinstance(raw_options, list):
            for item in raw_options[:MAX_OPTIONS]:
                if isinstance(item, dict):
                    label = str(item.get("label") or "").strip()
                    description = str(item.get("description") or "").strip()
                elif isinstance(item, str):
                    label, description = item.strip(), ""
                else:
                    continue
                if label and not _is_other_option(label):
                    options.append({"label": label, "description": description})

        # Вопрос без выбора бесполезен: ученик всё равно будет печатать ответ
        # руками, а мы потеряли ход. Тогда честнее отдать вопрос обычным
        # текстом — фронтенд покажет его как реплику ассистента.
        if not question or len(options) < 2:
            return SkillResult(
                reply=question or "Уточните, пожалуйста, что именно нужно.",
                board=None,
                model=kwargs.get("model", ""),
                skill="chat",
            )

        options[0]["recommended"] = True

        return SkillResult(
            reply=question,
            board=None,
            model=kwargs.get("model", ""),
            skill=self.name,
            meta={"clarify": {"question": question, "options": options}},
        )

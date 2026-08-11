"""Короткое название чата по началу разговора.

Список из пяти строк «Новый чат» бесполезен — по нему нельзя вернуться к нужному
разговору, а именно для этого список и заводится.

Отказ модели не оставляет чат безымянным: названием становится первый вопрос,
обрезанный до строки. Неидеальный, но узнаваемый заголовок лучше пустого.
"""

from __future__ import annotations

import json
import logging

logger = logging.getLogger(__name__)

# Заголовок в узкой панели: длиннее пятидесяти знаков всё равно обрежется
# многоточием, и модели незачем стараться.
MAX_TITLE_CHARS = 50
FALLBACK_TITLE = "Новый чат"

SYSTEM_PROMPT = """Ты придумываешь короткое название разговора.

Тебе дают первый вопрос ученика и начало ответа. Назови разговор так, чтобы
ученик узнал его в списке через неделю.

Правила:
- Два-четыре слова. Без точки в конце.
- Существительными: «Закон сохранения импульса», а не «Ученик спрашивает про…».
- На языке вопроса.
- Не пиши «чат», «разговор», «вопрос» — это и так список чатов.

Верни ТОЛЬКО JSON: {"title": "..."}"""


def first_question(messages: list) -> str:
    """Первая реплика ученика. Пусто, если её нет."""
    for message in messages or []:
        if not isinstance(message, dict):
            continue
        if message.get("role") == "user":
            return str(message.get("content") or "").strip()
    return ""


def fallback_title(messages: list) -> str:
    """Название на случай, когда модель не ответила."""
    question = first_question(messages)
    if not question:
        return FALLBACK_TITLE
    single_line = " ".join(question.split())
    if len(single_line) <= MAX_TITLE_CHARS:
        return single_line
    # Режем по границе слова: обрубок посреди слова читается как ошибка.
    cut = single_line[:MAX_TITLE_CHARS].rsplit(" ", 1)[0]
    return f"{cut or single_line[:MAX_TITLE_CHARS]}…"


def generate_chat_title(messages: list) -> str:
    """Название от модели, а при любой заминке — запасное.

    Наружу исключения не выпускает: заголовок — украшение списка, и ронять из-за
    него запрос нельзя.
    """
    question = first_question(messages)
    if not question:
        return FALLBACK_TITLE

    answer = ""
    for message in messages or []:
        if isinstance(message, dict) and message.get("role") == "assistant":
            answer = str(message.get("content") or "")[:600]
            break

    try:
        from ai_engine.text_llm import TextModel

        response = TextModel(temperature=0.3).generate_json_content(
            system_prompt=SYSTEM_PROMPT,
            payload={"question": question[:600], "answer_start": answer},
            timeout=30,
            max_tokens=60,
            feature="chat_title",
        )
        data = json.loads(response.text)
        title = str(data.get("title") or "").strip() if isinstance(data, dict) else ""
    except Exception as exc:  # noqa: BLE001 — сеть, провайдер, разбор ответа
        logger.info("Название чата не придумалось: %s", exc)
        return fallback_title(messages)

    if not title:
        return fallback_title(messages)
    return " ".join(title.split())[:MAX_TITLE_CHARS]

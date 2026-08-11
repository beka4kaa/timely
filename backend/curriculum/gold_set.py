"""Черновик эталонного набора: вопрос ученика → разделы, где лежит ответ.

Без эталона качество не измеряется. Нынешний smoke-набор берёт заголовки
разделов как запросы, а их же пути как правильный ответ, — это проверка «жив ли
индекс», а не качество: найти раздел по его собственному заголовку тривиально
для любой лексики, и recall выходит завышенным.

Поэтому вопрос обязан быть перефразированным. Модуль отбраковывает те, что
слишком похожи на заголовок: сгенерированный эталон — черновик, и молча
пропускать в него негодные вопросы значит получить красивые, но пустые цифры.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass

_WORD = re.compile(r"\w+", re.UNICODE)
# Доля слов заголовка, попавших в вопрос, выше которой вопрос считается копией.
# Половина — это уже пересказ заголовка, а не вопрос своими словами.
MAX_TITLE_OVERLAP = 0.5
MIN_QUERY_WORDS = 3


@dataclass(frozen=True)
class GoldQuery:
    query: str
    section_paths: tuple[str, ...]

    def to_payload(self) -> dict:
        return {
            "query": self.query,
            "relevant_section_paths": list(self.section_paths),
        }


def _words(text: str) -> set[str]:
    return {word.casefold() for word in _WORD.findall(text or "")}


def title_overlap(question: str, title: str) -> float:
    """Какая доля значимых слов заголовка перешла в вопрос."""
    title_words = _words(title)
    if not title_words:
        return 0.0
    return len(title_words & _words(question)) / len(title_words)


def rejection_reason(question: str, title: str) -> str:
    """Почему вопрос не годится в эталон. Пусто — годится."""
    question = (question or "").strip()
    if len(_WORD.findall(question)) < MIN_QUERY_WORDS:
        return "слишком короткий"
    if title_overlap(question, title) > MAX_TITLE_OVERLAP:
        # Такой вопрос найдётся лексикой по совпадению слов, и оценка скажет
        # больше о заголовке, чем о поиске.
        return "повторяет заголовок раздела"
    return ""


def dumps(queries: list[GoldQuery]) -> str:
    """Эталон в том же формате, что уже понимает `--gold-set`."""
    return json.dumps(
        [query.to_payload() for query in queries], ensure_ascii=False, indent=2
    )

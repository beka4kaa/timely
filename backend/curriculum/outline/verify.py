"""Сверка оглавления с телом книги.

Оглавление называет ПЕЧАТНЫЕ страницы, а мы читаем PDF. Это разные системы
координат: у Мякишева печатная 3 — это PDF 4, потому что обложка и титул тоже
занимают листы. Разница обычно постоянна, но объявлять её равной нулю нельзя —
ученик получит ссылку не на ту страницу.

Смещение не угадывается, а голосуется: по каждой записи оглавления ищется её
заголовок в теле книги, и побеждает то смещение, которое подтвердили несколько
записей независимо. Одного совпадения мало — заголовок может встретиться в
колонтитуле или в перекрёстной ссылке.
"""

from __future__ import annotations

import re
from collections import Counter
from difflib import SequenceMatcher

from .contracts import Outline, OutlineNode
from .thresholds import (
    OFFSET_MIN_VOTES,
    UNVERIFIED_CONFIDENCE,
    VERIFY_PAGE_TOLERANCE,
    VERIFY_TITLE_RATIO,
)

_WORD = re.compile(r"\w+", re.UNICODE)


def _key(title: str) -> str:
    """Нормализованный ключ заголовка: регистр и пунктуация значения не имеют."""
    return " ".join(_WORD.findall((title or "").casefold()))


def _looks_like(title_key: str, page_text: str) -> float:
    """Насколько заголовок похож на то, что напечатано в начале страницы.

    Смотрим только верх страницы: заголовок раздела стоит там, а совпадение в
    середине текста — это, скорее всего, упоминание, а не начало раздела.
    """
    if not title_key:
        return 0.0
    head = " ".join(_WORD.findall((page_text or "")[:600].casefold()))
    if not head:
        return 0.0
    if title_key in head:
        return 1.0
    return SequenceMatcher(None, title_key, head[: len(title_key) + 40]).ratio()


def find_page_offset(
    nodes: list[OutlineNode], pages: dict[int, str]
) -> tuple[int | None, int]:
    """Возвращает `(смещение, сколько записей его подтвердили)`.

    `pdf_page = printed_page + offset`.
    """
    votes: Counter[int] = Counter()
    for node in nodes:
        if node.printed_page is None:
            continue
        title_key = _key(node.title)
        if len(title_key) < 8:
            # Слишком короткий заголовок совпадёт где угодно.
            continue
        for pdf_page, text in pages.items():
            offset = pdf_page - node.printed_page
            # Отрицательное смещение означало бы, что печатная нумерация
            # опережает физическую — так книги не делают.
            if offset < 0 or offset > 40:
                continue
            if _looks_like(title_key, text) >= VERIFY_TITLE_RATIO:
                votes[offset] += 1

    if not votes:
        return None, 0
    offset, count = votes.most_common(1)[0]
    if count < OFFSET_MIN_VOTES:
        return None, count
    return offset, count


def verify_against_body(outline: Outline, pages: dict[int, str]) -> Outline:
    """Проставляет `start_page`, `verified` и уточняет уверенность.

    Узел считается подтверждённым, когда его заголовок действительно нашёлся
    рядом с ожидаемой страницей. Неподтверждённые не выбрасываются и не
    исключаются из программы — они лишь получают пониженную уверенность:
    оглавление напечатано в книге, и его слово весит больше, чем неудача
    нашего сопоставления.
    """
    offset, votes = find_page_offset(outline.nodes, pages)
    outline.page_offset = offset
    if offset is None:
        outline.signals.append("page_offset_unknown")
        return outline

    outline.signals.append(f"page_offset={offset}({votes})")
    last_page = max(pages) if pages else 0

    for node in outline.nodes:
        if node.printed_page is None:
            continue
        expected = node.printed_page + offset
        title_key = _key(node.title)
        best_page, best_ratio = expected, 0.0
        for candidate in range(
            max(1, expected - VERIFY_PAGE_TOLERANCE),
            min(last_page, expected + VERIFY_PAGE_TOLERANCE) + 1,
        ):
            ratio = _looks_like(title_key, pages.get(candidate, ""))
            if ratio > best_ratio:
                best_page, best_ratio = candidate, ratio

        node.start_page = best_page
        node.verified = best_ratio >= VERIFY_TITLE_RATIO
        if node.verified:
            node.signals.append("body_match")
        else:
            # Заголовок не нашёлся там, где обещало оглавление. Это НЕ повод
            # считать раздел выдуманным: оглавление напечатано в книге, а не
            # угадано нами, и чаще всего виноват матчер — параграф начался в
            # середине страницы, а не сверху. Поэтому раздел остаётся годным
            # для программы, но с пометкой, что его страница менее надёжна.
            node.confidence = min(node.confidence, UNVERIFIED_CONFIDENCE)
            node.signals.append("body_match_failed")

    _close_ranges(outline.nodes, last_page)
    return outline


def _close_ranges(nodes: list[OutlineNode], last_page: int) -> None:
    """`end_page` — там, где начинается следующий узел того же или высшего уровня.

    Считается по порядку следования, а не по вложенности путей: пути в книге
    повторяются, и поиск «по такому же пути» когда-то уже приводил к тому, что
    почти каждый раздел заявлял диапазон до конца книги.
    """
    with_pages = [node for node in nodes if node.start_page]
    for index, node in enumerate(with_pages):
        end = last_page
        for following in with_pages[index + 1 :]:
            if following.level <= node.level:
                end = following.start_page
                break
        node.end_page = max(node.start_page, end)

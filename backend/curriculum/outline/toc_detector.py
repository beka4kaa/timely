"""Поиск страниц настоящего оглавления.

Оглавление — самый дешёвый и самый надёжный источник структуры из доступных
нам: издатель уже проделал работу, которую иначе пришлось бы угадывать по
вёрстке (а вёрстки у нас нет — `extraction` отдаёт плоский текст).

Детектор возвращает УВЕРЕННОСТЬ и список сработавших сигналов, а не «да/нет».
Разница практическая: страница с таблицей результатов тоже даёт номера в конце
строк, и решение «это оглавление» должно опираться на несколько независимых
признаков сразу, а не на один.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .thresholds import (
    TOC_HEAD_PAGES,
    TOC_MIN_ENTRIES,
    TOC_MIN_ENTRY_RATIO,
    TOC_PAGE_CONFIDENCE,
    TOC_TAIL_PAGES,
)

# «Оглавление», «Содержание», «Contents» — заявление страницы о себе.
_TITLE_MARKER = re.compile(r"^\s*(оглавление|содержание|contents)\s*$", re.I)
# Точки-выноски: «. . . . .» или «......». Разделитель названия и номера.
_DOT_LEADER = re.compile(r"(?:\.\s*){4,}")
# Запись оглавления: что-то, потом номер страницы в конце строки.
_ENTRY = re.compile(r"^\s*(?P<title>\S.*?)\s*(?:\.\s*){2,}\s*(?P<page>\d{1,4})\s*$")
# Запись без выносок — «Название   57».
_ENTRY_LOOSE = re.compile(r"^\s*(?P<title>\S.*?[^\d\s])\s{2,}(?P<page>\d{1,4})\s*$")
# Структурные маркеры учебника.
_STRUCTURAL = re.compile(r"(^|\s)(глава|часть|раздел|§|chapter|part)\b", re.I)


@dataclass
class TocPage:
    page_number: int
    is_toc: bool
    confidence: float
    signals: list[str] = field(default_factory=list)


def entry_page_number(line: str) -> int | None:
    """Номер печатной страницы в конце строки оглавления, если он там есть."""
    for pattern in (_ENTRY, _ENTRY_LOOSE):
        match = pattern.match(line)
        if match:
            return int(match.group("page"))
    return None


def _score_page(page_number: int, text: str, total_pages: int) -> TocPage:
    lines = [line for line in (text or "").split("\n") if line.strip()]
    if not lines:
        return TocPage(page_number, False, 0.0)

    signals: list[str] = []
    score = 0.0

    if any(_TITLE_MARKER.match(line) for line in lines):
        signals.append("title_marker")
        score += 0.45

    pages = [entry_page_number(line) for line in lines]
    numbered = [p for p in pages if p is not None]
    if len(numbered) >= TOC_MIN_ENTRIES:
        signals.append("trailing_page_numbers")
        score += 0.3
        if len(numbered) / len(lines) >= TOC_MIN_ENTRY_RATIO:
            signals.append("entry_density")
            score += 0.1

    # Номера страниц в оглавлении растут. В таблице с числами — как придётся,
    # и это главный признак, отличающий оглавление от любой другой страницы,
    # где числа стоят справа.
    if len(numbered) >= TOC_MIN_ENTRIES:
        ascending = sum(
            1 for a, b in zip(numbered, numbered[1:]) if b >= a
        )
        if ascending / max(1, len(numbered) - 1) >= 0.85:
            signals.append("monotonic_page_sequence")
            score += 0.25

    if sum(1 for line in lines if _DOT_LEADER.search(line)) >= TOC_MIN_ENTRIES:
        signals.append("dot_leaders")
        score += 0.15

    if sum(1 for line in lines if _STRUCTURAL.search(line)) >= 2:
        signals.append("structural_markers")
        score += 0.1

    # Оглавление живёт с краёв книги. В середине его не бывает, а таблиц с
    # числами — сколько угодно.
    near_edge = (
        page_number <= TOC_HEAD_PAGES
        or page_number > max(0, total_pages - TOC_TAIL_PAGES)
    )
    if near_edge:
        signals.append("near_edge")
    else:
        score *= 0.5

    confidence = min(1.0, round(score, 3))
    return TocPage(page_number, confidence >= TOC_PAGE_CONFIDENCE, confidence, signals)


def detect_toc_pages(pages: dict[int, str]) -> list[TocPage]:
    """Оценивает каждую страницу; возвращает только похожие на оглавление.

    `pages` — номер страницы PDF → её текст.
    """
    if not pages:
        return []
    total = max(pages)
    scored = [_score_page(number, text, total) for number, text in sorted(pages.items())]
    return [page for page in scored if page.is_toc]


def toc_page_span(pages: dict[int, str]) -> list[int]:
    """Непрерывный блок страниц оглавления.

    Оглавление идёт подряд. Одиночная страница где-то посередине книги, набравшая
    порог случайно, блоком не является и отбрасывается — иначе её записи попадут
    в структуру наравне с настоящими.
    """
    detected = detect_toc_pages(pages)
    if not detected:
        return []

    numbers = sorted(page.page_number for page in detected)
    runs: list[list[int]] = [[numbers[0]]]
    for number in numbers[1:]:
        if number == runs[-1][-1] + 1:
            runs[-1].append(number)
        else:
            runs.append([number])

    best = max(runs, key=len)
    return best if len(best) >= 1 else []

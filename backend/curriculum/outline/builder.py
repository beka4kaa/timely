"""Сборка структуры книги из лучшего доступного источника.

Порядок один и тот же для любой книги: сначала то, что заявил издатель
(закладки PDF, навигация EPUB), затем то, что напечатано в самой книге
(оглавление), и только потом наши догадки по телу.

Догадка по телу — это последний рубеж, а не равноправный вариант. Именно она
когда-то дала 26 «глав», из которых 12 были вопросами к параграфам: строка
«1. Вектор o» получала верхний уровень просто потому, что начиналась с цифры.
Поэтому при работе от тела уровень поднимается только у того, что доказано
нумерацией или маркером раздела.
"""

from __future__ import annotations

from .contracts import Outline, OutlineNode, Source, SOURCE_CONFIDENCE
from .roles import apply_roles
from .toc_detector import toc_page_span
from .toc_parser import parse_toc_lines
from .verify import verify_against_body


def build_from_toc(pages: dict[int, str]) -> Outline | None:
    """Структура из печатного оглавления книги."""
    span = toc_page_span(pages)
    if not span:
        return None

    lines: list[str] = []
    for page_number in span:
        lines.extend((pages.get(page_number) or "").split("\n"))

    nodes = parse_toc_lines(lines)
    if not nodes:
        return None

    outline = Outline(
        nodes=nodes,
        source=Source.TABLE_OF_CONTENTS,
        confidence=SOURCE_CONFIDENCE[Source.TABLE_OF_CONTENTS],
        signals=[f"toc_pages={span[0]}-{span[-1]}"],
    )
    verify_against_body(outline, pages)
    apply_roles(outline)
    return outline


def build_from_embedded(entries: list[OutlineNode], source: str) -> Outline | None:
    """Структура из закладок PDF или навигации EPUB.

    Заявление издателя: уровни там уже проставлены, и придумывать их не нужно.
    """
    if not entries:
        return None
    outline = Outline(
        nodes=entries,
        source=source,
        confidence=SOURCE_CONFIDENCE[source],
        signals=[f"{source}_entries={len(entries)}"],
    )
    for node in outline.nodes:
        node.source = source
        node.confidence = SOURCE_CONFIDENCE[source]
        node.verified = True
    apply_roles(outline)
    return outline


def build_outline(
    pages: dict[int, str],
    *,
    embedded: list[OutlineNode] | None = None,
    embedded_source: str = Source.PDF_OUTLINE,
    fallback: list[OutlineNode] | None = None,
) -> Outline:
    """Лучшая доступная структура книги.

    `fallback` — то, что дал разбор тела (`blocks.classify_pages`). Он идёт в
    дело, только если ни издательской разметки, ни оглавления нет, и уверенность
    у него соответствующая: такую структуру нельзя считать подтверждённой.
    """
    outline = build_from_embedded(embedded or [], embedded_source)
    if outline is not None:
        return outline

    outline = build_from_toc(pages)
    if outline is not None:
        return outline

    nodes = fallback or []
    outline = Outline(
        nodes=nodes,
        source=Source.HEURISTIC,
        confidence=SOURCE_CONFIDENCE[Source.HEURISTIC],
        signals=["no_toc", "no_embedded_outline"],
    )
    for node in nodes:
        node.source = Source.HEURISTIC
        node.confidence = min(node.confidence or 0.0, SOURCE_CONFIDENCE[Source.HEURISTIC])
        node.verified = False
    apply_roles(outline)
    return outline

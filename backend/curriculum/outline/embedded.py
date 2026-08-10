"""Закладки PDF → структура книги.

Издатель уже разметил книгу: у «Hands-On Machine Learning» 234 закладки с
точными страницами и уровнями. Пока их не читали, структура бралась из тела, и
модулями курса становились `WARNING`, `NOTE` и `TIP` — подписи врезок O'Reilly,
набранные капсом на каждой второй странице.

Модуль чистый: ни pypdfium2, ни Django. На вход идут уже прочитанные тройки
`(уровень, название, страница)`, на выход — узлы `OutlineNode`. Так отображение
проверяется без файла и без сети.

Три вещи, которые приходится решать отдельно.

**Уровни у закладок свои.** Они нумеруются с нуля, а у нас 1 — часть, 2 — глава,
3 — раздел. Хуже того, наверху дерево часто плоское: «I. The Fundamentals of
Machine Learning» и «1. The Machine Learning Landscape» стоят соседями, часть не
содержит глав.

**Номер зашит в название.** Закладка называется «1. The Machine Learning
Landscape», а интерфейс печатает номер отдельно — иначе выйдет «1  1. The
Machine Learning Landscape».

**Конца раздела в закладках нет.** Есть только начало, а конец — это страница
перед следующей закладкой.
"""

from __future__ import annotations

import re

from .contracts import OutlineNode

# Часть книги: римская нумерация или прямое слово. «I. The Fundamentals»,
# «Part 2 Neural Networks», «Часть I».
_PART = re.compile(r"^\s*(?:(?:part|часть)\s+)?([IVXLC]+|\d+)\s*[.:]?\s+", re.I)
_PART_WORD = re.compile(r"^\s*(?:part|часть)\b", re.I)
_ROMAN = re.compile(r"^\s*([IVXLC]+)\s*[.:]\s+")
# Глава: арабский номер в начале. «1. The Machine Learning Landscape»,
# «Chapter 3 Classification».
_CHAPTER = re.compile(r"^\s*(?:(?:chapter|глава)\s+)?(\d+)\s*[.:]?\s+(?=\S)", re.I)
_CHAPTER_WORD = re.compile(r"^\s*(?:chapter|глава)\b", re.I)

# Наши уровни.
PART_LEVEL = 1
CHAPTER_LEVEL = 2


def nodes_from_bookmarks(
    items: list[tuple[int, str, int]], *, total_pages: int
) -> list[OutlineNode]:
    """Закладки в порядке книги → узлы структуры.

    `items` — тройки `(уровень закладки с нуля, название, страница с единицы)`.
    """
    cleaned = [
        (int(level), (title or "").strip(), max(1, int(page)))
        for level, title, page in items
        if (title or "").strip()
    ]
    if not cleaned:
        return []

    shift = _level_shift(cleaned)
    levels = [_level_for(level, title, shift) for level, title, _ in cleaned]

    nodes: list[OutlineNode] = []
    for index, (_, title, page) in enumerate(cleaned):
        # Конец раздела — страница перед следующим разделом ТОГО ЖЕ или более
        # высокого уровня. По ближайшей закладке считать нельзя: у главы это её
        # собственный первый параграф, и глава на семьдесят страниц получила бы
        # одну.
        next_page = next(
            (
                cleaned[j][2]
                for j in range(index + 1, len(cleaned))
                if levels[j] <= levels[index]
            ),
            total_pages + 1,
        )
        end_page = max(page, min(total_pages, next_page - 1))

        number_label, clean_title = _split_number(title)
        nodes.append(
            OutlineNode(
                title=clean_title,
                level=levels[index],
                number_label=number_label,
                start_page=page,
                end_page=end_page,
                # Печатный номер страницы закладки не несут: они указывают на
                # страницу PDF. Подменять одно другим нельзя — у книги с
                # предисловием на римских номерах это откроет не ту страницу.
                printed_page=None,
                order_index=index,
            )
        )

    _assign_parents(nodes)
    return nodes


def _level_shift(items: list[tuple[int, str, int]]) -> int:
    """Сдвиг уровней: 0 для плоского верха, 1 для вложенного дерева.

    Плоский верх — когда часть и глава стоят соседями на одном уровне закладок,
    как в книгах O'Reilly. Тогда часть надо опустить до 1, а главу оставить на 2,
    и общий сдвиг не нужен. Если же часть действительно содержит главы, весь
    уровень закладок смещается на единицу.
    """
    top = min(level for level, _, _ in items)
    for index, (level, title, _) in enumerate(items):
        if level != top or not _looks_like_part(title):
            continue
        following = items[index + 1] if index + 1 < len(items) else None
        if following is not None and following[0] > level:
            return 1  # у части есть свои закладки — дерево вложенное
    return 0


def _level_for(bookmark_level: int, title: str, shift: int) -> int:
    """Уровень закладки → наш уровень."""
    if bookmark_level > 0:
        return bookmark_level + CHAPTER_LEVEL - shift
    if shift:
        # Вложенное дерево: верхний уровень закладок — это части, главы лежат
        # под ними.
        return PART_LEVEL
    return PART_LEVEL if _looks_like_part(title) else CHAPTER_LEVEL


def _looks_like_part(title: str) -> bool:
    """Часть книги, а не глава.

    Различаются по нумерации: части нумеруют римскими цифрами или словом
    «Part», главы — арабскими. Слово важнее цифры: «Part 2» — часть, хотя
    номер арабский.
    """
    if _PART_WORD.match(title):
        return True
    if _CHAPTER_WORD.match(title):
        return False
    return bool(_ROMAN.match(title))


def _split_number(title: str) -> tuple[str, str]:
    """«1. The Machine Learning Landscape» → («1», «The Machine Learning…»).

    Возвращает пустой номер, если его нет: у «Preface» и «About the Author»
    нумерации не бывает.
    """
    for pattern in (_CHAPTER, _PART):
        match = pattern.match(title)
        if not match:
            continue
        rest = title[match.end() :].strip()
        if not rest:
            # Номер без названия — это и есть всё название («Глава 1»).
            return "", title.strip()
        prefix = title[: match.start(1)].strip()
        label = f"{prefix} {match.group(1)}".strip() if prefix else match.group(1)
        return label, rest
    return "", title.strip()


def _assign_parents(nodes: list[OutlineNode]) -> None:
    """Родитель — ближайший предыдущий узел меньшего уровня."""
    stack: dict[int, int] = {}
    for index, node in enumerate(nodes):
        parent = next(
            (
                stack[level]
                for level in sorted(stack, reverse=True)
                if level < node.level
            ),
            None,
        )
        node.parent_index = parent
        stack[node.level] = index
        # Уровни глубже текущего больше не актуальны: следующий узел того же
        # уровня не может оказаться потомком закрытой ветки.
        for level in [key for key in stack if key > node.level]:
            del stack[level]

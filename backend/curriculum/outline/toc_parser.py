"""Разбор строк оглавления в узлы структуры.

Детерминированно и без модели. Оглавление — это уже разметка, сделанная
издателем: номер, название, печатная страница. Её нужно прочитать, а не угадать.

Ключевое различение уровней взято из самих данных, а не из вёрстки (кегля и
отступов у нас нет). В оглавлении есть два вида строк:

* с печатным номером страницы — это раздел («§ 1.9. Как решать задачи … 52»);
* без номера — это заголовок-контейнер («Введение», «Кинематика»).

Контейнер, под которым идут разделы, — глава. Контейнер, под которым сразу идёт
другой контейнер, — часть. Этого достаточно, чтобы «Введение» стало частью, а
«Зарождение и развитие научного взгляда на мир» — главой внутри неё, и при этом
ни одна строка из тела книги не может притвориться главой: её просто нет в
оглавлении.
"""

from __future__ import annotations

import re

from .contracts import OutlineNode, Role, Source
from .thresholds import CONFIDENCE_HIGH
from .toc_detector import entry_page_number

# «§ 1.», «§ 1.9.», «§\xa01.10.» — номер параграфа вместе со знаком.
_PARAGRAPH = re.compile(r"^\s*(§\s*[\d.]+\.?)\s*(?P<rest>\S.*)$")
# «Глава 1», «Часть II», «Раздел 3».
_CHAPTER_WORD = re.compile(
    r"^\s*((?:глава|часть|раздел)\s+[\dIVXLC]+\.?)\s*(?P<rest>.*)$", re.I
)
# Хвост из выносок и номера страницы.
_TAIL = re.compile(r"\s*(?:\.\s*){2,}\s*\d{1,4}\s*$")
_TRAILING_NUMBER = re.compile(r"\s+\d{1,4}\s*$")
# Служебные строки самой книги: колонцифра и заголовок «Оглавление».
_RUNNING_NUMBER = re.compile(r"^\s*\d{1,4}\s*$")
_TOC_TITLE = re.compile(r"^\s*(оглавление|содержание|contents)\s*$", re.I)

# Разделы, которые не являются учебной единицей. Список намеренно про роль, а
# не про удаление: «Ответы» остаются в структуре и на них можно сослаться.
_ROLE_BY_KEYWORD: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"^\s*упражнени", re.I), Role.EXERCISE_SET),
    (re.compile(r"^\s*задачи\s+для", re.I), Role.EXERCISE_SET),
    (re.compile(r"^\s*лабораторн", re.I), Role.LABORATORY),
    (re.compile(r"^\s*(ответы|решения)\b", re.I), Role.ANSWERS),
    (re.compile(r"^\s*(литератур|библиограф)", re.I), Role.BIBLIOGRAPHY),
    (re.compile(r"^\s*(алфавитный\s+указатель|предметный\s+указатель)", re.I), Role.INDEX),
    (re.compile(r"^\s*(предислови|от\s+автор|введение\s*$)", re.I), Role.INTRODUCTION),
    (re.compile(r"^\s*(приложени)", re.I), Role.APPENDIX),
    (re.compile(r"^\s*(краткие\s+итоги|итоги|выводы)", re.I), Role.SUMMARY),
    (re.compile(r"^\s*примеры\s+решения", re.I), Role.WORKED_EXAMPLES),
)


def _starts_lowercase(line: str) -> bool:
    """Строка начинается со строчной буквы, то есть это перенос, а не заголовок."""
    return bool(re.match(r"^\s*[a-zа-яё]", line))


def _clean_title(text: str) -> str:
    """Убирает выноски, хвостовой номер и лишние пробелы."""
    cleaned = _TAIL.sub("", text)
    cleaned = _TRAILING_NUMBER.sub("", cleaned)
    cleaned = cleaned.replace("\xa0", " ")
    return re.sub(r"\s+", " ", cleaned).strip(" .")


def _role_for(title: str, has_page: bool, is_container: bool) -> str:
    for pattern, role in _ROLE_BY_KEYWORD:
        if pattern.match(title):
            return role
    if is_container:
        return Role.CHAPTER
    return Role.SECTION if has_page else Role.UNKNOWN


def _join_wrapped(lines: list[str]) -> list[str]:
    """Склеивает записи, перенесённые на следующую строку.

    В оглавлении длинное название переносится, а номер страницы остаётся на
    последней строке записи: «§ 3. Зарождение и развитие современного научного
    метода » + «исследования . . . 8». Без склейки вторая половина выглядит
    самостоятельной записью с номером 8.
    """
    joined: list[str] = []
    buffer = ""
    # Перенос бывает только у записи, начатой «§» или «Глава»: именно у неё
    # есть номер страницы, который и уехал на следующую строку. Строка без
    # такого начала — самостоятельный заголовок-контейнер, и приклеивать её к
    # соседям нельзя: иначе «Введение» срастается с «§ 1.» и забирает его
    # страницу себе, а сам § исчезает.
    entry_open = False

    def flush() -> None:
        nonlocal buffer, entry_open
        if buffer:
            joined.append(buffer)
        buffer = ""
        entry_open = False

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            continue
        if _RUNNING_NUMBER.match(line) or _TOC_TITLE.match(line):
            continue

        starts_entry = bool(_PARAGRAPH.match(line) or _CHAPTER_WORD.match(line))
        if starts_entry:
            flush()
            buffer, entry_open = line, True
        elif entry_open:
            buffer = f"{buffer} {line.strip()}"
        elif buffer and _starts_lowercase(line):
            # Продолжение названия контейнера: «Основные особенности
            # физического метода» + «исследования». Заголовок с новой строки
            # со строчной буквы не начинается — значит это перенос, а не
            # следующий раздел.
            buffer = f"{buffer} {line.strip()}"
        else:
            # Самостоятельный контейнер: отдаём как есть и ничего не копим.
            flush()
            buffer, entry_open = line, False

        if entry_page_number(line) is not None:
            flush()

    flush()
    return joined


def parse_toc_lines(lines: list[str]) -> list[OutlineNode]:
    """Строки страниц оглавления → узлы структуры."""
    nodes: list[OutlineNode] = []
    for line in _join_wrapped(lines):
        printed = entry_page_number(line)
        number_label = ""
        rest = line

        paragraph = _PARAGRAPH.match(line)
        chapter_word = _CHAPTER_WORD.match(line)
        if paragraph:
            number_label = re.sub(r"\s+", " ", paragraph.group(1).replace("\xa0", " ")).strip()
            rest = paragraph.group("rest")
        elif chapter_word:
            number_label = re.sub(r"\s+", " ", chapter_word.group(1)).strip()
            rest = chapter_word.group("rest")

        title = _clean_title(rest)
        if not title and number_label:
            title = number_label
        if not title:
            continue

        is_container = printed is None and not paragraph
        nodes.append(
            OutlineNode(
                title=title,
                level=0,  # проставляется ниже, когда виден весь список
                role=_role_for(title, printed is not None, is_container),
                number_label=number_label,
                printed_page=printed,
                source=Source.TABLE_OF_CONTENTS,
                confidence=CONFIDENCE_HIGH,
            )
        )

    _assign_levels(nodes)
    return nodes


def _assign_levels(nodes: list[OutlineNode]) -> None:
    """Расставляет уровни и родителей по составу оглавления.

    Контейнер, у которого дальше идут разделы, — глава (уровень 2). Контейнер,
    за которым сразу идёт другой контейнер, — часть (уровень 1). Раздел всегда
    лежит под ближайшим контейнером.
    """
    containers = [i for i, node in enumerate(nodes) if node.printed_page is None]
    container_set = set(containers)

    for index in containers:
        following = nodes[index + 1] if index + 1 < len(nodes) else None
        has_direct_sections = following is not None and (index + 1) not in container_set
        nodes[index].level = 2 if has_direct_sections else 1
        nodes[index].role = (
            nodes[index].role if nodes[index].role not in {Role.CHAPTER, Role.UNKNOWN}
            else (Role.CHAPTER if has_direct_sections else Role.PART)
        )

    last_part: int | None = None
    last_chapter: int | None = None
    for index, node in enumerate(nodes):
        node.order_index = index
        if index in container_set:
            if node.level == 1:
                node.parent_index = None
                last_part, last_chapter = index, None
            else:
                node.parent_index = last_part
                last_chapter = index
            continue

        parent = last_chapter if last_chapter is not None else last_part
        node.parent_index = parent
        node.level = (nodes[parent].level + 1) if parent is not None else 1

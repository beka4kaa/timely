"""Разметка текста страницы в типизированные блоки.

Это недостающее звено пайплайна: `chunking.chunk_blocks` принимает
`SourceBlock`, но до сих пор их никто не создавал нигде, кроме
`tests/test_chunking.py`. Здесь текст страницы превращается в те самые блоки.

Почему без LLM. Тип блока определяет политику доступа: `solution` уезжает в
чанк с `solution_visibility="restricted"` и не должен попасть ученику в режиме
`solve`. Если тип назначает модель, то галлюцинация классификатора становится
утечкой решения. Плюс требование детерминированности из `chunking`: одинаковый
вход обязан давать побитово одинаковый `content_hash`, иначе переиндексация
плодит «новые» чанки и `CourseSourceBinding` ссылается на исчезнувшие ID.
Поэтому здесь только явные маркеры и никакой сети.

Маркеры русскоязычные: учебники в проекте русские (`preferred_language="ru"`),
латиница добавлена как дополнение, а не как основной путь.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .chunking import SourceBlock

# ─────────────────────────── Маркеры начала блока ────────────────────────────
# Ключ — тип блока в терминах `models.DocumentBlock.kind`; порядок проверки
# важен: «Доказательство» должно проверяться раньше «Теоремы», иначе строка
# «Доказательство теоремы 1» уедет в theorem.
# Граница после маркера: «не буква». Именно так, а НЕ `\b`: у сокращений вида
# `рис\.` и `опр\.` граница `\b` после литеральной точки не срабатывает никогда,
# потому что и точка, и следующий пробел — не-словные символы, и границы между
# ними нет. Из-за этого подписи «Рис. 4. Схема сил.» молча уезжали в прозу.
# `(?![^\W\d_])` разрешает и «Рис. 4», и «Рис.4», но отвергает «рисование».
_AFTER = r"(?![^\W\d_])"

_BLOCK_MARKERS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("proof", re.compile(rf"^\s*(доказательство|proof){_AFTER}", re.I)),
    ("definition", re.compile(rf"^\s*(определение|опр\.|definition){_AFTER}", re.I)),
    (
        "theorem",
        re.compile(rf"^\s*(теорема|лемма|следствие|theorem|lemma){_AFTER}", re.I),
    ),
    ("solution", re.compile(rf"^\s*(решение|ответ|solution|answer){_AFTER}", re.I)),
    ("example", re.compile(rf"^\s*(пример|example){_AFTER}", re.I)),
    (
        "exercise",
        re.compile(
            rf"^\s*(задача|задание|упражнение|exercise|problem){_AFTER}", re.I
        ),
    ),
    (
        "summary",
        re.compile(rf"^\s*(краткие итоги|итоги|выводы|summary){_AFTER}", re.I),
    ),
    (
        "caption",
        re.compile(
            rf"^\s*(рис\.|рисунок|табл\.|таблица|fig\.|figure|table){_AFTER}", re.I
        ),
    ),
)

# Номер СРАЗУ после слова-маркера: «Задача 12.3.», «Теорема 2 (Пифагора)».
# Ищется только в остатке строки после маркера, а не по всей строке: иначе
# «Решение. s = v0 t + a t^2 / 2.» получало number_label="0", выхваченный из
# «v0». У решения своего номера нет — оно наследует связь с задачей через
# `task_block_id`.
_NUMBER_LABEL = re.compile(r"^[\s.:)№-]*(\d+(?:[.\-]\d+)*)")

# Заголовок раздела: «1.2 Кинематика», «§ 3. Динамика», «Глава 4. Энергия».
_HEADING_NUMBERED = re.compile(
    r"^\s*(?:глава\s+|§\s*|chapter\s+)?(\d+(?:\.\d+)*)(\.?)\s+(\S.*)$", re.I
)
# Явный маркер раздела. Строка с ним — заголовок независимо от того, как
# выглядит остаток: «§», «Глава», «Chapter» в теле текста не встречаются.
_HEADING_MARKER = re.compile(r"^\s*(?:глава\s+|§|chapter\s+)", re.I)
# Заголовок без номера: короткая строка без точки на конце.
_HEADING_MAX_CHARS = 80
# Голая нумерация («3. Динамика») — заголовок, только если остаток КОРОТКИЙ.
# Иначе это нумерованный вопрос из упражнений: «1. Можно ли автомобиль считать
# точкой при его движении по…». Порог по длине разделяет их надёжнее, чем любая
# лексика: заголовок называет тему, вопрос — это предложение.
_BARE_NUMBER_TITLE_MAX_CHARS = 40
# Сколько строк «N. …» на странице означают список упражнений, а не заголовки.
_NUMBERED_LIST_MIN_ITEMS = 3
# Библиографический аппарат с оборота титула. Капсом, но разделом не является.
_FRONT_MATTER = re.compile(r"^\s*(удк|ббк|isbn|issn)\b", re.I)
# Сколько строк максимум склеиваем в один заголовок и до какой длины. Разрыв
# заголовка по визуальным строкам — норма для PDF («ЗАРОЖДЕНИЕ И РАЗВИТИЕ» +
# «НАУЧНОГО ВЗГЛЯДА НА МИР»), и без склейки каждая половина становилась
# отдельным разделом с бессмысленным названием.
_HEADING_MERGE_MAX_LINES = 3
_HEADING_MERGE_MAX_CHARS = 120

# Формульная строка: почти нет букв, но есть математические знаки.
_MATH_CHARS = re.compile(r"[=+\-−×·/∫∑√≤≥≠∞∂π°]")
_LETTERS = re.compile(r"[^\W\d_]", re.UNICODE)


@dataclass(frozen=True)
class SectionNode:
    """Раздел с материализованным путём для `DocumentSection.path`."""

    path: str  # "1.2.3"
    title: str
    kind: str  # chapter | section | subsection
    order_index: int
    start_page: int
    end_page: int
    parent_path: str = ""


@dataclass
class PageText:
    """Минимальный вход классификатора: номер страницы и её текст.

    Отдельный тип, а не `ExtractedPage`, чтобы `blocks.py` не зависел от
    `extraction.py` и от pypdfium2: OCR-страница приходит сюда таким же
    объектом, но её текст получен от vision-модели.
    """

    page_number: int
    text: str


def _is_caps(text: str) -> bool:
    """Строка целиком капсом и содержит осмысленное слово."""
    letters = _LETTERS.findall(text)
    if len(letters) < 3:
        return False
    return all(ch == ch.upper() for ch in letters)


def _bare_numbered(line: str) -> bool:
    """Строка вида «7. Текст» — без §/Главы и без многоуровневого номера."""
    match = _HEADING_NUMBERED.match(line.strip())
    if not match or _HEADING_MARKER.match(line.strip()):
        return False
    number, dot, title = match.groups()
    return bool(dot) and "." not in number and _has_meaningful_title(title)


def _is_numbered_list(lines: list[str]) -> bool:
    """Много строк «N. …» подряд на странице — это список, а не заголовки.

    Разделять «3. Динамика» и «3. Почему второй закон Ньютона называют…» по
    словарю невозможно, а по длине — ненадёжно: строка вопроса приходит из PDF
    уже перенесённой и потому короткой. Зато список виден по количеству:
    заголовок на странице один-два, а вопросов к параграфу — десяток. На
    «Механике» Мякишева это правило снимает 125 ложных разделов, оставляя
    нумерованные заголовки в книгах, где их верстают без «§».
    """
    return sum(1 for line in lines if _bare_numbered(line)) >= _NUMBERED_LIST_MIN_ITEMS


def _looks_like_heading(line: str, *, in_numbered_list: bool = False) -> bool:
    """Заголовок — только явно размеченный: с номером или капсом.

    Раньше здесь было «короткая строка без точки на конце» — и это ломалось на
    любом реальном учебнике: перенос абзаца («Тело движется по прямой с
    постоянным») подходит под это правило целиком. Такие строки становились
    разделами, забирали себе `section_path`, и остаток абзаца приписывался не к
    тому разделу. А `section_path` уходит в `CourseSourceBinding`, то есть
    ошибка здесь превращается в неверную ссылку на источник у темы курса.

    Оставшаяся редакция («номер ИЛИ капс») тоже оказалась слишком широкой.
    Замерено на «Механика, 10 класс» Мякишева (513 страниц): 1151 «раздел», из
    них 1015 — по номеру. Ложные срабатывания были трёх видов:

    * сноска, приклеенная к первой строке абзаца:
      «1 Это введение при первом чтении может показаться сложным.»;
    * нумерованный вопрос из упражнений:
      «1. Можно ли автомобиль считать точкой при его движении по»;
    * колонцифра, слипшаяся с обрывком формулы: «2 2», «1 1».

    Настоящие заголовки этой книги выглядят иначе — «§ 1. НЕОБХОДИМОСТЬ
    ПОЗНАНИЯ ПРИРОДЫ». Отсюда три правила ниже: явный маркер раздела снимает все
    вопросы; многоуровневый номер («1.2 Кинематика») тоже; а голый номер обязан
    вести к КОРОТКОМУ названию, потому что заголовок называет тему, тогда как
    вопрос и сноска — это предложения.
    """
    stripped = line.strip()
    if not stripped or len(stripped) > _HEADING_MAX_CHARS:
        return False
    if _FRONT_MATTER.match(stripped):
        return False

    match = _HEADING_NUMBERED.match(stripped)
    if match:
        _, dot, title = match.groups()
        if not _has_meaningful_title(title):
            return False
        if _HEADING_MARKER.match(stripped):
            return True
        if "." in match.group(1):
            return True
        # Голый номер: без точки это почти всегда сноска или колонцифра.
        if not dot:
            return False
        if _is_caps(title):
            return True
        # Сентенс-кейс с голым номером — заголовок только вне списка.
        if in_numbered_list:
            return False
        return len(title) <= _BARE_NUMBER_TITLE_MAX_CHARS

    # Капс без номера: та же проверка на формулу обязательна и здесь. Строка
    # «F = 0,5 Н + 100 Н = 100,5 Н.» состоит из заглавных букв и иначе прошла бы.
    return _is_caps(stripped) and _has_meaningful_title(stripped)


def _has_meaningful_title(title: str) -> bool:
    """Название должно содержать слово, а не цифру, знак или формулу.

    Без проверки на буквы строка «2 2» превращалась в раздел с названием «2» —
    таких было 23 штуки на одну книгу. Знак равенства отсекается отдельно:
    «SOABC = +» состоит из заглавных букв и проходит проверку на капс, но
    заголовком, разумеется, не является.
    """
    if "=" in title:
        return False
    return len(_LETTERS.findall(title)) >= 3


def _is_formula(paragraph: str) -> bool:
    text = paragraph.strip()
    if not text or len(text) > 200:
        return False
    if not _MATH_CHARS.search(text):
        return False
    letters = len(_LETTERS.findall(text))
    return letters <= max(4, len(text) // 5)


def _marker_kind(paragraph: str) -> tuple[str, str]:
    """Возвращает `(kind, number_label)`; kind пустой, если маркера нет."""
    for kind, pattern in _BLOCK_MARKERS:
        match = pattern.match(paragraph)
        if match:
            number = _NUMBER_LABEL.match(paragraph[match.end() :])
            return kind, (number.group(1) if number else "")
    return "", ""


def _group_lines(text: str) -> list[tuple[str, str, str]]:
    """Группирует строки страницы в блоки: `(kind, number_label, text)`.

    Группировка построчная, а НЕ по пустым строкам. Это принципиально: pdfium
    (как и любой экстрактор) отдаёт по строке на каждую визуальную строку и
    пустых строк между абзацами обычно НЕ ставит. Разбиение по пустой строке на
    реальном учебнике возвращало всю страницу одним блоком `paragraph` — вместе
    с условием задачи И её решением внутри. После этого чанк уходил бы с
    `solution_visibility="always"`, то есть решение утекало бы ученику в режиме
    `solve`. Ровно тот сценарий, от которого предупреждает docstring `chunking`.

    Поэтому новый блок начинает маркер, заголовок, формула или пустая строка, а
    продолжение абзаца просто дописывается в текущий буфер.
    """
    groups: list[tuple[str, str, str]] = []
    buffer: list[str] = []
    kind = "paragraph"
    number_label = ""

    def flush() -> None:
        nonlocal buffer, kind, number_label
        if buffer:
            body = "\n".join(buffer).strip()
            if body:
                groups.append((kind, number_label, body))
        buffer = []
        kind = "paragraph"
        number_label = ""

    lines = [raw.strip() for raw in (text or "").split("\n")]
    numbered_list = _is_numbered_list(lines)
    index = 0
    while index < len(lines):
        line = lines[index]
        if not line:
            flush()
            index += 1
            continue

        marker_kind, marker_number = _marker_kind(line)
        if marker_kind:
            flush()
            kind, number_label = marker_kind, marker_number
            buffer.append(line)
            index += 1
            continue

        if _looks_like_heading(line, in_numbered_list=numbered_list):
            flush()
            heading, index = _take_heading(lines, index)
            groups.append(("__heading__", "", heading))
            continue

        if _is_formula(line):
            flush()
            groups.append(("formula", "", line))
            index += 1
            continue

        buffer.append(line)
        index += 1

    flush()
    return groups


def _take_heading(lines: list[str], start: int) -> tuple[str, int]:
    """Собирает заголовок, разорванный по визуальным строкам.

    PDF отдаёт по строке на каждую строку вёрстки, поэтому «§ 3. ЗАРОЖДЕНИЕ И
    РАЗВИТИЕ / НАУЧНОГО ВЗГЛЯДА НА МИР» приходит двумя строками. Без склейки
    вторая половина становилась отдельным разделом с названием-обрывком.

    Продолжением считается только строка целиком капсом и без собственной
    нумерации: у следующего заголовка номер или маркер есть, и он склеен не
    будет. Ограничения по числу строк и длине не дают слипнуться странице,
    свёрстанной капсом целиком.
    """
    parts = [lines[start]]
    index = start + 1
    while (
        index < len(lines)
        and len(parts) < _HEADING_MERGE_MAX_LINES
        and lines[index]
        and _is_caps(lines[index])
        and _has_meaningful_title(lines[index])
        and not _HEADING_NUMBERED.match(lines[index])
        and not _HEADING_MARKER.match(lines[index])
        and not _marker_kind(lines[index])[0]
        and not _FRONT_MATTER.match(lines[index])
        and len(" ".join(parts)) + 1 + len(lines[index]) <= _HEADING_MERGE_MAX_CHARS
    ):
        parts.append(lines[index])
        index += 1
    return " ".join(parts), index


def _heading_kind(path: str) -> str:
    depth = path.count(".") + 1 if path else 1
    if depth <= 1:
        return "chapter"
    return "section" if depth == 2 else "subsection"


@dataclass
class _State:
    """Состояние обхода: путь раздела и связь решения с задачей."""

    section_path: str = ""
    section_title: str = ""
    last_task_block_id: str | None = None
    reading_order: int = 0
    sections: list[SectionNode] = field(default_factory=list)


def classify_text_run(text: str) -> list[tuple[str, str, str]]:
    """Разметка произвольного куска текста: `(kind, number_label, body)`.

    Публичная обёртка над построчной группировкой. Нужна EPUB-извлекателю:
    структуру разделов там даёт HTML, а вот маркеры внутри абзаца («Задача 5.»,
    «Решение.», «Определение.») ровно те же, что в PDF, и заводить для них
    вторую реализацию значило бы гарантированно получить две разные.
    """
    return _group_lines(text)


def classify_pages(
    pages: list[PageText], *, document_id: str = "doc"
) -> tuple[list[SourceBlock], list[SectionNode]]:
    """Основная точка входа: страницы → блоки и разделы.

    Чистая функция: одинаковый вход даёт одинаковые `block_id` и порядок. ID
    строятся из номера страницы и позиции абзаца, а не из счётчика UUID, чтобы
    повторный прогон над той же книгой дал те же идентификаторы.
    """
    state = _State()
    blocks: list[SourceBlock] = []

    for page in sorted(pages, key=lambda p: p.page_number):
        for position, (kind, number_label, body) in enumerate(
            _group_lines(page.text)
        ):
            # Заголовок раздела: не блок, а смена section_path.
            if kind == "__heading__":
                _push_section(state, body, page.page_number)
                continue

            block_id = f"{document_id}-p{page.page_number:04d}-b{position:03d}"
            task_block_id = None
            if kind == "solution":
                # Решение связывается с последней задачей, но остаётся отдельным
                # блоком: слияние сделало бы политику доступа бессмысленной.
                task_block_id = state.last_task_block_id

            block = SourceBlock(
                block_id=block_id,
                kind=kind,
                text=body,
                page=page.page_number,
                reading_order=state.reading_order,
                section_path=state.section_path,
                section_id=state.section_path or None,
                task_block_id=task_block_id,
                number_label=number_label,
            )
            blocks.append(block)
            state.reading_order += 1

            if kind == "exercise":
                state.last_task_block_id = block_id

    _close_sections(state, blocks)
    return blocks, state.sections


def _push_section(state: _State, line: str, page_number: int) -> None:
    match = _HEADING_NUMBERED.match(line.strip())
    if match:
        path, title = match.group(1), match.group(3).strip()
    else:
        # Заголовок без номера продолжает нумерацию на текущем уровне.
        title = line.strip()
        path = _next_sibling_path(state.section_path, state.sections)

    state.section_path = path
    state.section_title = title
    state.sections.append(
        SectionNode(
            path=path,
            title=title,
            kind=_heading_kind(path),
            order_index=len(state.sections),
            start_page=page_number,
            end_page=page_number,
            parent_path=path.rsplit(".", 1)[0] if "." in path else "",
        )
    )


def _next_sibling_path(current: str, sections: list[SectionNode]) -> str:
    if not current:
        tops = [s for s in sections if "." not in s.path and s.path.isdigit()]
        return str(len(tops) + 1)
    head, _, tail = current.rpartition(".")
    if tail.isdigit():
        return f"{head}.{int(tail) + 1}" if head else str(int(tail) + 1)
    return current


def _close_sections(state: _State, blocks: list[SourceBlock]) -> None:
    """Проставляет `end_page` по началу следующего раздела того же уровня.

    Раньше конец искался по `section_path` — по последнему блоку с таким путём.
    Беда в том, что путь НЕ уникален: `_next_sibling_path` спокойно выдаёт «1»
    повторно в разных главах, и тогда раздел на 4-й странице получал конец от
    одноимённого раздела с 400-й. На живой книге почти каждый раздел заявлял
    «страницы 3–400», то есть диапазон не значил ничего.

    Считаем по порядку следования: раздел кончается там, где начинается
    следующий раздел того же или более высокого уровня, а последний — на
    последней странице документа. Это не зависит от уникальности путей.
    """
    if not state.sections:
        return

    last_page = max((block.page for block in blocks), default=0)
    sections = state.sections
    depths = [section.path.count(".") + 1 if section.path else 1 for section in sections]

    closed: list[SectionNode] = []
    for index, section in enumerate(sections):
        end = last_page
        for following in range(index + 1, len(sections)):
            if depths[following] <= depths[index]:
                end = sections[following].start_page
                break
        closed.append(
            SectionNode(
                path=section.path,
                title=section.title,
                kind=section.kind,
                order_index=section.order_index,
                start_page=section.start_page,
                end_page=max(section.start_page, end),
                parent_path=section.parent_path,
            )
        )
    state.sections = closed

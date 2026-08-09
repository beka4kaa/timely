"""Извлечение структуры из EPUB.

Принципиальное отличие от PDF: у EPUB структура УЖЕ есть. В PDF заголовки
приходится угадывать регулярками по тексту строки (`blocks._group_lines`), а
здесь `<h1>` и `<h2>` размечены автором книги. Поэтому EPUB не притворяется
страницами и не идёт через `classify_pages` — он отдаёт готовые блоки и разделы.

**Страницы не выдумываем.** У EPUB их нет: текст перетекает под размер экрана,
и «страница 42» у двух читателей — разные места. Поэтому `page = 0` (принятое в
проекте обозначение «страницы нет», см. `chunking`), а носителем локации служит
`section_path`, из которого цитата собирает «Глава 7 › Второй закон Ньютона».
Придуманный номер страницы был бы хуже отсутствующего: он выглядит проверяемым,
но ведёт не туда.

Маркеры внутри абзаца («Задача 5.», «Решение.», «Определение.») размечает тот же
код, что и для PDF, — `blocks.classify_text_run`. Вторая реализация неизбежно
разошлась бы с первой, а от разметки `solution` зависит политика доступа.
"""

from __future__ import annotations

import logging
import os
import re
import tempfile
import warnings

from .blocks import SectionNode, classify_text_run
from .chunking import SourceBlock

logger = logging.getLogger(__name__)

# Теги, дающие текст. Порядок обхода — документный, как в вёрстке.
_TEXT_TAGS = ("p", "li", "blockquote", "pre", "dd", "dt")
_HEADING_TAGS = ("h1", "h2", "h3", "h4", "h5", "h6")

# Что выбрасываем целиком. `nav` — оглавление EPUB 3: его пункты дублируют
# заголовки книги, и без удаления оглавление становится «содержимым» первой
# главы.
_DROP_TAGS = ("script", "style", "nav", "svg", "head", "noscript")

# Слишком короткий текст — это колонтитул, номер или артефакт вёрстки.
_MIN_TEXT_CHARS = 3

_WHITESPACE = re.compile(r"\s+")


class EpubExtractionError(RuntimeError):
    """EPUB не открылся или в нём нет читаемого текста."""


def _clean(text: str) -> str:
    return _WHITESPACE.sub(" ", (text or "").replace("\xad", "")).strip()


class _SectionStack:
    """Пути разделов из уровней заголовков.

    `<h1>` → «1», следующий `<h2>` → «1.1», ещё один `<h1>` → «2». Уровни,
    которые автор пропустил (сразу `<h3>` без `<h2>`), не создают пустых
    промежуточных узлов: путь строится по фактически встреченным уровням, иначе
    у половины книг появились бы разделы-призраки.
    """

    def __init__(self) -> None:
        self.counters: list[int] = []
        self.levels: list[int] = []
        self.sections: list[SectionNode] = []
        # Сколько потомков уже выдано каждому родительскому пути. Явный счётчик,
        # а не поиск по уже созданным разделам: книга с сотнями заголовков иначе
        # получает квадратичный обход.
        self._children: dict[str, int] = {}

    @property
    def path(self) -> str:
        return ".".join(str(n) for n in self.counters)

    def push(self, level: int, title: str) -> SectionNode:
        while self.levels and self.levels[-1] >= level:
            self.levels.pop()
            self.counters.pop()

        parent_path = self.path
        self._children[parent_path] = self._children.get(parent_path, 0) + 1
        self.levels.append(level)
        self.counters.append(self._children[parent_path])

        kind = "chapter" if len(self.counters) == 1 else (
            "section" if len(self.counters) == 2 else "subsection"
        )
        node = SectionNode(
            path=self.path,
            title=title,
            kind=kind,
            order_index=len(self.sections),
            # Страниц у EPUB нет — см. шапку модуля.
            start_page=0,
            end_page=0,
            parent_path=parent_path,
        )
        self.sections.append(node)
        return node


def _iter_text_nodes(soup):
    """Заголовки и текстовые узлы в порядке документа."""
    for element in soup.find_all(_HEADING_TAGS + _TEXT_TAGS):
        # Вложенные элементы (например, `<p>` внутри `<li>`) дали бы текст
        # дважды. Берём только те, у кого нет текстового предка из списка.
        if element.find_parent(_TEXT_TAGS) is not None:
            continue
        yield element


def extract_epub(
    data: bytes, *, document_id: str = "doc", max_items: int | None = None
) -> tuple[list[SourceBlock], list[SectionNode]]:
    """EPUB → блоки и разделы. Порядок — по spine, как задумал автор книги.

    `spine`, а не перебор файлов в архиве: порядок чтения задаёт именно он, а
    имена файлов в EPUB произвольны и часто не сортируются осмысленно.
    """
    try:
        import ebooklib
        from bs4 import BeautifulSoup
        from ebooklib import epub
    except ImportError as exc:  # pragma: no cover — зависит от окружения
        raise EpubExtractionError(
            "Библиотеки для EPUB не установлены."
        ) from exc

    # `read_epub` требует ПУТЬ: внутри он зовёт `os.path.isdir`, и файловый
    # объект роняет его с `TypeError`. А из хранилища (S3 или локальная папка)
    # приходят байты, пути не существует в принципе — отсюда временный файл.
    handle, path = tempfile.mkstemp(suffix=".epub")
    try:
        with os.fdopen(handle, "wb") as sink:
            sink.write(data)
        with warnings.catch_warnings():
            # ebooklib 0.18 сам печатает FutureWarning про свой XPath на каждой
            # книге. Это их внутренняя недоработка, чинить её нам нечем, а в
            # логах обработки она превращается в шум на ровном месте.
            warnings.simplefilter("ignore", FutureWarning)
            book = epub.read_epub(path, options={"ignore_ncx": True})
    except Exception as exc:  # noqa: BLE001 — наружу только свой тип
        raise EpubExtractionError(f"EPUB не открывается: {exc}") from exc
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

    stack = _SectionStack()
    blocks: list[SourceBlock] = []
    order = 0
    items = 0

    for idref, _linear in getattr(book, "spine", []) or []:
        item = book.get_item_with_id(idref)
        if item is None or item.get_type() != ebooklib.ITEM_DOCUMENT:
            continue
        if max_items is not None and items >= max_items:
            break
        items += 1

        try:
            # HTML-парсер для XHTML — намеренно. XML-парсер уважает пространство
            # имён XHTML, и тогда `find_all("p")` не находит НИЧЕГО: теги там
            # `{http://www.w3.org/1999/xhtml}p`. Предупреждение bs4 об этом
            # гасим здесь же, чтобы оно не сыпалось на каждую главу.
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                soup = BeautifulSoup(item.get_content(), "lxml")
        except Exception as exc:  # noqa: BLE001 — одна битая глава не роняет книгу
            logger.warning("Глава %s не разобрана: %s", idref, exc)
            continue

        for tag in soup.find_all(_DROP_TAGS):
            tag.decompose()

        for element in _iter_text_nodes(soup):
            text = _clean(element.get_text(" "))
            if len(text) < _MIN_TEXT_CHARS:
                continue

            if element.name in _HEADING_TAGS:
                stack.push(int(element.name[1]), text)
                continue

            # Маркеры внутри абзаца размечает общий с PDF код.
            for kind, number_label, body in classify_text_run(text):
                if kind == "__heading__":
                    # Абзац, который выглядит заголовком по маркерам, но тегом
                    # заголовка не является. Разделом его не делаем: у EPUB
                    # иерархию задаёт вёрстка, и доверять ей надёжнее.
                    kind = "paragraph"
                order += 1
                blocks.append(
                    SourceBlock(
                        block_id=f"{document_id}-s{items:04d}-b{order:05d}",
                        kind=kind,
                        text=body,
                        # Страницы нет — см. шапку модуля.
                        page=0,
                        reading_order=order,
                        section_path=stack.path,
                        number_label=number_label,
                    )
                )

    if not blocks:
        raise EpubExtractionError("В EPUB не нашлось читаемого текста.")
    return blocks, stack.sections

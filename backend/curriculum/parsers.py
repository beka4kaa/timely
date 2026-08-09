"""Выбор разбора документа по его содержимому.

Формат определяется **magic-байтами, а не расширением**. Расширение приходит из
имени файла, то есть от пользователя, и `методичка.pdf`, внутри которой ZIP, —
это не гипотеза, а обычное дело: люди переименовывают файлы. Разбор не того
формата в лучшем случае даёт мусорный текст, в худшем — исключение посреди
обработки.

Два формата ведут себя принципиально по-разному, и Protocol это признаёт:

* PDF даёт СТРАНИЦЫ. Структуру приходится угадывать из текста (`classify_pages`),
  а часть страниц может оказаться сканами и уйти в OCR.
* EPUB даёт СТРУКТУРУ. Заголовки размечены автором, угадывать нечего, а страниц
  нет вовсе — и выдумывать их нельзя.

Поэтому `ParsedDocument` несёт либо страницы (PDF), либо готовые блоки и разделы
(EPUB). Ветка в пайплайне ровно одна: «дал ли парсер готовую структуру».
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

from .blocks import SectionNode
from .chunking import SourceBlock
from .extraction import ExtractedPage

# Сигнатуры. У PDF допускается мусор перед ней, у ZIP — нет: локальный заголовок
# обязан стоять в начале архива.
_PDF_MAGIC = b"%PDF-"
_ZIP_MAGIC = b"PK\x03\x04"
_MAGIC_WINDOW = 1024

FORMAT_PDF = "pdf"
FORMAT_EPUB = "epub"


class UnsupportedDocumentType(ValueError):
    """Формат не поддерживается. Сообщение безопасно показать пользователю."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class ParsedDocument:
    """Итог разбора.

    `blocks` и `sections` заполнены только тогда, когда формат САМ несёт
    структуру. Для PDF они пусты, и структуру строит `blocks.classify_pages` по
    тексту страниц.
    """

    format_name: str
    pages: list[ExtractedPage] = field(default_factory=list)
    blocks: list[SourceBlock] = field(default_factory=list)
    sections: list[SectionNode] = field(default_factory=list)

    @property
    def has_structure(self) -> bool:
        """Структура пришла готовой — классифицировать текст не нужно."""
        return bool(self.blocks)

    @property
    def has_pages(self) -> bool:
        """Есть ли страницы: от этого зависит и OCR, и вид цитаты."""
        return bool(self.pages)


class DocumentParser(Protocol):
    format_name: str

    def matches(self, data: bytes) -> bool: ...

    def parse(self, data: bytes, *, document_id: str, limit: int | None) -> ParsedDocument: ...


class PdfParser:
    """Обёртка над существующим `extraction.py`. Логика не дублируется."""

    format_name = FORMAT_PDF

    def matches(self, data: bytes) -> bool:
        return data[:_MAGIC_WINDOW].find(_PDF_MAGIC) >= 0

    def parse(
        self, data: bytes, *, document_id: str, limit: int | None = None
    ) -> ParsedDocument:
        from . import extraction

        pages = extraction.extract_pages(data, max_pages=limit)
        return ParsedDocument(format_name=self.format_name, pages=pages)


class EpubParser:
    format_name = FORMAT_EPUB

    def matches(self, data: bytes) -> bool:
        # EPUB — это ZIP. Одного `PK\x03\x04` мало: под него подходит и docx, и
        # jar, и обычный архив. Отличает EPUB запись `mimetype` в начале файла.
        if not data.startswith(_ZIP_MAGIC):
            return False
        return b"application/epub+zip" in data[:_MAGIC_WINDOW]

    def parse(
        self, data: bytes, *, document_id: str, limit: int | None = None
    ) -> ParsedDocument:
        from .epub_extraction import extract_epub

        blocks, sections = extract_epub(
            data, document_id=document_id, max_items=limit
        )
        # Страниц нет намеренно: см. шапку `epub_extraction`.
        return ParsedDocument(
            format_name=self.format_name, blocks=blocks, sections=sections
        )


# Порядок важен: PDF проверяется первым как самый частый формат.
_PARSERS: tuple[DocumentParser, ...] = (PdfParser(), EpubParser())


def detect_format(data: bytes) -> str:
    """Имя формата по содержимому или `UnsupportedDocumentType`."""
    for parser in _PARSERS:
        if parser.matches(data):
            return parser.format_name
    raise UnsupportedDocumentType(
        "unsupported_format",
        "Поддерживаются только PDF и EPUB. Содержимое файла не похоже ни на то, "
        "ни на другое.",
    )


def resolve_parser(data: bytes) -> DocumentParser:
    """Парсер под содержимое файла."""
    for parser in _PARSERS:
        if parser.matches(data):
            return parser
    raise UnsupportedDocumentType(
        "unsupported_format",
        "Поддерживаются только PDF и EPUB. Содержимое файла не похоже ни на то, "
        "ни на другое.",
    )

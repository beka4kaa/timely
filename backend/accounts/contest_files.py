"""PDF задач контеста: проверка при загрузке и отдача с правильными заголовками."""

from __future__ import annotations

import hashlib
import unicodedata
from dataclasses import dataclass

from django.http import HttpResponse

from .contest_rules import MAX_PDF_BYTES, REVIEW_TEXT_LIMIT

PDF_SIGNATURE = b"%PDF-"
NAME_LIMIT = 180


class PdfRejected(Exception):
    """Файл не принят. `message` можно показать админу как есть."""

    MESSAGES = {
        "no_file": "Прикрепи PDF.",
        "too_big": "PDF больше 10 МБ.",
        "not_pdf": "Это не PDF.",
        "broken": "PDF не открывается.",
    }

    def __init__(self, code: str):
        self.code = code
        self.message = self.MESSAGES[code]
        super().__init__(self.message)


@dataclass
class PdfInfo:
    data: bytes
    name: str
    size: int
    pages: int
    sha256: str
    text: str


def clean_name(raw: str | None) -> str:
    """Имя для админки: последняя часть пути, без управляющих символов, до 180 знаков.

    Ученик его не видит: он скачивает `zadacha-N.pdf`.
    """
    name = unicodedata.normalize("NFKC", (raw or "").replace("\\", "/").split("/")[-1])
    name = "".join(char for char in name if char.isprintable()).strip(" .")
    return name[:NAME_LIMIT] or "zadacha.pdf"


def _pages_and_text(data: bytes) -> tuple[int, str]:
    try:
        import pypdfium2 as pdfium
    except ImportError:  # Без библиотеки хватает подписи: число страниц и текст не нужны для работы.
        return 0, ""
    try:
        document = pdfium.PdfDocument(data)
    except Exception as error:  # PdfiumError и любые сбои разбора значат одно: файл не открыть.
        raise PdfRejected("broken") from error
    try:
        parts: list[str] = []
        length = 0
        for index in range(len(document)):
            if length >= REVIEW_TEXT_LIMIT:
                break
            page = document[index]
            textpage = page.get_textpage()
            piece = textpage.get_text_bounded() or ""
            textpage.close()
            page.close()
            parts.append(piece)
            length += len(piece)
        text = "\n".join(part.strip() for part in parts if part.strip())
        return len(document), text[:REVIEW_TEXT_LIMIT]
    finally:
        document.close()


def read_pdf(upload) -> PdfInfo:
    """Проверить загруженный файл и вынуть из него страницы и текст."""
    if upload is None:
        raise PdfRejected("no_file")
    if upload.size is not None and upload.size > MAX_PDF_BYTES:
        raise PdfRejected("too_big")
    data = upload.read(MAX_PDF_BYTES + 1)
    if len(data) > MAX_PDF_BYTES:
        raise PdfRejected("too_big")
    if not data.startswith(PDF_SIGNATURE):
        raise PdfRejected("not_pdf")
    pages, text = _pages_and_text(data)
    return PdfInfo(
        data=data,
        name=clean_name(getattr(upload, "name", "")),
        size=len(data),
        pages=pages,
        sha256=hashlib.sha256(data).hexdigest(),
        text=text,
    )


def pdf_response(file, download_name: str) -> HttpResponse:
    """Файл целиком. Имя латиницей, поэтому заголовок не нужно кодировать."""
    response = HttpResponse(bytes(file.data), content_type="application/pdf")
    response["Content-Disposition"] = f'attachment; filename="{download_name}"'
    response["Cache-Control"] = "private, no-store"
    response["X-Content-Type-Options"] = "nosniff"
    return response

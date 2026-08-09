"""Извлечение страниц из PDF: нативный текст и растр для OCR.

Единственный модуль, который импортирует `pypdfium2`. Изоляция такая же, как у
`storage.FileStorage`: если библиотеку придётся менять, правится только этот
файл, а `blocks.py`, `services/ingestion.py` и тесты работают над dataclass'ами.

Почему pypdfium2, а не альтернативы:

* даёт И текст, И рендер страницы в картинку одной библиотекой — растр нужен
  для OCR сканированных страниц;
* лицензия Apache/BSD, в отличие от AGPL у PyMuPDF;
* ставится готовым wheel (`py3-none-macosx_11_0_arm64`, `py3-none-manylinux…`) и
  НЕ требует нативного пакета в системе. Это принципиально: в проекте уже есть
  грабли `cairosvg` без `libcairo` (см. CLAUDE.md), где импорт падал с `OSError`
  на машине без системной библиотеки. `pdf2image` потребовал бы poppler и
  повторил бы ровно эту историю.

Ещё одна причина существования `real_page_count`: `upload_validation` считает
страницы регуляркой по сырым байтам, потому что это дешёвый гейт ДО записи файла
в storage и он не имеет права зависеть от тяжёлой библиотеки. Регулярка
переоценивает: синтетический PDF из тестов с `/Count 3` pdfium открывает как
одну страницу. Поэтому истинное число берётся здесь и перезаписывает
`Document.page_count` на этапе извлечения.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import cv2
import pypdfium2 as pdfium

# Ниже этого числа символов нативного текста страница считается сканом и
# отправляется в OCR. Ноль символов — очевидный скан; несколько десятков это,
# как правило, колонтитул и номер страницы поверх картинки, то есть тоже скан.
NATIVE_TEXT_MIN_CHARS = 60

# Масштаб рендера для OCR. 2.0 к 72 dpi даёт ~144 dpi — этого хватает VLM и это
# вдвое дешевле по числу пикселей, чем «полиграфические» 300 dpi.
OCR_RENDER_SCALE = 2.0
# `page.render()` выделяет растровый буфер ДО того, как OpenCV сожмёт его в
# PNG. MediaBox 100000×100000 из PDF в несколько сотен байт иначе потребовал бы
# десятки гигабайт. 10 Мп заметно выше обычной страницы учебника при 144 dpi,
# но оставляет worker запас под PDF bytes, RGB/BGR и PNG одновременно.
MAX_OCR_RENDER_PIXELS = 10_000_000
MAX_PAGE_DIMENSION_POINTS = 10_000.0

EXTRACTION_NATIVE = "native_pdf"
EXTRACTION_OCR = "ocr"


class PdfExtractionError(RuntimeError):
    """PDF не открылся или страница не читается."""


@dataclass(frozen=True)
class ExtractedPage:
    """Одна страница после извлечения нативного текста.

    `needs_ocr` — это решение, принятое по объёму текста, а не результат OCR.
    Сам OCR запускается позже и только для тех страниц, где флаг поднят.
    """

    page_number: int  # 1-based, как в DocumentPage.page_number
    width: float
    height: float
    native_text: str
    native_text_length: int
    needs_ocr: bool
    extraction_method: str = EXTRACTION_NATIVE

    @property
    def text(self) -> str:
        return self.native_text


def _normalize_newlines(text: str) -> str:
    """pdfium отдаёт `\\r\\n`; хеши блоков не должны зависеть от этого."""
    return (text or "").replace("\r\n", "\n").replace("\r", "\n")


def _validate_render_geometry(width: float, height: float, *, scale: float) -> None:
    """Отклоняет страницу до выделения bitmap, если геометрия небезопасна."""

    width, height, scale = float(width), float(height), float(scale)
    if not all(
        math.isfinite(value) and value > 0 for value in (width, height, scale)
    ):
        raise PdfExtractionError("У страницы некорректный размер")
    if width > MAX_PAGE_DIMENSION_POINTS or height > MAX_PAGE_DIMENSION_POINTS:
        raise PdfExtractionError("Размер страницы превышает безопасный предел")
    pixel_width = math.ceil(width * scale)
    pixel_height = math.ceil(height * scale)
    if pixel_width * pixel_height > MAX_OCR_RENDER_PIXELS:
        raise PdfExtractionError("Растр страницы превышает безопасный предел")


def _open(pdf_bytes: bytes) -> pdfium.PdfDocument:
    if not pdf_bytes:
        raise PdfExtractionError("Пустой PDF")
    try:
        return pdfium.PdfDocument(pdf_bytes)
    except Exception as exc:  # pdfium бросает свои типы, не только ValueError
        raise PdfExtractionError(f"PDF не открывается: {exc}") from exc


def real_page_count(pdf_bytes: bytes) -> int:
    """Истинное число страниц по мнению pdfium."""
    doc = _open(pdf_bytes)
    try:
        return len(doc)
    finally:
        doc.close()


def extract_pages(
    pdf_bytes: bytes,
    *,
    min_chars: int = NATIVE_TEXT_MIN_CHARS,
    max_pages: int | None = None,
) -> list[ExtractedPage]:
    """Достаёт нативный текст всех страниц.

    `max_pages` — жёсткий предохранитель для синхронного пути: очередь задач в
    проекте не подключена, и учебник на 1500 страниц иначе занял бы поток
    веб-сервера целиком.
    """
    doc = _open(pdf_bytes)
    pages: list[ExtractedPage] = []
    try:
        total = len(doc)
        limit = total if max_pages is None else min(total, max(0, max_pages))
        for index in range(limit):
            page = doc[index]
            try:
                width, height = page.get_size()
                textpage = page.get_textpage()
                try:
                    # get_text_bounded, а не get_text_range: последний с
                    # дефолтными аргументами печатает UserWarning и сам
                    # перенаправляет вызов сюда же.
                    raw = textpage.get_text_bounded()
                finally:
                    textpage.close()
            finally:
                page.close()

            text = _normalize_newlines(raw)
            length = len(text.strip())
            needs_ocr = length < min_chars
            if needs_ocr:
                _validate_render_geometry(
                    float(width),
                    float(height),
                    scale=OCR_RENDER_SCALE,
                )
            pages.append(
                ExtractedPage(
                    page_number=index + 1,
                    width=float(width),
                    height=float(height),
                    native_text=text,
                    native_text_length=length,
                    needs_ocr=needs_ocr,
                    extraction_method=EXTRACTION_NATIVE,
                )
            )
    finally:
        doc.close()
    return pages


def render_page_png(
    pdf_bytes: bytes, page_number: int, *, scale: float = OCR_RENDER_SCALE
) -> bytes:
    """Рендерит страницу в PNG-байты для отправки в OCR-модель.

    `page_number` 1-based, как в `ExtractedPage` и `DocumentPage`.
    """
    doc = _open(pdf_bytes)
    try:
        if page_number < 1 or page_number > len(doc):
            raise PdfExtractionError(
                f"Страница {page_number} вне диапазона 1..{len(doc)}"
            )
        page = doc[page_number - 1]
        try:
            width, height = page.get_size()
            _validate_render_geometry(float(width), float(height), scale=scale)
            # to_numpy(), а не to_pil(): Pillow есть в venv, но её НЕТ в
            # requirements.txt, а opencv-python-headless есть. Опираться на
            # неявную зависимость — это ровно грабли cairosvg/libcairo из
            # CLAUDE.md: локально работает, в production модуль не найден.
            bitmap = page.render(scale=scale)
            try:
                rgb = bitmap.to_numpy()
                # pdfium отдаёт RGB, cv2.imencode ждёт BGR. Преобразуем, пока
                # bitmap ещё жив: numpy-массив может ссылаться на его память.
                bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
                ok, buffer = cv2.imencode(".png", bgr)
            finally:
                bitmap.close()
        finally:
            page.close()
    finally:
        doc.close()

    if not ok:
        raise PdfExtractionError(f"Страница {page_number} не кодируется в PNG")
    return buffer.tobytes()

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

import logging
import math
from dataclasses import dataclass

import cv2
import pypdfium2 as pdfium
import pypdfium2.raw as pdfium_c
from celery.exceptions import SoftTimeLimitExceeded

logger = logging.getLogger(__name__)

# Скан — страница, где нативного текста меньше этого числа символов И растровые
# картинки закрывают не меньше `SCAN_IMAGE_MIN_SHARE` листа или на ней не меньше
# `SCAN_MIN_PATHS` векторных контуров (текст, нарисованный кривыми, и
# векторизованный скан). Несколько десятков символов поверх такой страницы —
# это, как правило, колонтитул и номер страницы, то есть тоже скан. Бедная
# текстом страница без этого (пустой оборот, титул главы, разделитель) сканом не
# считается: распознавать на ней нечего, а каждая страница в OCR стоит ученику
# лимита (решение 12).
NATIVE_TEXT_MIN_CHARS = 60
SCAN_IMAGE_MIN_SHARE = 0.5
SCAN_MIN_PATHS = 200
# Глубина вложенных Form XObject, в которых ищем картинки и контуры.
_MAX_FORM_DEPTH = 8

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

    `needs_ocr` — это решение, принятое по объёму текста и растровой картинке
    на странице, а не результат OCR. Сам OCR запускается позже и только для тех
    страниц, где флаг поднят.
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
    except SoftTimeLimitExceeded:
        raise
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
                text = _normalize_newlines(raw)
                length = len(text.strip())
                needs_ocr = False
                if length < min_chars:
                    # Геометрию бедной текстом страницы проверяем, как и раньше,
                    # до разбора её картинок: площадь листа нужна конечная, а
                    # скан потом рендерится.
                    _validate_render_geometry(
                        float(width),
                        float(height),
                        scale=OCR_RENDER_SCALE,
                    )
                    needs_ocr = _looks_scanned(page, index + 1)
            finally:
                page.close()

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


def _looks_scanned(page: pdfium.PdfPage, page_number: int) -> bool:
    """Скан ли бедная текстом страница.

    Да, если растровые картинки закрывают не меньше `SCAN_IMAGE_MIN_SHARE`
    листа или на странице не меньше `SCAN_MIN_PATHS` векторных контуров.
    Площади картинок складываются: скан бывает нарезан полосами. Рамка каждой
    обрезается по листу, то есть по пересечению MediaBox и CropBox.

    Если pdfium не может разобрать объекты страницы (например, в её словаре нет
    `/Type /Page`), она считается сканом, как до этого правила: лучше
    заплатить за возможный скан, чем потерять содержание.
    """
    left, bottom, right, top = page.get_bbox()
    needed = SCAN_IMAGE_MIN_SHARE * (right - left) * (top - bottom)
    covered = 0.0
    paths = 0
    try:
        for kind, rect in _page_objects(page):
            if kind == pdfium_c.FPDF_PAGEOBJ_PATH:
                paths += 1
                if paths >= SCAN_MIN_PATHS:
                    return True
                continue
            x0, y0, x1, y1 = rect
            width = min(x1, right) - max(x0, left)
            height = min(y1, top) - max(y0, bottom)
            if width > 0 and height > 0:
                covered += width * height
                if covered >= needed:
                    return True
    except pdfium.PdfiumError as exc:
        logger.warning(
            "Страница %s: pdfium не разобрал её объекты (%s), считаем её сканом",
            page_number,
            exc,
        )
        return True
    return False


def _page_objects(page: pdfium.PdfPage, form=None, matrix=None, depth: int = 0):
    """Картинки и векторные контуры страницы: пары `(вид объекта, рамка)`.

    Рамка есть только у картинки, в координатах листа. Картинку внутри Form
    XObject pdfium отдаёт в координатах формы, без матрицы, которой форму
    нарисовали на листе, поэтому рамка переводится на лист матрицами всех форм
    по пути. У контура рамка не нужна: считается только их число.
    """
    for obj in page.get_objects(max_depth=1, form=form):
        if obj.type == pdfium_c.FPDF_PAGEOBJ_IMAGE:
            rect = obj.get_pos()
            yield obj.type, (rect if matrix is None else matrix.on_rect(*rect))
        elif obj.type == pdfium_c.FPDF_PAGEOBJ_PATH:
            yield obj.type, None
        elif obj.type == pdfium_c.FPDF_PAGEOBJ_FORM and depth < _MAX_FORM_DEPTH:
            form_matrix = obj.get_matrix()
            yield from _page_objects(
                page,
                obj,
                form_matrix if matrix is None else form_matrix.multiply(matrix),
                depth + 1,
            )


def extract_page_range(
    pdf_bytes: bytes, first: int, last: int
) -> list[ExtractedPage]:
    """Текст произвольного диапазона страниц (1-based, границы включительно).

    Нужен для поиска оглавления. `extract_pages` умеет только «первые N», а
    предохранитель `MAX_PAGES_PER_RUN` обрезает книгу на 400-й странице — у
    Мякишева оглавление напечатано на 508-й, то есть за этой границей, и
    структура книги оставалась невидимой. Дешевле прочитать десяток страниц с
    конца, чем поднимать лимит на всю обработку.
    """
    doc = _open(pdf_bytes)
    extracted: list[ExtractedPage] = []
    try:
        total = len(doc)
        start = max(1, first)
        stop = min(total, last)
        for number in range(start, stop + 1):
            page = doc[number - 1]
            try:
                width, height = page.get_size()
                textpage = page.get_textpage()
                try:
                    raw = textpage.get_text_bounded()
                finally:
                    textpage.close()
            finally:
                page.close()
            text = _normalize_newlines(raw)
            extracted.append(
                ExtractedPage(
                    page_number=number,
                    width=float(width),
                    height=float(height),
                    native_text=text,
                    native_text_length=len(text.strip()),
                    needs_ocr=False,
                    extraction_method=EXTRACTION_NATIVE,
                )
            )
    finally:
        doc.close()
    return extracted


def read_bookmarks(pdf_bytes: bytes) -> tuple[list[tuple[int, str, int]], int]:
    """Закладки PDF: `[(уровень с нуля, название, страница с единицы)]` и объём.

    Издательская разметка книги — самый надёжный источник структуры, лучше и
    печатного оглавления, и наших догадок по тексту. У «Hands-On Machine
    Learning» здесь 234 записи с точными страницами; пока их не читали, главами
    курса становились подписи врезок `WARNING` и `NOTE`.

    Пустой список — обычное дело: у сканов и у многих пиратских перекодировок
    закладок нет, и тогда работает разбор оглавления.
    """
    doc = _open(pdf_bytes)
    try:
        total = len(doc)
        items: list[tuple[int, str, int]] = []
        for item in doc.get_toc():
            title = (getattr(item, "title", "") or "").strip()
            if not title:
                continue
            page_index = getattr(item, "page_index", None)
            if page_index is None:
                # Закладка без цели: ссылается на именованный узел, который
                # pdfium не разрешил. Страницы у неё нет, и придумывать её
                # нельзя — раздел открылся бы не там.
                continue
            items.append((int(item.level), title, int(page_index) + 1))
    except SoftTimeLimitExceeded:
        raise
    except Exception as exc:  # noqa: BLE001 — битое дерево закладок не фатально
        logger.warning("Закладки PDF не прочитаны: %s", exc)
        return [], 0
    finally:
        doc.close()
    return items, total


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

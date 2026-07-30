"""Проверка загружаемых документов до того, как файл попадёт в storage.

Принцип: доверять нечему — ни расширению, ни `Content-Type` из формы, ни
заявленному размеру. Всё, что можно проверить по содержимому, проверяется по
содержимому.

Функции здесь чистые (принимают bytes, возвращают результат) и не трогают ни
базу, ни storage: так их можно покрыть тестами без Django и переиспользовать в
фоновом воркере.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Protocol

from .storage import content_hash, sanitize_filename

# 60 МБ: типичный школьный учебник в PDF укладывается, а «PDF» на 2 ГБ — это
# либо ошибка, либо попытка занять диск.
MAX_BYTES = 60 * 1024 * 1024
MAX_PAGES = 1500
MIN_BYTES = 64

ALLOWED_MIME_TYPES = frozenset({"application/pdf"})
ALLOWED_EXTENSIONS = frozenset({".pdf"})

_PDF_MAGIC = b"%PDF-"
# У PDF допускается мусор перед сигнатурой, но не километр: ищем в первых 1 КБ.
_MAGIC_SEARCH_WINDOW = 1024

_ENCRYPT_RE = re.compile(rb"/Encrypt[\s/<\[]")
_PAGE_COUNT_RE = re.compile(rb"/Type\s*/Page[^s]")
_COUNT_RE = re.compile(rb"/Count\s+(\d{1,7})")
# Объект с несоразмерным Length относительно файла — признак «бомбы»: поток
# распаковывается в сотни мегабайт из нескольких килобайт.
_LENGTH_RE = re.compile(rb"/Length\s+(\d{1,12})")

# Во сколько раз объявленная суммарная длина потоков может превышать файл,
# прежде чем это станет подозрительным. Легальные PDF с Flate дают ~1–5x.
_MAX_DECLARED_EXPANSION = 200


class UploadRejected(ValueError):
    """Файл отклонён. Сообщение безопасно показывать пользователю."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True)
class ValidatedUpload:
    """Результат успешной проверки — то, из чего создаётся `DocumentFile`."""

    sanitized_filename: str
    mime_type: str
    byte_size: int
    sha256: str
    page_count: int
    warnings: tuple[str, ...] = ()


class AntivirusScanner(Protocol):
    """Контракт антивируса.

    Реального сканера в проекте пока нет, но точка подключения обязана
    существовать заранее: иначе она никогда не появится, а загрузка файлов от
    несовершеннолетних пользователей — ровно тот случай, где она нужна.
    """

    name: str

    def scan(self, data: bytes) -> tuple[bool, str]:
        """Возвращает (чисто?, описание)."""
        ...


class NullAntivirusScanner:
    """Заглушка: ничего не проверяет и честно об этом сообщает."""

    name = "none"

    def scan(self, data: bytes) -> tuple[bool, str]:
        return True, "skipped"


def _find_magic(data: bytes) -> int:
    return data[:_MAGIC_SEARCH_WINDOW].find(_PDF_MAGIC)


def looks_like_pdf(data: bytes) -> bool:
    return _find_magic(data) >= 0


def is_encrypted_pdf(data: bytes) -> bool:
    """Ищет словарь /Encrypt в трейлере.

    Зашифрованный PDF нельзя ни извлечь, ни распознать, поэтому он отклоняется
    на входе, а не падает посреди ingestion.
    """
    return bool(_ENCRYPT_RE.search(data))


def estimate_page_count(data: bytes) -> int:
    """Грубая оценка числа страниц без PDF-библиотеки.

    Настоящий подсчёт делает извлекатель на этапе ingestion; здесь нужна лишь
    защита от файла на 50 000 страниц, который забьёт очередь и бюджет OCR.
    Берём максимум из /Count в дереве страниц и числа объектов /Type /Page.
    """
    counts = [int(m.group(1)) for m in _COUNT_RE.finditer(data)]
    declared = max(counts) if counts else 0
    objects = len(_PAGE_COUNT_RE.findall(data))
    return max(declared, objects)


def looks_like_zip_bomb(data: bytes) -> bool:
    """Признак несоразмерной заявленной распаковки."""
    declared = sum(int(m.group(1)) for m in _LENGTH_RE.finditer(data))
    if declared <= 0:
        return False
    return declared > len(data) * _MAX_DECLARED_EXPANSION


def validate_pdf_upload(
    *,
    data: bytes,
    filename: str,
    declared_mime: str = "",
    scanner: AntivirusScanner | None = None,
    max_bytes: int = MAX_BYTES,
    max_pages: int = MAX_PAGES,
) -> ValidatedUpload:
    """Полная проверка загружаемого PDF.

    Порядок важен: сначала дешёвые проверки (размер, расширение), потом разбор
    содержимого. Так огромный мусорный файл отсекается, не будучи просканирован
    целиком.
    """
    size = len(data)
    if size < MIN_BYTES:
        raise UploadRejected("empty_file", "Файл пустой или слишком маленький.")
    if size > max_bytes:
        limit_mb = max_bytes // (1024 * 1024)
        raise UploadRejected(
            "file_too_large", f"Файл больше {limit_mb} МБ. Загрузите том поменьше."
        )

    safe_name = sanitize_filename(filename)
    extension = ("." + safe_name.rsplit(".", 1)[-1].lower()) if "." in safe_name else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise UploadRejected("bad_extension", "Поддерживаются только файлы PDF.")

    # Заявленный MIME проверяем, но доверяем ему меньше, чем magic bytes.
    if declared_mime and declared_mime.split(";")[0].strip() not in ALLOWED_MIME_TYPES:
        raise UploadRejected("bad_mime", "Поддерживаются только файлы PDF.")

    if not looks_like_pdf(data):
        raise UploadRejected(
            "bad_magic", "Это не PDF: содержимое файла не совпадает с расширением."
        )

    if is_encrypted_pdf(data):
        raise UploadRejected(
            "encrypted_pdf",
            "PDF защищён паролем. Снимите защиту и загрузите файл заново.",
        )

    if looks_like_zip_bomb(data):
        raise UploadRejected(
            "suspicious_compression", "Файл выглядит повреждённым или небезопасным."
        )

    pages = estimate_page_count(data)
    if pages > max_pages:
        raise UploadRejected(
            "too_many_pages", f"В документе больше {max_pages} страниц."
        )

    active_scanner = scanner or NullAntivirusScanner()
    clean, detail = active_scanner.scan(data)
    if not clean:
        raise UploadRejected("infected", "Файл не прошёл антивирусную проверку.")

    warnings: list[str] = []
    if pages == 0:
        # Не отклоняем: встречаются PDF, где дерево страниц собрано нестандартно.
        # Точное число посчитает извлекатель.
        warnings.append("page_count_unknown")
    if active_scanner.name == "none":
        warnings.append("antivirus_not_configured")

    return ValidatedUpload(
        sanitized_filename=safe_name,
        mime_type="application/pdf",
        byte_size=size,
        sha256=content_hash(data),
        page_count=pages,
        warnings=tuple(warnings),
    )

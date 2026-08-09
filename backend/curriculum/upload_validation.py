"""Проверка загружаемых документов до того, как файл попадёт в storage.

Принцип: доверять нечему — ни расширению, ни `Content-Type` из формы, ни
заявленному размеру. Всё, что можно проверить по содержимому, проверяется по
содержимому.

Функции здесь чистые (принимают bytes, возвращают результат) и не трогают ни
базу, ни storage: так их можно покрыть тестами без Django и переиспользовать в
фоновом воркере.
"""

from __future__ import annotations

import hashlib
import io
import re
import struct
import zipfile
from dataclasses import dataclass
from typing import BinaryIO, Protocol

from .storage import content_hash, sanitize_filename

# 60 МБ: типичный школьный учебник в PDF укладывается, а «PDF» на 2 ГБ — это
# либо ошибка, либо попытка занять диск.
MAX_BYTES = 60 * 1024 * 1024
MAX_PAGES = 1500
MIN_BYTES = 64

ALLOWED_MIME_TYPES = frozenset({"application/pdf", "application/epub+zip"})
ALLOWED_EXTENSIONS = frozenset({".pdf", ".epub"})

# EPUB — это ZIP, и у ZIP свои способы навредить.
_ZIP_MAGIC = b"PK\x03\x04"
_EPUB_MIMETYPE = b"application/epub+zip"
# Во сколько раз распакованный EPUB может превышать архив. Текст жмётся хорошо,
# но не в тысячу раз: всё сверх этого — zip-бомба.
_MAX_EPUB_EXPANSION = 100
# Коэффициента недостаточно как единственного предохранителя: разрешённый
# архив на 60 МБ при 100× мог бы объявить почти 6 ГБ распаковки, после чего
# ebooklib материализовал бы manifest entries в памяти worker. Абсолютный и
# пофайловый потолки держат этот объём конечным независимо от размера архива.
_MAX_EPUB_UNPACKED_BYTES = 64 * 1024 * 1024
_MAX_EPUB_ENTRY_BYTES = 32 * 1024 * 1024
# Записей в архиве. У книги их сотни (главы, картинки, шрифты), у бомбы —
# десятки тысяч.
_MAX_EPUB_ENTRIES = 5000
_ZIP_EOCD_SIGNATURE = b"PK\x05\x06"
_ZIP_EOCD_FIXED_BYTES = 22
_ZIP_MAX_COMMENT_BYTES = 65535
_ZIP64_EOCD_LOCATOR_SIGNATURE = b"PK\x06\x07"
_ZIP_CENTRAL_HEADER_SIGNATURE = b"PK\x01\x02"
_ZIP_CENTRAL_HEADER_BYTES = 46

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
_STREAM_CHUNK_BYTES = 1024 * 1024
_STREAM_PATTERN_OVERLAP = 256


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

    def scan_stream(self, stream: BinaryIO) -> tuple[bool, str]:
        """Потоковый вариант для web-загрузки без копии всего файла в RAM."""
        ...


class NullAntivirusScanner:
    """Заглушка: ничего не проверяет и честно об этом сообщает."""

    name = "none"

    def scan(self, data: bytes) -> tuple[bool, str]:
        return True, "skipped"

    def scan_stream(self, stream: BinaryIO) -> tuple[bool, str]:
        return True, "skipped"


@dataclass(frozen=True)
class _StreamInspection:
    byte_size: int
    sha256: str
    head: bytes
    encrypted: bool
    page_count: int
    declared_stream_bytes: int


def _rewind(stream: BinaryIO) -> None:
    try:
        stream.seek(0)
    except (AttributeError, OSError) as exc:
        raise UploadRejected(
            "unseekable_upload",
            "Не удалось прочитать загруженный файл.",
        ) from exc


def _inspect_stream(stream: BinaryIO, *, max_bytes: int) -> _StreamInspection:
    """Один ограниченный проход: размер, hash и PDF-маркеры.

    В памяти остаются только текущий мегабайт, короткий overlap и первый 1 КБ.
    Абсолютные позиции совпадений защищают от двойного подсчёта на overlap.
    """

    _rewind(stream)
    digest = hashlib.sha256()
    head = bytearray()
    tail = b""
    total = 0
    encrypted = False
    page_objects = 0
    max_page_count = 0
    declared_stream_bytes = 0
    # Следующее окно повторно содержит overlap. Для каждого шаблона достаточно
    # помнить только последнюю абсолютную позицию: finditer возвращает совпадения
    # по порядку, а окна движутся только вперёд. Это сохраняет O(1) память даже
    # для файла, целиком состоящего из PDF-маркеров.
    last_page_object_at = -1
    last_page_count_at = -1
    last_stream_length_at = -1
    last_stream_length_value = 0

    while True:
        chunk = stream.read(_STREAM_CHUNK_BYTES)
        if not chunk:
            break
        if not isinstance(chunk, (bytes, bytearray)):
            raise UploadRejected("bad_upload", "Не удалось прочитать загруженный файл.")
        previous_total = total
        total += len(chunk)
        if total > max_bytes:
            limit_mb = max_bytes // (1024 * 1024)
            raise UploadRejected(
                "file_too_large", f"Файл больше {limit_mb} МБ. Загрузите том поменьше."
            )
        digest.update(chunk)
        if len(head) < _MAGIC_SEARCH_WINDOW:
            head.extend(chunk[: _MAGIC_SEARCH_WINDOW - len(head)])

        window = tail + bytes(chunk)
        base = previous_total - len(tail)
        if _ENCRYPT_RE.search(window):
            encrypted = True
        for match in _PAGE_COUNT_RE.finditer(window):
            absolute = base + match.start()
            if absolute > last_page_object_at:
                page_objects += 1
                last_page_object_at = absolute
        for match in _COUNT_RE.finditer(window):
            absolute = base + match.start()
            # На границе chunk regex может сначала увидеть `/Count 1`, а в
            # следующем окне — тот же `/Count 123`. Для max повтор безопасен и
            # обязан уточнить значение, не создавая коллекцию совпадений.
            if absolute >= last_page_count_at:
                max_page_count = max(max_page_count, int(match.group(1)))
                last_page_count_at = max(last_page_count_at, absolute)
        for match in _LENGTH_RE.finditer(window):
            absolute = base + match.start()
            value = int(match.group(1))
            if absolute > last_stream_length_at:
                declared_stream_bytes += value
                last_stream_length_at = absolute
                last_stream_length_value = value
            elif absolute == last_stream_length_at:
                # То же совпадение могло удлиниться цифрами из нового chunk.
                declared_stream_bytes += value - last_stream_length_value
                last_stream_length_value = value
        tail = window[-_STREAM_PATTERN_OVERLAP:]

    _rewind(stream)
    return _StreamInspection(
        byte_size=total,
        sha256=digest.hexdigest(),
        head=bytes(head),
        encrypted=encrypted,
        page_count=max(max_page_count, page_objects),
        declared_stream_bytes=declared_stream_bytes,
    )


def _scan_upload_stream(
    stream: BinaryIO, scanner: AntivirusScanner | None
) -> tuple[str, bool]:
    active = scanner or NullAntivirusScanner()
    scan_stream = getattr(active, "scan_stream", None)
    _rewind(stream)
    if callable(scan_stream):
        clean, _detail = scan_stream(stream)
    else:
        # Совместимость с существующими тестовыми/локальными сканерами. Боевой
        # scanner обязан реализовать scan_stream, иначе снова появится 60-МБ copy.
        data = stream.read(MAX_BYTES + 1)
        clean, _detail = active.scan(data)
    _rewind(stream)
    return active.name, clean


def _bad_archive() -> UploadRejected:
    return UploadRejected("bad_archive", "EPUB повреждён: архив не читается.")


def _read_exact(stream: BinaryIO, size: int) -> bytes:
    """Читает ровно небольшой заранее проверенный фрагмент ZIP."""

    data = stream.read(size)
    if not isinstance(data, (bytes, bytearray)) or len(data) != size:
        raise _bad_archive()
    return bytes(data)


def _preflight_zip_directory(stream: BinaryIO, *, archive_size: int) -> int:
    """Проверяет EOCD и central directory до создания `ZipFile`.

    `ZipFile` сначала материализует весь central directory и все `ZipInfo`.
    Поэтому доверять заявленному числу entries без проверки структуры нельзя:
    поддельный EOCD мог бы написать «1», оставив внутри миллион заголовков.
    Здесь память ограничена EOCD-tail (не более 65 557 байт) и одним 46-байтным
    заголовком central directory.
    """

    if archive_size < _ZIP_EOCD_FIXED_BYTES:
        raise _bad_archive()

    tail_size = min(
        archive_size,
        _ZIP_EOCD_FIXED_BYTES + _ZIP_MAX_COMMENT_BYTES,
    )
    tail_start = archive_size - tail_size
    try:
        stream.seek(tail_start)
    except (AttributeError, OSError) as exc:
        raise _bad_archive() from exc
    tail = _read_exact(stream, tail_size)
    eocd_in_tail = tail.rfind(_ZIP_EOCD_SIGNATURE)
    if eocd_in_tail < 0 or eocd_in_tail + _ZIP_EOCD_FIXED_BYTES > len(tail):
        raise _bad_archive()

    (
        signature,
        disk_number,
        central_disk_number,
        entries_on_disk,
        total_entries,
        central_size,
        central_offset,
        comment_size,
    ) = struct.unpack_from("<4s4H2LH", tail, eocd_in_tail)
    if (
        signature != _ZIP_EOCD_SIGNATURE
        or eocd_in_tail + _ZIP_EOCD_FIXED_BYTES + comment_size != len(tail)
    ):
        raise _bad_archive()

    eocd_offset = tail_start + eocd_in_tail
    if eocd_offset >= 20:
        try:
            stream.seek(eocd_offset - 20)
        except (AttributeError, OSError) as exc:
            raise _bad_archive() from exc
        if _read_exact(stream, 4) == _ZIP64_EOCD_LOCATOR_SIGNATURE:
            raise _bad_archive()

    # EPUB не поддерживает многодисковые и ZIP64-контейнеры. Sentinel-значения
    # ZIP64 проверяются отдельно до лимита entries, чтобы не маскировать формат
    # под обычную «слишком большую книгу».
    if (
        disk_number != 0
        or central_disk_number != 0
        or entries_on_disk != total_entries
    ):
        raise _bad_archive()
    if (
        total_entries == 0xFFFF
        or entries_on_disk == 0xFFFF
        or central_size == 0xFFFFFFFF
        or central_offset == 0xFFFFFFFF
    ):
        raise _bad_archive()
    if total_entries > _MAX_EPUB_ENTRIES:
        raise UploadRejected(
            "suspicious_compression", "В архиве слишком много файлов."
        )
    if total_entries == 0:
        raise UploadRejected("bad_archive", "EPUB повреждён: архив пуст.")

    central_end = central_offset + central_size
    if (
        central_offset >= eocd_offset
        or central_size < total_entries * _ZIP_CENTRAL_HEADER_BYTES
        or central_end != eocd_offset
    ):
        raise _bad_archive()

    position = central_offset
    for _ in range(total_entries):
        if position + _ZIP_CENTRAL_HEADER_BYTES > central_end:
            raise _bad_archive()
        try:
            stream.seek(position)
        except (AttributeError, OSError) as exc:
            raise _bad_archive() from exc
        header = _read_exact(stream, _ZIP_CENTRAL_HEADER_BYTES)
        if header[:4] != _ZIP_CENTRAL_HEADER_SIGNATURE:
            raise _bad_archive()

        compressed_size = struct.unpack_from("<L", header, 20)[0]
        uncompressed_size = struct.unpack_from("<L", header, 24)[0]
        filename_size, extra_size, entry_comment_size, start_disk = struct.unpack_from(
            "<4H", header, 28
        )
        local_header_offset = struct.unpack_from("<L", header, 42)[0]
        if (
            compressed_size == 0xFFFFFFFF
            or uncompressed_size == 0xFFFFFFFF
            or local_header_offset == 0xFFFFFFFF
            or start_disk != 0
        ):
            raise _bad_archive()
        position += (
            _ZIP_CENTRAL_HEADER_BYTES
            + filename_size
            + extra_size
            + entry_comment_size
        )
        if position > central_end:
            raise _bad_archive()

    if position != central_end:
        raise _bad_archive()
    return total_entries


def _validate_epub_sizes(
    infos: list[zipfile.ZipInfo], *, archive_size: int
) -> int:
    """Возвращает bounded распакованный размер или отклоняет EPUB-бомбу."""

    unpacked = 0
    for info in infos:
        size = max(0, int(info.file_size))
        if size > _MAX_EPUB_ENTRY_BYTES:
            raise UploadRejected(
                "suspicious_compression",
                "Один из файлов внутри EPUB слишком большой.",
            )
        unpacked += size
        if unpacked > _MAX_EPUB_UNPACKED_BYTES:
            raise UploadRejected(
                "suspicious_compression",
                "Распакованный EPUB слишком большой.",
            )

    if unpacked > max(1, archive_size) * _MAX_EPUB_EXPANSION:
        raise UploadRejected(
            "suspicious_compression",
            "Файл выглядит повреждённым или небезопасным.",
        )
    return unpacked


def _inspect_epub_stream(stream: BinaryIO, *, archive_size: int) -> None:
    _rewind(stream)
    try:
        expected_entries = _preflight_zip_directory(
            stream,
            archive_size=archive_size,
        )
        _rewind(stream)
        with zipfile.ZipFile(stream) as archive:
            infos = archive.infolist()
            if len(infos) != expected_entries:
                raise _bad_archive()
            mimetype = infos[0]
            if (
                mimetype.filename != "mimetype"
                or mimetype.compress_type != zipfile.ZIP_STORED
                or mimetype.file_size != len(_EPUB_MIMETYPE)
                or mimetype.compress_size != len(_EPUB_MIMETYPE)
            ):
                raise UploadRejected(
                    "bad_archive", "EPUB повреждён: неверная служебная запись mimetype."
                )
            with archive.open(mimetype) as mimetype_file:
                if mimetype_file.read(len(_EPUB_MIMETYPE) + 1) != _EPUB_MIMETYPE:
                    raise UploadRejected(
                        "bad_archive",
                        "EPUB повреждён: неверная служебная запись mimetype.",
                    )
            for info in infos:
                name = info.filename.replace("\\", "/")
                if name.startswith("/") or ".." in name.split("/"):
                    raise UploadRejected(
                        "unsafe_archive",
                        "В архиве есть записи с выходом за его пределы.",
                    )
            _validate_epub_sizes(infos, archive_size=archive_size)
    except UploadRejected:
        raise
    except (zipfile.BadZipFile, OSError) as exc:
        raise UploadRejected("bad_archive", "EPUB повреждён: архив не читается.") from exc
    finally:
        _rewind(stream)


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


def looks_like_epub(data: bytes) -> bool:
    """EPUB отличается от прочих ZIP записью `mimetype` в начале архива.

    Одного `PK\\x03\\x04` мало: под него подходят docx, xlsx, jar и любой
    архив. Спецификация EPUB требует, чтобы первой записью шёл несжатый
    `mimetype` со строкой `application/epub+zip`, — на неё и смотрим.
    """
    return data.startswith(_ZIP_MAGIC) and _EPUB_MIMETYPE in data[:1024]


def inspect_epub_archive(data: bytes) -> tuple[int, int]:
    """Число записей и суммарный распакованный размер, без распаковки на диск.

    Читается только оглавление архива: размеры там объявлены, и проверить их
    можно ДО того, как хоть один байт будет распакован. Это и есть защита от
    бомбы — распаковывать её, чтобы узнать размер, поздно.
    """
    stream = io.BytesIO(data)
    try:
        expected_entries = _preflight_zip_directory(stream, archive_size=len(data))
        _rewind(stream)
        with zipfile.ZipFile(stream) as archive:
            infos = archive.infolist()
            if len(infos) != expected_entries:
                raise _bad_archive()
            for info in infos:
                name = info.filename.replace("\\", "/")
                # Путь наружу архива. При распаковке в файловую систему это
                # запись поверх чужого файла; мы на диск не распаковываем, но
                # такой архив в любом случае не заслуживает доверия.
                if name.startswith("/") or ".." in name.split("/"):
                    raise UploadRejected(
                        "unsafe_archive",
                        "В архиве есть записи с выходом за его пределы.",
                    )
            unpacked = _validate_epub_sizes(infos, archive_size=len(data))
            return len(infos), unpacked
    except UploadRejected:
        raise
    except zipfile.BadZipFile as exc:
        raise UploadRejected("bad_archive", "EPUB повреждён: архив не читается.") from exc


def validate_epub_upload(
    *,
    data: bytes,
    safe_name: str,
    scanner: AntivirusScanner | None = None,
) -> ValidatedUpload:
    """Проверка EPUB. Отдельная функция: у ZIP другие риски, чем у PDF."""
    entries, _unpacked = inspect_epub_archive(data)
    if entries > _MAX_EPUB_ENTRIES:
        raise UploadRejected(
            "suspicious_compression", "В архиве слишком много файлов."
        )
    # `inspect_epub_archive` уже применил ratio, absolute и per-entry caps.

    active_scanner = scanner or NullAntivirusScanner()
    clean, _detail = active_scanner.scan(data)
    if not clean:
        raise UploadRejected("infected", "Файл не прошёл антивирусную проверку.")

    warnings: list[str] = []
    if active_scanner.name == "none":
        warnings.append("antivirus_not_configured")

    return ValidatedUpload(
        sanitized_filename=safe_name,
        mime_type="application/epub+zip",
        byte_size=len(data),
        sha256=content_hash(data),
        # У EPUB страниц нет — см. `epub_extraction`. Ноль здесь не «неизвестно»,
        # а «их не бывает», и выдумывать число нельзя.
        page_count=0,
        warnings=tuple(warnings),
    )


def validate_upload_stream(
    *,
    stream: BinaryIO,
    filename: str,
    declared_mime: str = "",
    scanner: AntivirusScanner | None = None,
    max_bytes: int = MAX_BYTES,
    max_pages: int = MAX_PAGES,
) -> ValidatedUpload:
    """Потоковая web-валидация PDF/EPUB без `upload.read()`.

    Поток обязан быть seekable: Django уже спуливает multipart-файлы крупнее
    `FILE_UPLOAD_MAX_MEMORY_SIZE` во временный файл, поэтому повторные проходы
    здесь не создают полную копию в памяти.
    """

    inspected = _inspect_stream(stream, max_bytes=max_bytes)
    if inspected.byte_size < MIN_BYTES:
        raise UploadRejected("empty_file", "Файл пустой или слишком маленький.")

    safe_name = sanitize_filename(filename)
    extension = ("." + safe_name.rsplit(".", 1)[-1].lower()) if "." in safe_name else ""
    if extension not in ALLOWED_EXTENSIONS:
        raise UploadRejected(
            "bad_extension", "Поддерживаются только файлы PDF и EPUB."
        )
    if declared_mime and declared_mime.split(";")[0].strip() not in ALLOWED_MIME_TYPES:
        raise UploadRejected(
            "bad_mime", "Поддерживаются только файлы PDF и EPUB."
        )

    is_epub = inspected.head.startswith(_ZIP_MAGIC) and (
        _EPUB_MIMETYPE in inspected.head
    )
    is_pdf = _PDF_MAGIC in inspected.head
    if not is_epub and not is_pdf:
        raise UploadRejected(
            "bad_magic",
            "Содержимое файла не похоже ни на PDF, ни на EPUB.",
        )

    if is_epub:
        _inspect_epub_stream(stream, archive_size=inspected.byte_size)
        scanner_name, clean = _scan_upload_stream(stream, scanner)
        if not clean:
            raise UploadRejected(
                "infected", "Файл не прошёл антивирусную проверку."
            )
        return ValidatedUpload(
            sanitized_filename=safe_name,
            mime_type="application/epub+zip",
            byte_size=inspected.byte_size,
            sha256=inspected.sha256,
            page_count=0,
            warnings=("antivirus_not_configured",) if scanner_name == "none" else (),
        )

    if inspected.encrypted:
        raise UploadRejected(
            "encrypted_pdf",
            "PDF защищён паролем. Снимите защиту и загрузите файл заново.",
        )
    if (
        inspected.declared_stream_bytes > 0
        and inspected.declared_stream_bytes
        > inspected.byte_size * _MAX_DECLARED_EXPANSION
    ):
        raise UploadRejected(
            "suspicious_compression",
            "Файл выглядит повреждённым или небезопасным.",
        )
    if inspected.page_count > max_pages:
        raise UploadRejected(
            "too_many_pages", f"В документе больше {max_pages} страниц."
        )

    scanner_name, clean = _scan_upload_stream(stream, scanner)
    if not clean:
        raise UploadRejected("infected", "Файл не прошёл антивирусную проверку.")
    warnings: list[str] = []
    if inspected.page_count == 0:
        warnings.append("page_count_unknown")
    if scanner_name == "none":
        warnings.append("antivirus_not_configured")
    return ValidatedUpload(
        sanitized_filename=safe_name,
        mime_type="application/pdf",
        byte_size=inspected.byte_size,
        sha256=inspected.sha256,
        page_count=inspected.page_count,
        warnings=tuple(warnings),
    )


def validate_upload(
    *,
    data: bytes,
    filename: str,
    declared_mime: str = "",
    scanner: AntivirusScanner | None = None,
    max_bytes: int = MAX_BYTES,
    max_pages: int = MAX_PAGES,
) -> ValidatedUpload:
    """Единая точка входа: формат определяется по СОДЕРЖИМОМУ.

    Расширение приходит из имени файла, то есть от пользователя. `книга.pdf`,
    внутри которой ZIP, — обычное дело, и доверять расширению нельзя.
    """
    return validate_upload_stream(
        stream=io.BytesIO(data),
        filename=filename,
        declared_mime=declared_mime,
        scanner=scanner,
        max_bytes=max_bytes,
        max_pages=max_pages,
    )


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

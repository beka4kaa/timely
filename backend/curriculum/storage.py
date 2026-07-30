"""Заменяемый storage для исходных файлов документов.

В проекте на момент написания НЕТ ни одного `FileField`, `MEDIA_ROOT` не задан,
object storage не подключён. Поэтому здесь вводится минимальный протокол, а не
привязка к Django storages: доменная логика обязана уметь работать и с локальной
папкой в тестах, и с S3-совместимым бакетом в production, не меняя вызовов.

Важно про production: контейнер эфемерный (Northflank, gunicorn в Docker), и
локальный диск переживает только один процесс. `LocalFileStorage` пригоден для
тестов и одиночной dev-машины, но НЕ для production — там нужен S3-совместимый
backend, заготовка которого описана в `S3StorageSettings`.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

# Ключи в storage строим сами и никогда не берём из имени файла пользователя:
# иначе «../../etc/passwd» уедет за пределы каталога.
_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9/_.-]{0,500}$")

_UNSAFE_FILENAME_CHARS = re.compile(r"[^\w\s.-]", re.UNICODE)
_WHITESPACE = re.compile(r"\s+")


class StorageError(RuntimeError):
    """Ошибка storage-слоя, безопасная для показа пользователю."""


def sanitize_filename(raw: str, *, fallback: str = "document.pdf") -> str:
    """Приводит имя файла к безопасному виду, сохраняя читаемость.

    Убирает путь, управляющие символы и всё, что может быть интерпретировано
    файловой системой или заголовком Content-Disposition. Имя используется
    только для показа и для скачивания — ключ в storage строится отдельно.
    """
    name = (raw or "").strip()
    # Отбрасываем любые попытки передать путь — и POSIX, и Windows.
    name = name.replace("\\", "/").split("/")[-1]
    name = unicodedata.normalize("NFKC", name)
    name = "".join(ch for ch in name if ch.isprintable())
    name = _UNSAFE_FILENAME_CHARS.sub("_", name)
    name = _WHITESPACE.sub(" ", name).strip(" ._")

    if not name:
        return fallback
    # Точки в начале (скрытые файлы) и слишком длинные имена не нужны.
    name = name.lstrip(".")
    if len(name) > 180:
        stem, dot, ext = name.rpartition(".")
        ext = ext[:16]
        name = (stem[: 180 - len(ext) - 1] + dot + ext) if dot else name[:180]
    return name or fallback


def content_hash(data: bytes) -> str:
    """sha256 содержимого — дедупликация и проверка целостности."""
    return hashlib.sha256(data).hexdigest()


def build_storage_key(*, user_email: str, document_id: str, filename: str) -> str:
    """Детерминированный ключ вида `documents/<хеш почты>/<id>/<имя>`.

    Почта хешируется, а не кладётся в путь: ключ может попасть в логи и в
    подписанную ссылку, а адрес несовершеннолетнего пользователя — персональные
    данные.
    """
    owner = hashlib.sha256(user_email.strip().lower().encode()).hexdigest()[:16]
    safe_name = sanitize_filename(filename)
    return f"documents/{owner}/{document_id}/{safe_name}"


class FileStorage(Protocol):
    """Минимальный контракт хранилища исходников."""

    backend_name: str

    def save(self, key: str, data: bytes) -> str: ...

    def open(self, key: str) -> bytes: ...

    def delete(self, key: str) -> None: ...

    def exists(self, key: str) -> bool: ...

    def signed_url(self, key: str, *, expires_seconds: int = 300) -> str: ...


def _validate_key(key: str) -> None:
    if not _KEY_RE.match(key or "") or ".." in key:
        raise StorageError("Некорректный ключ файла.")


class LocalFileStorage:
    """Файлы в локальной папке. Только тесты и одиночная dev-машина."""

    backend_name = "local"

    def __init__(self, root: str | os.PathLike[str]) -> None:
        self._root = Path(root).resolve()
        self._root.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        _validate_key(key)
        path = (self._root / key).resolve()
        # Повторная проверка после resolve: символические ссылки и хитрые ключи
        # не должны выводить за пределы корня.
        if not str(path).startswith(str(self._root) + os.sep):
            raise StorageError("Некорректный ключ файла.")
        return path

    def save(self, key: str, data: bytes) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return key

    def open(self, key: str) -> bytes:
        path = self._path(key)
        if not path.exists():
            raise StorageError("Файл не найден.")
        return path.read_bytes()

    def delete(self, key: str) -> None:
        path = self._path(key)
        if path.exists():
            path.unlink()
        # Подчищаем пустой каталог документа, чтобы удаление было полным.
        parent = path.parent
        if parent != self._root and parent.exists() and not any(parent.iterdir()):
            shutil.rmtree(parent, ignore_errors=True)

    def exists(self, key: str) -> bool:
        try:
            return self._path(key).exists()
        except StorageError:
            return False

    def signed_url(self, key: str, *, expires_seconds: int = 300) -> str:
        """Локальный backend не умеет подписывать — отдаём внутренний маршрут.

        Отдельный метод существует, чтобы доменный код с самого начала не знал
        про пути на диске и переезд на S3 не потребовал правок вызовов.
        """
        _validate_key(key)
        return f"/api/curriculum/documents/file/{key}"


@dataclass(frozen=True)
class S3StorageSettings:
    """Конфигурация будущего S3-совместимого backend.

    Класс намеренно без реализации: добавлять boto3 и production-креды в рамках
    foundation нельзя. Здесь зафиксировано, чего именно не хватает для переезда,
    чтобы это не пришлось выяснять заново.
    """

    bucket: str
    region: str = ""
    endpoint_url: str = ""
    # Обязательно: приватный бакет + подписанные ссылки с коротким TTL.
    public_read: bool = False
    signed_url_ttl_seconds: int = 300
    server_side_encryption: str = "AES256"


_storage: FileStorage | None = None


def get_storage() -> FileStorage:
    """Текущее хранилище. Переопределяется в тестах через `set_storage`."""
    global _storage
    if _storage is None:
        from django.conf import settings

        root = getattr(settings, "CURRICULUM_STORAGE_ROOT", None)
        if not root:
            root = Path(settings.BASE_DIR) / ".curriculum-storage"
        _storage = LocalFileStorage(root)
    return _storage


def set_storage(storage: FileStorage | None) -> None:
    """Подменяет backend (тесты, будущий S3)."""
    global _storage
    _storage = storage

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
import io
import os
import re
import shutil
import tempfile
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol

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
    """Детерминированный ключ вида `documents/<хеш почты>/<id>/source.ext`.

    Почта хешируется, а не кладётся в путь: ключ может попасть в логи и в
    подписанную ссылку, а адрес несовершеннолетнего пользователя — персональные
    данные. Исходное имя тоже не входит в ключ: оно хранится отдельно для UI,
    может содержать кириллицу и не должно влиять на безопасный storage path.
    """
    owner = hashlib.sha256(user_email.strip().lower().encode()).hexdigest()[:16]
    safe_name = sanitize_filename(filename)
    suffix = Path(safe_name).suffix.lower()
    safe_suffix = suffix if re.fullmatch(r"\.[a-z0-9]{1,16}", suffix) else ""
    return f"documents/{owner}/{document_id}/source{safe_suffix}"


class FileStorage(Protocol):
    """Минимальный контракт хранилища исходников."""

    backend_name: str

    def save(self, key: str, data: bytes) -> str: ...

    def save_stream(self, key: str, source: BinaryIO) -> str: ...

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
        return self.save_stream(key, io.BytesIO(data))

    def save_stream(self, key: str, source: BinaryIO) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                dir=path.parent,
                prefix=f".{path.name}.",
                suffix=".upload",
                delete=False,
            ) as target:
                temporary_path = Path(target.name)
                shutil.copyfileobj(source, target, length=1024 * 1024)
                target.flush()
                os.fsync(target.fileno())
            os.replace(temporary_path, path)
        except Exception as exc:  # noqa: BLE001 — наружу только StorageError
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)
            raise StorageError("Не удалось сохранить файл в хранилище.") from exc
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
    """Конфигурация S3-совместимого backend (AWS S3, Cloudflare R2, MinIO)."""

    bucket: str
    region: str = ""
    endpoint_url: str = ""
    access_key_id: str = ""
    secret_access_key: str = ""
    # Обязательно: приватный бакет + подписанные ссылки с коротким TTL.
    public_read: bool = False
    signed_url_ttl_seconds: int = 300
    # Пусто по умолчанию НЕ по недосмотру. AWS S3 с января 2023 шифрует объекты
    # сам, а Cloudflare R2 заголовок `ServerSideEncryption` не принимает — на нём
    # безусловный `AES256` превратил бы каждую загрузку в ошибку. Кому нужен
    # явный SSE (например, `aws:kms`), задаёт его настройкой.
    server_side_encryption: str = ""
    # Ограничители сети. Без них зависший бакет держит поток gunicorn до упора,
    # а в проде их всего 16 (2 воркера × 8 тредов).
    connect_timeout_seconds: int = 5
    read_timeout_seconds: int = 30
    max_attempts: int = 3


def _error_code(exc: Exception) -> str:
    """Код ошибки S3 без импорта botocore.

    Модуль обязан импортироваться там, где boto3 не установлен (тесты, локальная
    разработка), поэтому `ClientError` здесь не ловится по типу.
    """
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return ""
    error = response.get("Error")
    if not isinstance(error, dict):
        return ""
    return str(error.get("Code", ""))


_NOT_FOUND_CODES = {"404", "NoSuchKey", "NotFound", "NoSuchBucket"}


class S3FileStorage:
    """Файлы в S3-совместимом бакете.

    Реализует тот же `FileStorage`, что и локальный backend, поэтому вызывающий
    код не меняется ни в одном месте.

    Зачем это вообще: контейнер Northflank эфемерный, и загруженный PDF пропадает
    при перезапуске. Отдельно это жёсткое предусловие Фазы 4b — воркер в другом
    контейнере физически не видит диск web-контейнера, и без общего хранилища
    каждая задача падала бы в `storage_unavailable`.
    """

    backend_name = "s3"

    def __init__(self, settings: S3StorageSettings, *, client=None) -> None:
        if not settings.bucket:
            raise StorageError("S3-хранилище требует имя бакета.")
        self.settings = settings
        self._client = client

    @property
    def client(self):
        """Ленивый клиент: без него модуль импортируется и без boto3."""
        if self._client is None:
            self._client = _build_s3_client(self.settings)
        return self._client

    def _extra_put_args(self) -> dict:
        if not self.settings.server_side_encryption:
            return {}
        return {"ServerSideEncryption": self.settings.server_side_encryption}

    def save(self, key: str, data: bytes) -> str:
        return self.save_stream(key, io.BytesIO(data))

    def save_stream(self, key: str, source: BinaryIO) -> str:
        _validate_key(key)
        try:
            from boto3.s3.transfer import TransferConfig

            extra_args = self._extra_put_args() or None
            self.client.upload_fileobj(
                source,
                self.settings.bucket,
                key,
                ExtraArgs=extra_args,
                Config=TransferConfig(
                    multipart_threshold=8 * 1024 * 1024,
                    multipart_chunksize=8 * 1024 * 1024,
                    max_concurrency=1,
                    use_threads=False,
                ),
            )
        except Exception as exc:  # noqa: BLE001 — наружу только StorageError
            raise StorageError("Не удалось сохранить файл в хранилище.") from exc
        return key

    def open(self, key: str) -> bytes:
        _validate_key(key)
        try:
            response = self.client.get_object(Bucket=self.settings.bucket, Key=key)
        except Exception as exc:  # noqa: BLE001
            if _error_code(exc) in _NOT_FOUND_CODES:
                raise StorageError("Файл не найден.") from exc
            raise StorageError("Хранилище файлов сейчас недоступно.") from exc
        body = response["Body"]
        try:
            return body.read()
        finally:
            close = getattr(body, "close", None)
            if callable(close):
                close()

    def delete(self, key: str) -> None:
        _validate_key(key)
        try:
            self.client.delete_object(Bucket=self.settings.bucket, Key=key)
        except Exception as exc:  # noqa: BLE001
            # Удаление отсутствующего объекта — не ошибка: повторный вызов
            # должен приводить к тому же состоянию, что и первый.
            if _error_code(exc) in _NOT_FOUND_CODES:
                return
            raise StorageError("Не удалось удалить файл из хранилища.") from exc

    def exists(self, key: str) -> bool:
        try:
            _validate_key(key)
        except StorageError:
            return False
        try:
            self.client.head_object(Bucket=self.settings.bucket, Key=key)
        except Exception as exc:  # noqa: BLE001
            if _error_code(exc) in _NOT_FOUND_CODES:
                return False
            raise StorageError("Хранилище файлов сейчас недоступно.") from exc
        return True

    def signed_url(self, key: str, *, expires_seconds: int = 300) -> str:
        """Подписанная ссылка с коротким TTL. Бакет приватный всегда."""
        _validate_key(key)
        ttl = expires_seconds or self.settings.signed_url_ttl_seconds
        try:
            return self.client.generate_presigned_url(
                "get_object",
                Params={"Bucket": self.settings.bucket, "Key": key},
                ExpiresIn=int(ttl),
            )
        except Exception as exc:  # noqa: BLE001
            raise StorageError("Не удалось выдать ссылку на файл.") from exc


def _build_s3_client(settings: S3StorageSettings):
    """Клиент boto3. Импорт внутри функции — см. `S3FileStorage.client`."""
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:  # pragma: no cover — зависит от окружения
        raise StorageError(
            "boto3 не установлен, а хранилище настроено на S3."
        ) from exc

    config = Config(
        connect_timeout=settings.connect_timeout_seconds,
        read_timeout=settings.read_timeout_seconds,
        retries={"max_attempts": settings.max_attempts, "mode": "standard"},
        # R2 и MinIO работают только с подписью v4.
        signature_version="s3v4",
    )
    kwargs = {"config": config}
    if settings.region:
        kwargs["region_name"] = settings.region
    if settings.endpoint_url:
        kwargs["endpoint_url"] = settings.endpoint_url
    # Ключи можно не задавать: тогда boto3 возьмёт их из своей обычной цепочки
    # (переменные окружения, профиль, роль инстанса).
    if settings.access_key_id and settings.secret_access_key:
        kwargs["aws_access_key_id"] = settings.access_key_id
        kwargs["aws_secret_access_key"] = settings.secret_access_key
    return boto3.client("s3", **kwargs)


def s3_settings_from_django() -> S3StorageSettings | None:
    """Настройки S3 из Django-конфигурации.

    `None`, если бакет не задан или S3 выключен общим рубильником — под
    тест-раннером он выключен всегда, см. комментарий в `config/settings.py`.
    """
    from django.conf import settings as django_settings

    if not getattr(django_settings, "CURRICULUM_S3_ENABLED", True):
        return None

    bucket = (getattr(django_settings, "CURRICULUM_S3_BUCKET", "") or "").strip()
    if not bucket:
        return None
    return S3StorageSettings(
        bucket=bucket,
        region=(getattr(django_settings, "CURRICULUM_S3_REGION", "") or "").strip(),
        endpoint_url=(
            getattr(django_settings, "CURRICULUM_S3_ENDPOINT_URL", "") or ""
        ).strip(),
        access_key_id=(
            getattr(django_settings, "CURRICULUM_S3_ACCESS_KEY_ID", "") or ""
        ).strip(),
        secret_access_key=(
            getattr(django_settings, "CURRICULUM_S3_SECRET_ACCESS_KEY", "") or ""
        ).strip(),
        signed_url_ttl_seconds=int(
            getattr(django_settings, "CURRICULUM_S3_SIGNED_URL_TTL", 300)
        ),
        server_side_encryption=(
            getattr(django_settings, "CURRICULUM_S3_SSE", "") or ""
        ).strip(),
    )


_storage: FileStorage | None = None


def get_storage() -> FileStorage:
    """Текущее хранилище. Переопределяется в тестах через `set_storage`.

    S3 выбирается ровно по одному признаку — заданному бакету. Ключи при этом
    необязательны: в облаке их часто выдаёт роль инстанса, и требовать их здесь
    значило бы запретить самый безопасный способ доступа.
    """
    global _storage
    if _storage is None:
        from django.conf import settings

        s3 = s3_settings_from_django()
        if s3 is not None:
            _storage = S3FileStorage(s3)
            return _storage

        root = getattr(settings, "CURRICULUM_STORAGE_ROOT", None)
        if not root:
            root = Path(settings.BASE_DIR) / ".curriculum-storage"
        _storage = LocalFileStorage(root)
    return _storage


def set_storage(storage: FileStorage | None) -> None:
    """Подменяет backend (тесты, будущий S3)."""
    global _storage
    _storage = storage

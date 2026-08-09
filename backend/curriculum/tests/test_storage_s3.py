"""S3-хранилище: контракт, ошибки и выбор backend.

Сети здесь нет и быть не должно: клиент подставляется stub'ом через конструктор.
Проверяется ровно то, что мы написали сами, — трансляция ошибок, безопасность
ключей и то, что вызывающий код не отличает S3 от локальной папки.
"""

from django.test import TestCase, override_settings

from curriculum import storage as storage_module
from curriculum.storage import (
    S3FileStorage,
    S3StorageSettings,
    StorageError,
    build_storage_key,
)


class StubClientError(Exception):
    """Подобие `botocore.exceptions.ClientError`: важен только `.response`."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.response = {"Error": {"Code": code}}


class StubBody:
    def __init__(self, data: bytes) -> None:
        self._data = data
        self.closed = False

    def read(self) -> bytes:
        return self._data

    def close(self) -> None:
        self.closed = True


class StubS3Client:
    """Минимальный S3 в памяти."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.put_calls: list[dict] = []
        self.raise_on: dict[str, Exception] = {}

    def _maybe_raise(self, op: str) -> None:
        exc = self.raise_on.get(op)
        if exc is not None:
            raise exc

    def put_object(self, **kwargs):
        self._maybe_raise("put_object")
        self.put_calls.append(kwargs)
        self.objects[kwargs["Key"]] = kwargs["Body"]
        return {}

    def get_object(self, **kwargs):
        self._maybe_raise("get_object")
        key = kwargs["Key"]
        if key not in self.objects:
            raise StubClientError("NoSuchKey")
        return {"Body": StubBody(self.objects[key])}

    def delete_object(self, **kwargs):
        self._maybe_raise("delete_object")
        self.objects.pop(kwargs["Key"], None)
        return {}

    def head_object(self, **kwargs):
        self._maybe_raise("head_object")
        if kwargs["Key"] not in self.objects:
            raise StubClientError("404")
        return {}

    def generate_presigned_url(self, op, Params, ExpiresIn):  # noqa: N803
        self._maybe_raise("generate_presigned_url")
        return f"https://example.test/{Params['Key']}?op={op}&ttl={ExpiresIn}"


def make_storage(**overrides) -> tuple[S3FileStorage, StubS3Client]:
    client = StubS3Client()
    settings = S3StorageSettings(bucket="books", **overrides)
    return S3FileStorage(settings, client=client), client


KEY = build_storage_key(
    user_email="a@b.c", document_id="11111111-1111-1111-1111-111111111111",
    filename="book.pdf",
)


class S3StorageContractTests(TestCase):
    def test_сохранить_прочитать_удалить(self):
        storage, client = make_storage()

        storage.save(KEY, b"%PDF-1.7 data")
        self.assertTrue(storage.exists(KEY))
        self.assertEqual(storage.open(KEY), b"%PDF-1.7 data")

        storage.delete(KEY)
        self.assertFalse(storage.exists(KEY))
        self.assertEqual(client.objects, {})

    def test_отсутствующий_файл_даёт_понятную_ошибку(self):
        storage, _ = make_storage()
        with self.assertRaises(StorageError) as ctx:
            storage.open(KEY)
        self.assertIn("не найден", str(ctx.exception).lower())

    def test_повторное_удаление_не_ошибка(self):
        # Идемпотентность: второй вызов обязан приводить к тому же состоянию.
        storage, client = make_storage()
        client.raise_on["delete_object"] = StubClientError("NoSuchKey")
        storage.delete(KEY)  # не бросает

    def test_сбой_хранилища_не_выдаёт_подробностей_наружу(self):
        storage, client = make_storage()
        client.raise_on["get_object"] = StubClientError("InternalError")
        with self.assertRaises(StorageError) as ctx:
            storage.open(KEY)
        self.assertIn("недоступно", str(ctx.exception).lower())

    def test_ключ_с_переходом_вверх_отклоняется(self):
        storage, client = make_storage()
        for bad in ("../../etc/passwd", "/absolute", "documents/../secret"):
            with self.assertRaises(StorageError):
                storage.save(bad, b"x")
        self.assertEqual(client.objects, {}, "ни один плохой ключ не записан")

    def test_exists_на_плохом_ключе_отвечает_false_а_не_падает(self):
        storage, _ = make_storage()
        self.assertFalse(storage.exists("../../etc/passwd"))

    def test_подписанная_ссылка_с_коротким_ttl(self):
        storage, _ = make_storage(signed_url_ttl_seconds=120)
        url = storage.signed_url(KEY, expires_seconds=60)
        self.assertIn(KEY, url)
        self.assertIn("ttl=60", url)
        # Без явного срока берётся настроенный.
        self.assertIn("ttl=120", storage.signed_url(KEY, expires_seconds=0))

    def test_бакет_обязателен(self):
        with self.assertRaises(StorageError):
            S3FileStorage(S3StorageSettings(bucket=""), client=StubS3Client())


class S3KillSwitchTests(TestCase):
    def tearDown(self):
        storage_module.set_storage(None)

    @override_settings(CURRICULUM_S3_BUCKET="timely")
    def test_под_тест_раннером_s3_не_выбирается_даже_с_бакетом(self):
        # Иначе забытый `set_storage` в любом тесте писал бы в боевой бакет.
        storage_module.set_storage(None)
        self.assertEqual(storage_module.get_storage().backend_name, "local")
        self.assertIsNone(storage_module.s3_settings_from_django())


class S3EncryptionHeaderTests(TestCase):
    def test_без_настройки_заголовок_sse_не_отправляется(self):
        # Cloudflare R2 заголовок `ServerSideEncryption` не принимает: с ним
        # каждая загрузка отвечала бы ошибкой.
        storage, client = make_storage()
        storage.save(KEY, b"x")
        self.assertNotIn("ServerSideEncryption", client.put_calls[0])

    def test_настроенный_sse_попадает_в_запрос(self):
        storage, client = make_storage(server_side_encryption="AES256")
        storage.save(KEY, b"x")
        self.assertEqual(client.put_calls[0]["ServerSideEncryption"], "AES256")


class StorageSelectionTests(TestCase):
    """Выбор backend.

    Каждый тест здесь включает `CURRICULUM_S3_ENABLED` обратно: под тест-раннером
    рубильник выключен, иначе `.env` разработчика с боевыми ключами R2 протёк бы
    в прогон. Ключи тоже переопределяются явно — иначе тест проверяет содержимое
    чужого окружения, а не поведение кода.
    """

    def tearDown(self):
        storage_module.set_storage(None)

    @override_settings(CURRICULUM_S3_ENABLED=True, CURRICULUM_S3_BUCKET="")
    def test_без_бакета_остаётся_локальная_папка(self):
        storage_module.set_storage(None)
        self.assertEqual(storage_module.get_storage().backend_name, "local")

    @override_settings(
        CURRICULUM_S3_ENABLED=True,
        CURRICULUM_S3_BUCKET="books",
        CURRICULUM_S3_ENDPOINT_URL="https://acc.r2.cloudflarestorage.com",
        CURRICULUM_S3_REGION="auto",
    )
    def test_заданный_бакет_включает_s3(self):
        storage_module.set_storage(None)
        storage = storage_module.get_storage()
        self.assertEqual(storage.backend_name, "s3")
        self.assertEqual(storage.settings.bucket, "books")
        self.assertEqual(storage.settings.region, "auto")

    @override_settings(
        CURRICULUM_S3_ENABLED=True,
        CURRICULUM_S3_BUCKET="books",
        CURRICULUM_S3_ACCESS_KEY_ID="",
        CURRICULUM_S3_SECRET_ACCESS_KEY="",
    )
    def test_ключи_необязательны_их_может_выдать_роль_инстанса(self):
        settings = storage_module.s3_settings_from_django()
        self.assertIsNotNone(settings)
        self.assertEqual(settings.access_key_id, "")
        # Клиент при этом не создаётся: он ленивый, сети в тестах нет.
        storage_module.set_storage(None)
        self.assertEqual(storage_module.get_storage().backend_name, "s3")

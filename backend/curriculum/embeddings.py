"""Эмбеддинги фрагментов книги.

Дисциплина ровно та же, что в `ocr.py` и `planning/providers.py`: провайдер
выбирается по конфигурации, а НЕнастроенная роль даёт «пустой» провайдер, а не
падение и не неожиданный платный вызов. Забытая переменная окружения не должна
ни ломать загрузку книги, ни выставлять счёт.

`ROLE_EMBEDDING` — первый реальный потребитель этой роли в проекте. Она
намеренно исключена из `_TEXT_FALLBACK_ROLES` в `model_registry`, поэтому
чат-модель сюда подставиться не может: она не считает эмбеддинги.

**Про базовый URL.** У роли свои `EMBEDDING_BASE_URL` и `EMBEDDING_API_KEY`,
потому что эмбеддинги не обязаны считаться там же, где работает чат-модель.
Ключ по умолчанию берётся из `OPENROUTER_API_KEY`: у OpenRouter эндпоинт
`/embeddings` есть и совместим (проверено вживую — батч, поле `index`,
1536 измерений у `openai/text-embedding-3-small`), поэтому отдельный ключ нужен
только при переходе на другого провайдера.

**Ловушка каталога.** Эмбеддинг-моделей НЕТ в `/api/v1/models` у OpenRouter: в
каталоге из четырёхсот моделей ни одной с «embed» в идентификаторе. Правило
проекта «проверь модель в `/api/v1/models`, прежде чем её ставить» (см.
`CLAUDE.md` про image-модели) здесь НЕ работает и даёт ложный вывод, что
эмбеддингов нет вовсе. Проверять надо запросом к самому `/embeddings`.

**Про размерность.** `models.EMBEDDING_DIMENSIONS` зашит в миграцию как
`vector(1536)`. Модель другой размерности подключать нельзя, пока не сделана
новая миграция и переиндексация, поэтому провайдер проверяет длину каждого
вектора и отказывается отдавать чужую: молча записанный вектор не той длины —
это тихо испорченный индекс.
"""

from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from typing import Protocol, Sequence

from .model_registry import ROLE_EMBEDDING, resolve_model
from .models import EMBEDDING_DIMENSIONS

logger = logging.getLogger(__name__)

# Сколько текстов уходит в один запрос. 64 — компромисс: заметно меньше
# round-trip'ов, чем по одному, и при этом батч не настолько велик, чтобы его
# падение стоило дорого (упавший батч помечает `failed` только свои чанки).
EMBEDDING_BATCH_SIZE = 64

# Ограниченный backoff. Именно ограниченный: бесконечные ретраи превращают
# недоступный провайдер в зависшую навсегда обработку книги.
MAX_ATTEMPTS = 3
BACKOFF_SECONDS = (1.0, 2.0)

# Обрезка входа. Провайдеры ограничивают длину входа, и чанк-переросток обязан
# уехать обрезанным, а не уронить весь батч.
MAX_INPUT_CHARS = 8000

EMBEDDING_BASE_URL = os.getenv("EMBEDDING_BASE_URL", "").strip()
EMBEDDING_API_KEY = (
    os.getenv("EMBEDDING_API_KEY") or os.getenv("OPENROUTER_API_KEY", "")
).strip()


@dataclass(frozen=True)
class EmbeddingResult:
    """Результат одного батча.

    `vectors` либо пуст, либо ровно той же длины, что вход: частичный ответ
    невозможно сопоставить с текстами, а сопоставление «на глазок» испортило бы
    индекс незаметно.
    """

    vectors: list[list[float]] = field(default_factory=list)
    model: str = ""
    succeeded: bool = False
    error: str = ""

    def matches(self, texts: Sequence[str]) -> bool:
        return self.succeeded and len(self.vectors) == len(texts)


class EmbeddingProvider(Protocol):
    name: str
    dimensions: int

    def embed(self, texts: Sequence[str]) -> EmbeddingResult: ...


class NullEmbeddingProvider:
    """Провайдер по умолчанию: эмбеддинги не настроены.

    Возвращает неуспех с кодом `embedding_not_configured`, а не исключение:
    книга без векторов остаётся полностью рабочей — лексический поиск и
    программа по ней строятся как раньше. Векторного поиска просто нет.
    """

    name = "null-embedding"
    dimensions = EMBEDDING_DIMENSIONS

    def embed(self, texts: Sequence[str]) -> EmbeddingResult:
        return EmbeddingResult(succeeded=False, error="embedding_not_configured")


class OpenAICompatibleEmbeddingProvider:
    """Эмбеддинги через любой сервис с OpenAI-совместимым `/embeddings`."""

    name = "openai-compatible-embedding"

    def __init__(
        self,
        *,
        model: str,
        base_url: str,
        api_key: str,
        dimensions: int = EMBEDDING_DIMENSIONS,
        timeout_seconds: int = 60,
    ) -> None:
        if not model:
            raise ValueError("Провайдер эмбеддингов требует непустое имя модели")
        if not base_url:
            raise ValueError("Провайдер эмбеддингов требует EMBEDDING_BASE_URL")
        self.model = model
        self.base_url = base_url
        self.api_key = api_key
        self.dimensions = dimensions
        self.timeout_seconds = timeout_seconds

    def embed(self, texts: Sequence[str]) -> EmbeddingResult:
        if not texts:
            return EmbeddingResult(succeeded=True, model=self.model)

        # Импорт внутри метода: модуль должен импортироваться в тестах без сети
        # и без ключей.
        from openai import OpenAI

        from ai_engine.usage import provider_from_base_url, record_model_usage

        payload = [(text or "")[:MAX_INPUT_CHARS] for text in texts]
        client = OpenAI(
            api_key=self.api_key, base_url=self.base_url, max_retries=0
        )

        last_error = ""
        for attempt in range(MAX_ATTEMPTS):
            try:
                response = client.embeddings.create(
                    model=self.model, input=payload, timeout=self.timeout_seconds
                )
            except Exception as exc:  # noqa: BLE001 — наружу не роняем
                last_error = str(exc)
                logger.warning(
                    "Батч эмбеддингов не удался (%s, попытка %s/%s): %s",
                    self.model,
                    attempt + 1,
                    MAX_ATTEMPTS,
                    exc,
                )
                if attempt < len(BACKOFF_SECONDS):
                    time.sleep(BACKOFF_SECONDS[attempt])
                continue

            record_model_usage(
                response,
                model=self.model,
                provider=provider_from_base_url(self.base_url),
                feature="curriculum_embedding",
            )

            # Порядок ответа гарантируется полем `index`, а не позицией в
            # списке: сортировка по нему стоит дёшево и снимает целый класс
            # тихих ошибок сопоставления вектора не с тем текстом.
            items = sorted(response.data, key=lambda item: item.index)
            vectors = [list(item.embedding) for item in items]

            if len(vectors) != len(payload):
                return EmbeddingResult(
                    model=self.model,
                    succeeded=False,
                    error=f"embedding_count_mismatch:{len(vectors)}!={len(payload)}",
                )
            wrong = next(
                (len(v) for v in vectors if len(v) != self.dimensions), None
            )
            if wrong is not None:
                return EmbeddingResult(
                    model=self.model,
                    succeeded=False,
                    error=f"embedding_dimension_mismatch:{wrong}!={self.dimensions}",
                )

            return EmbeddingResult(vectors=vectors, model=self.model, succeeded=True)

        return EmbeddingResult(
            model=self.model, succeeded=False, error=last_error or "embedding_failed"
        )


def get_embedding_provider() -> EmbeddingProvider:
    """Настроенный провайдер или `NullEmbeddingProvider`.

    Реальный провайдер требует ВСЕ ТРИ настройки: `EMBEDDING_MODEL`,
    `EMBEDDING_BASE_URL` и ключ.

    Базовый URL не имеет умолчания намеренно: угадывать, куда слать платные
    запросы, — плохая идея, а разные провайдеры дают РАЗНУЮ размерность
    (`openai/text-embedding-3-small` — 1536, `baai/bge-m3` — 1024,
    `qwen/qwen3-embedding-8b` — 4096). В схеме зафиксировано 1536, и молчаливый
    выбор чужого сервиса означал бы отказ на каждом батче.

    Ключ проверяется отдельно: без него сервис ответит 401, батчи пометятся как
    `failed`, и «провайдер не настроен» превратится в «индексация сломалась».
    Это разные вещи, и забытый ключ должен давать честный `skipped`.
    """
    from django.conf import settings

    # Общий рубильник. Под тест-раннером выключен всегда — см. комментарий в
    # `config/settings.py`: иначе прогон тестов ходит в сеть и тратит деньги.
    if not getattr(settings, "CURRICULUM_EMBEDDINGS_ENABLED", True):
        return NullEmbeddingProvider()

    binding = resolve_model(ROLE_EMBEDDING)
    if not binding.configured or not EMBEDDING_BASE_URL or not EMBEDDING_API_KEY:
        return NullEmbeddingProvider()
    return OpenAICompatibleEmbeddingProvider(
        model=binding.model,
        base_url=EMBEDDING_BASE_URL,
        api_key=EMBEDDING_API_KEY,
        timeout_seconds=binding.timeout_seconds,
    )


def estimate_tokens(text: str) -> int:
    """Грубая оценка числа токенов для подсчёта стоимости ДО траты.

    Настоящий токенайзер — Фаза 5; здесь сознательно взято приближение
    «4 символа на токен», которого достаточно, чтобы `--dry-run` показал
    порядок величины, а не точную цифру.
    """
    return max(1, len(text or "") // 4)

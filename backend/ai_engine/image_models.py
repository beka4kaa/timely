"""
Реестр image-моделей и валидация выбора пользователя.

Зачем отдельный модуль: модель генерации раньше жила в одной константе
`image_enrichment._MODEL`, которая читается НА ИМПОРТЕ. Сменить её можно было
только перезапуском backend, а значит сравнить две модели на одном сюжете —
нельзя. `PRODUCT.md` §13.1/§13.4 требует обратного: идентификаторы моделей в
config, у каждой роли — provider, fallback и стоимость.

Здесь только чистые данные и валидация: ни сети, ни Django-вьюх. Модуль
импортируется и из `image_enrichment`, и из вьюх, поэтому он обязан оставаться
без тяжёлых зависимостей, иначе появится цикл импортов.

БЕЗОПАСНОСТЬ: model ID, пришедшему с фронтенда, доверять нельзя. Любой выбор
проходит через `resolve_options`, и всё, чего нет в allowlist, отклоняется —
иначе пользователь смог бы направить наш OpenRouter-ключ в произвольную
модель.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from django.conf import settings

# Качества, которые вообще существуют. Порядок — от дешёвого к дорогому,
# он же порядок отображения в UI.
IMAGE_QUALITIES: tuple[str, ...] = ("low", "medium", "high")

# Безопасный дефолт. Намеренно НЕ "high": случайно поднятое качество
# молча увеличивает стоимость каждой генерации.
_FALLBACK_QUALITY = "medium"


# Метаданные моделей. `id` обязан совпадать с идентификатором на OpenRouter.
#
# Проверять доступность модели нужно ТОЧЕЧНЫМ запросом
# `GET /api/v1/models/<id>/endpoints`, а не поиском по листингу
# `/api/v1/models`: листинг отдаёт не весь каталог. `seedream-4.5` в листинге
# отсутствует, но живёт (endpoint `bytedance-seed/seedream-4.5-20251203`,
# `output_modalities: ["image"]`, ~$0.0000096 за картинку — на порядок дешевле
# gemini-3-pro-image).
#
# `openai/gpt-5.4-image-2` — это и есть «GPT Image 2»: голого
# `openai/gpt-image-2` в каталоге не существует.
#
# `supports_quality` отражает реальный `supported_parameters` провайдера: у
# Seedream там только frequency_penalty / max_tokens / temperature / top_p,
# качества нет.
IMAGE_MODELS: dict[str, dict[str, Any]] = {
    "bytedance-seed/seedream-4.5": {
        "id": "bytedance-seed/seedream-4.5",
        "label": "Seedream 4.5",
        "provider": "ByteDance",
        "description": "Быстрая и недорогая генерация",
        "default": True,
        "supports_image_input": True,
        # Seedream — чисто image-модель, у неё нет параметра качества.
        "supports_quality": False,
    },
    "openai/gpt-5.4-image-2": {
        "id": "openai/gpt-5.4-image-2",
        "label": "GPT Image 2",
        "provider": "OpenAI",
        "description": "Более точная генерация сложных схем",
        "default": False,
        "supports_image_input": True,
        "supports_quality": True,
    },
}


class UnsupportedImageModel(ValueError):
    """Фронтенд прислал model ID, которого нет в allowlist."""


@dataclass(frozen=True)
class ImageGenOptions:
    """Разрешённый выбор пользователя, прошедший валидацию.

    Один объект вместо трёх параметров: `model`/`quality`/`aspect_ratio` нужно
    протащить через шесть функций (view → skill → enrich_board_steps →
    _enrich_command → build_vector_illustration → generate_raster_image), и
    три отдельных аргумента в каждой сигнатуре читаются заметно хуже.

    Создавать напрямую не нужно — только через `resolve_options`, иначе
    невалидированный model ID дойдёт до провайдера.
    """

    model: str
    quality: str | None
    aspect_ratio: str

    @property
    def meta(self) -> dict[str, str | None]:
        """Метаданные для A/B-сравнения и логов."""
        return {"image_model": self.model, "image_quality": self.quality}


def _allowed_ids() -> list[str]:
    """Модели, разрешённые в этой инсталляции.

    `IMAGE_GEN_ALLOWED_MODELS` реально сужает список: то, чего нет в реестре,
    молча игнорируется (иначе опечатка в env выдала бы наружу нерабочий id).
    """
    raw = getattr(settings, "IMAGE_GEN_ALLOWED_MODELS", "") or ""
    configured = [part.strip() for part in raw.split(",") if part.strip()]
    allowed = [model_id for model_id in configured if model_id in IMAGE_MODELS]
    # Пустой/битый env не должен обезоруживать API целиком — возвращаемся к
    # полному реестру, иначе доска перестанет рисовать вообще.
    return allowed or list(IMAGE_MODELS)


def default_model_id() -> str:
    """Модель по умолчанию, всегда входящая в allowlist."""
    allowed = _allowed_ids()
    for candidate in (
        getattr(settings, "IMAGE_GEN_DEFAULT_MODEL", "") or "",
        getattr(settings, "IMAGE_GEN_MODEL", "") or "",
    ):
        if candidate in allowed:
            return candidate
    # Затем — модель, помеченная default в реестре, затем первая разрешённая.
    for model_id in allowed:
        if IMAGE_MODELS[model_id].get("default"):
            return model_id
    return allowed[0]


def default_quality() -> str:
    quality = (getattr(settings, "IMAGE_GEN_QUALITY", "") or "").strip().lower()
    return quality if quality in IMAGE_QUALITIES else _FALLBACK_QUALITY


def default_aspect_ratio() -> str:
    return getattr(settings, "IMAGE_GEN_ASPECT_RATIO", "16:9") or "16:9"


def supports_quality(model_id: str) -> bool:
    return bool(IMAGE_MODELS.get(model_id, {}).get("supports_quality"))


def resolve_options(
    model: str | None = None,
    quality: str | None = None,
    aspect_ratio: str | None = None,
) -> ImageGenOptions:
    """Единственная точка, где выбор пользователя превращается в параметры запроса.

    Args:
        model:   model ID с фронтенда. Пустая строка / None → дефолт.
        quality: low/medium/high. Пустое, неизвестное или не поддерживаемое
                 моделью → безопасный fallback, БЕЗ ошибки: пользователь не
                 должен видеть 400 из-за того, что у Seedream нет качества.

    Raises:
        UnsupportedImageModel: model ID не пуст и не входит в allowlist.
                               Здесь молчать нельзя — иначе «выбрал GPT Image 2,
                               а нарисовало другой моделью» пройдёт незамеченным
                               и отравит A/B-сравнение.
    """
    requested = (model or "").strip()
    if not requested:
        resolved_model = default_model_id()
    elif requested in _allowed_ids():
        resolved_model = requested
    else:
        raise UnsupportedImageModel(requested)

    resolved_quality: str | None = None
    if supports_quality(resolved_model):
        requested_quality = (quality or "").strip().lower()
        resolved_quality = (
            requested_quality
            if requested_quality in IMAGE_QUALITIES
            else default_quality()
        )

    return ImageGenOptions(
        model=resolved_model,
        quality=resolved_quality,
        aspect_ratio=(aspect_ratio or "").strip() or default_aspect_ratio(),
    )


def list_models_payload() -> dict[str, Any]:
    """Тело ответа GET /api/ai/image-models/.

    Порядок стабильный и детерминированный: дефолтная модель первой, дальше —
    порядок allowlist. Фронтенд на него опирается, показывая первую модель до
    того, как прочитает localStorage.
    """
    default_id = default_model_id()
    ordered = [default_id] + [mid for mid in _allowed_ids() if mid != default_id]
    return {
        "models": [
            # `default` отражает РЕАЛЬНЫЙ выбранный дефолт этой инсталляции,
            # а не статический флаг реестра: иначе при смене
            # IMAGE_GEN_DEFAULT_MODEL бейдж «Текущая» повис бы на чужой модели.
            {**IMAGE_MODELS[model_id], "default": model_id == default_id}
            for model_id in ordered
        ],
        "default_model": default_id,
    }

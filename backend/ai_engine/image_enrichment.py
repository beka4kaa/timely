"""
image_enrichment.py
────────────────────────────────────────────────────────────────────
Сервис обогащения команд `image_with_labels` от Llama.

Точка вызова
────────────
    from ai_engine.image_enrichment import enrich_board_steps
    board_steps = enrich_board_steps(board_steps)

Поток данных
────────────
  Llama возвращает JSON-шаг:
    {
      "step_number": 2,
      "title": "Схема нейрона",
      "commands": [
        {
          "type": "image_with_labels",
          "image_prompt": "Scientific diagram of a neuron cell, no text labels",
          "labels": [{"content": "Аксон", "x": 60, "y": 30, "arrow_to": {"x": 65, "y": 45}}]
        }
      ]
    }

  enrich_board_steps() перехватывает этот шаг ДО отправки на фронтенд и для
  каждой `image_with_labels`-команды с полем `image_prompt` прогоняет её
  через ПОЛНЫЙ пайплайн (см. ai_engine.illustration_pipeline.build_vector_
  illustration): image_prompt → растр (Banana) → объекты (SAM2) → подписи
  (Qwen) → SVG с контурами. Команда взамен `image_prompt` получает:
    • `image_url` — растровый Data URL (РОВНО в том же формате, что и
      раньше отдавал _call_image_api напрямую — фронтенд использует его
      без каких-либо изменений, см. ai-chat.tsx: CREATE_IMAGE на доске);
    • `svg`       — собранный векторный SVG с контурами найденных объектов
      (доп. поле для более богатого отображения; отсутствует, если
      SAM2/Qwen-этапы не удались — деградация см. ниже);
    • `objects`   — список найденных объектов с подписями и координатами.

  Генерация самого растра (этап [1] пайплайна) идёт как и раньше —
  через _call_image_api/generate_raster_image (см. ниже); добавились лишь
  ПОСЛЕДУЮЩИЕ этапы (SAM2 → Qwen → SVG), которые ОБОГАЩАЮТ результат, не
  заменяя его — старое поведение фронтенда (показ image_url) не меняется
  ни при полном успехе, ни при частичном сбое (см. «Ошибки» ниже).

Поставщик изображений (этап [1] пайплайна)
───────────────────────────────────────────
  Используем OpenRouter (тот же ключ, что уже есть в проекте).
  Модель: google/gemini-3.1-flash-image-preview ("Nano Banana 2")
  Tier: standard (задаётся через HTTP-заголовок X-OR-Provider-Tier)
  Endpoint: https://openrouter.ai/api/v1/chat/completions
  Специфика: нужен параметр `modalities: ["image", "text"]`,
             ответ приходит в choices[0].message.content — список частей,
             среди которых ищем элемент с `type == "image_url"` (а также
             в message.images — см. _extract_image_url и его докстринг,
             почему проверка идёт именно в таком порядке).

Настройки в settings.py (заглушки, замените реальными)
──────────────────────────────────────────────────────
    IMAGE_GEN_API_URL  = "https://openrouter.ai/api/v1/chat/completions"
    IMAGE_GEN_API_KEY  = env("OPENROUTER_API_KEY")   # уже есть
    IMAGE_GEN_MODEL    = "google/gemini-3.1-flash-image-preview"
    IMAGE_GEN_TIMEOUT  = 60   # секунды
    IMAGE_GEN_TIER     = "standard"
  (через QWEN_*/SAM2_*/ILLUSTRATION_* настраиваются последующие этапы —
  см. их обоснование и комментарии прямо в settings.py)

Ошибки и деградация (см. _enrich_command)
──────────────────────────────────────────
  Двухуровневая деградация — ровно так, чтобы существующий показ на доске
  НИКОГДА не сломался из-за нового (более длинного и хрупкого) пайплайна:
    • Не получили даже растр (сбой этапа [1], как и раньше) → команда
      остаётся с оригинальным `image_prompt` и получает `image_error` —
      фронтенд обрабатывает это как и прежде (см. ai-chat.tsx: cmd.image_error
      превращается в текстовое сообщение об ошибке в чате).
    • Растр получен, но SAM2/Qwen/SVG-этапы (новые) не удались → команда
      ВСЁ РАВНО получает рабочий `image_url` (как раньше), просто без
      `svg`/`objects` — для фронтенда это неотличимо от старого поведения.
"""

from __future__ import annotations

import base64
import logging
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import requests
from django.conf import settings

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────
# Конфигурация провайдера (берётся из settings, с env-фоллбэком)
# ──────────────────────────────────────────────────────────────────

_API_URL: str = getattr(
    settings,
    "IMAGE_GEN_API_URL",
    "https://openrouter.ai/api/v1/chat/completions",
)
_API_KEY: str = getattr(
    settings,
    "IMAGE_GEN_API_KEY",
    os.getenv("OPENROUTER_API_KEY", ""),
)
_MODEL: str = getattr(
    settings,
    "IMAGE_GEN_MODEL",
    "google/gemini-3.1-flash-image-preview",
)
_TIMEOUT: int = int(getattr(settings, "IMAGE_GEN_TIMEOUT", 60))
_TIER: str = getattr(settings, "IMAGE_GEN_TIER", "standard")

# ──────────────────────────────────────────────────────────────────
# ЕДИНЫЙ визуальный стиль для ВСЕХ генераций
# ──────────────────────────────────────────────────────────────────
# Проблема, которую это решает: Llama сама придумывает `image_prompt`
# и при каждом запросе формулирует "стиль" по-своему ("3d render",
# "minimalist", "scientific diagram", "realistic photo" …) — из-за этого
# разные иллюстрации в одном уроке выглядят так, будто их рисовали
# разные художники в разной манере (как видно на скриншоте: одна
# картинка — глянцевый 3D-рендер, другая — плоская схема).
#
# Решение: стиль задаётся ЗДЕСЬ, ЦЕНТРАЛИЗОВАННО, ОДИН РАЗ, и жёстко
# приклеивается к каждому запросу — независимо от того, что написала
# Llama в `image_prompt`. Так все иллюстрации получаются в одной
# узнаваемой манере (как у Figure Labs / Stripe / Notion — мягкий,
# студийный 3D-рендер на светлом фоне), а Llama отвечает только за
# СОДЕРЖАНИЕ (что изображено), но не за "художественный почерк".
#
# Если нужно сменить стиль для всего приложения — меняйте ТОЛЬКО эту
# константу, и он применится ко всем последующим генерациям сразу.
IMAGE_STYLE_GUIDE: str = (
    "Visual style (apply exactly, regardless of subject): "
    "minimalist 3D studio render in the style of modern educational tech "
    "illustrations (think Stripe, Notion, Linear explainer graphics or Figure "
    "Labs textbook diagrams). "
    "Smooth matte plastic-like materials with subtle soft-body shading; "
    "simple rounded geometric primitives; soft, even studio lighting from the "
    "upper-left with gentle, soft-edged shadows; muted pastel color palette "
    "(soft blue, soft coral/pink, warm cream, light gray, sage green — pick "
    "2-3 harmonious accents per scene); plain flat off-white or very light "
    "neutral-gray background with no texture, gradient, horizon line, or "
    "scenery; calm three-quarter or isometric camera angle; generous empty "
    "space around the subject; crisp clean edges, no noise or grain. "
    "Strictly avoid: photorealistic textures, hand-drawn or sketch lines, "
    "cartoon/anime/comic style, technical blueprint/engineering-drawing look, "
    "dark or saturated backgrounds, clutter, text, numbers, captions, labels, "
    "logos, watermarks, or signatures of any kind."
)

# Максимальное число параллельных запросов к API генерации
_MAX_WORKERS: int = int(getattr(settings, "IMAGE_GEN_MAX_WORKERS", 3))


# ──────────────────────────────────────────────────────────────────
# Ядро: один запрос к провайдеру
# ──────────────────────────────────────────────────────────────────

def _call_image_api(prompt: str) -> str:
    """
    Отправляет запрос к OpenRouter (google/gemini-pro-image, standard tier).

    Returns:
        Data URL ("data:image/png;base64,...") или обычный https:// URL
        сгенерированного изображения.

    Raises:
        ValueError — при пустом/нераспознанном ответе.
        requests.HTTPError — при ответе 4xx/5xx.
        requests.Timeout — при превышении таймаута.
    """
    if not _API_KEY:
        raise ValueError(
            "IMAGE_GEN_API_KEY не задан. "
            "Добавьте OPENROUTER_API_KEY в переменные окружения."
        )

    headers = {
        "Authorization": f"Bearer {_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": getattr(settings, "SITE_URL", "https://timely.app"),
        "X-Title": "Timely AI Tutor Board",
    }

    # OpenRouter image generation: используем Chat Completions API
    # с параметром modalities для включения генерации изображений.
    payload: dict[str, Any] = {
        "model": _MODEL,
        "modalities": ["image", "text"],
        "messages": [
            {
                "role": "user",
                "content": (
                    f"Subject / content to depict: {prompt}. "
                    f"{IMAGE_STYLE_GUIDE}"
                ),
            }
        ]
    }

    logger.info(
        "[ImageGen] POST %s | model=%s | prompt=%.80s…",
        _API_URL,
        _MODEL,
        prompt,
    )

    resp = requests.post(
        _API_URL,
        json=payload,
        headers=headers,
        timeout=_TIMEOUT,
    )

    resp.raise_for_status()
    data = resp.json()

    return _extract_image_url(data, prompt)


def generate_raster_image(prompt: str) -> str:
    """
    Публичная обёртка над _call_image_api — генерирует растровое изображение
    через Banana (Nano Banana 2 / gemini-3.1-flash-image-preview) с применением
    единого визуального стиля (см. IMAGE_STYLE_GUIDE).

    Используется как шаг [1] в illustration_pipeline.build_vector_illustration
    (banana → SAM2 → Qwen → SVG), а также внутри _enrich_command выше.

    Returns:
        Data URL ("data:image/png;base64,...") или https:// URL изображения.

    Raises:
        Те же исключения, что и _call_image_api (ValueError, requests.HTTPError,
        requests.Timeout) — вызывающий код должен сам обрабатывать сбои.
    """
    return _call_image_api(prompt)


# Строгий алфавит base64 (без пробелов/переносов/пунктуации — то, чем
# обязательно отличается «сырой base64» от текстового описания на естественном
# языке). Порог длины (>500) дополнительно отсекает короткие фразы-совпадения.
_BASE64_RE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")


def _looks_like_base64_image(s: str) -> bool:
    """
    Отличает «сырую base64-строку» от текста.

    ВАЖНО: некоторые модели (эмпирически — gemini-3.1-flash-image-preview)
    одновременно кладут И текстовый комментарий в message.content (например,
    "Here is your minimalist 3D render, carefully designed in the clean,
    modern style…", вполне может быть длиной за 400 символов), И само
    изображение отдельно в message.images. Старая эвристика "длиннее 100
    символов → наверное это base64" в таком случае СЛОМАНА: она хватает
    текстовое описание раньше, чем код успевает заглянуть в images, и
    оборачивает обычный текст в "data:image/png;base64,<текст>" — что,
    конечно, не декодируется. Естественный текст почти всегда содержит
    пробелы и пунктуацию — а это мгновенно проваливает строгую проверку
    алфавита base64, тогда как реальные изображения дают строки в десятки
    тысяч символов из чистого base64-алфавита. Этого достаточно, чтобы
    надёжно различить два случая.
    """
    return len(s) > 500 and bool(_BASE64_RE.match(s))


def _url_from_images_field(message: dict) -> str:
    """Извлекает URL изображения из нестандартного поля message.images, если есть."""
    images = message.get("images") or []
    if not images:
        return ""

    first = images[0]
    if isinstance(first, dict):
        url = first.get("url", "")
        # OpenAI/OpenRouter style: {'type': 'image_url', 'image_url': {'url': '...'}}
        if not url and isinstance(first.get("image_url"), dict):
            url = first["image_url"].get("url", "")
        return url

    if isinstance(first, str):
        if first.startswith("http") or first.startswith("data:"):
            return first
        if _looks_like_base64_image(first):
            return f"data:image/png;base64,{first}"

    return ""


def _extract_image_url(data: dict, prompt: str) -> str:
    """
    Разбирает ответ OpenRouter и возвращает URL или Data URL изображения.

    OpenRouter (точнее, разные модели за ним) кладёт изображение в одно из:

    Формат C — отдельное поле images (нестандартное расширение káждой
        модели для image-generation; ПРОВЕРЯЕМ ПЕРВЫМ — см. почему в
        docstring _looks_like_base64_image):
        choices[0].message.images = [{"url": "data:image/...;base64,…"}]

    Формат A — content как список частей (multimodal):
        choices[0].message.content = [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,…"}},
            {"type": "text", "text": "…"},
        ]

    Формат B — content как строка (редко; либо сырой base64, либо —
        внимание — текстовый комментарий модели о картинке, которая
        на самом деле приехала через images, см. Формат C):
        choices[0].message.content = "data:image/png;base64,…"
    """
    try:
        choice = data["choices"][0]
    except (KeyError, IndexError):
        raise ValueError(f"Неожиданная структура ответа API: {list(data.keys())}")

    message = choice.get("message", {})

    # ── Формат C проверяем ПЕРВЫМ: это самый однозначный сигнал. ──
    # Если проверять message.content раньше, можно поймать его текстовый
    # комментарий-описание раньше, чем дойдём до настоящей картинки здесь
    # (см. подробное объяснение в _looks_like_base64_image — это не
    # гипотетический, а воспроизведённый на практике баг).
    url_from_images = _url_from_images_field(message)
    if url_from_images:
        return url_from_images

    content = message.get("content")

    # ── Формат A: content — список частей ──
    if isinstance(content, list):
        for part in content:
            if not isinstance(part, dict):
                continue
            ptype = part.get("type")

            if ptype == "image_url":
                url = (part.get("image_url") or {}).get("url", "")
                if url:
                    return url

            # Иногда провайдеры кладут сырой base64 без обёртки
            if ptype == "image" and part.get("data"):
                b64 = part["data"]
                mime = part.get("mime_type", "image/png")
                return f"data:{mime};base64,{b64}"

        raise ValueError("В ответе API не найдено image_url среди частей content")

    # ── Формат B: content — строка ──
    if isinstance(content, str):
        stripped = content.strip()
        if stripped.startswith("data:") or stripped.startswith("http"):
            return stripped
        # Может быть чистый base64 без обёртки — но ТОЛЬКО если это
        # действительно похоже на base64, а не текстовый комментарий
        # модели о картинке (см. _looks_like_base64_image)
        if _looks_like_base64_image(stripped):
            return f"data:image/png;base64,{stripped}"

    logger.error(f"[ImageGen] OpenRouter did not return an image. keys={list(message.keys())}")
    raise ValueError(
        "Провайдер OpenRouter не вернул изображение для этого запроса. "
        "Это может быть связано со сбоем на их стороне или фильтрами безопасности. "
        "Попробуйте нажать кнопку ещё раз или чуть-чуть изменить текст."
    )


# ──────────────────────────────────────────────────────────────────
# Обогащение одной команды
# ──────────────────────────────────────────────────────────────────

def _enrich_command(cmd: dict, topic_hint: str = "") -> dict:
    """
    Принимает команду `image_with_labels` с полем `image_prompt`, прогоняет
    её через ПОЛНЫЙ пайплайн build_vector_illustration() (Banana → SAM2 →
    Qwen → SVG, см. ai_engine.illustration_pipeline) и возвращает копию
    команды с `image_url` вместо `image_prompt` — РОВНО как раньше делал
    прямой вызов провайдера, так что показ на доске (CREATE_IMAGE в
    ai-chat.tsx) не меняется НИ НА ЙОТУ. Дополнительно, когда сегментация
    и подписи удаются, добавляются поля `svg` (готовый векторный SVG с
    контурами найденных объектов) и `objects` (их подписи/координаты) —
    старые потребители их просто не заметят (аддитивное расширение).

    Деградация (см. докстринг build_vector_illustration — она НИКОГДА не
    бросает исключения наружу, а возвращает словарь с пометкой проблемы):
      • растр получен, но SAM2/Qwen/SVG не удались → всё равно отдаём
        рабочий `image_url`, как и раньше, просто без `svg`/`objects`
        (для доски и фронтенда — неотличимо от старого поведения);
      • растр не получен совсем → как и раньше, `image_prompt` + `image_error`
        (фронтенд превращает это в текст-ошибку, см. ai-chat.tsx:172-179).

    Args:
        topic_hint: тема урока/задачи на русском (обычно board["topic"]) —
                    передаётся в Qwen для более осмысленных подписей объектов.

    При любой иной (неожиданной) ошибке возвращает исходную команду +
    `image_error` с описанием — фоллбэк идентичен прежнему поведению.
    """
    prompt: str = cmd.get("image_prompt", "").strip()
    if not prompt:
        # Нет промпта — ничего не делаем (может быть уже обогащена)
        return cmd

    enriched = {k: v for k, v in cmd.items() if k != "image_prompt"}

    try:
        # Отложенный импорт: illustration_pipeline импортирует
        # generate_raster_image ИЗ ЭТОГО модуля на верхнем уровне, поэтому
        # прямой импорт build_vector_illustration здесь (на верхнем уровне)
        # создал бы цикл. Откладываем до вызова — к этому моменту оба модуля
        # уже полностью загружены (тот же приём см. enrich_board_steps:
        # `import copy` внутри функции).
        from .illustration_pipeline import build_vector_illustration

        result = build_vector_illustration(prompt, topic_hint)
        image_url = result.get("image_url")

        if image_url:
            # Успех (полный или частичный) — отдаём доске рабочую картинку
            # ровно как и раньше; новые поля — чистое дополнение.
            enriched["image_url"] = image_url
            if result.get("svg"):
                enriched["svg"] = result["svg"]
            if result.get("objects"):
                enriched["objects"] = result["objects"]

            pipeline_error = result.get("pipeline_error")
            if pipeline_error:
                logger.warning(
                    "[ImageGen] ✓ Растр получен (len=%d), но пайплайн частично не удался "
                    "(показываем растр без векторизации): %s",
                    len(image_url), pipeline_error,
                )
            else:
                logger.info(
                    "[ImageGen] ✓ Полный пайплайн успешен (изображение=%d байт, "
                    "объектов=%d, svg=%s)",
                    len(image_url),
                    len(result.get("objects") or []),
                    "есть" if result.get("svg") else "нет",
                )
        else:
            # Не получили даже растр — фоллбэк ИДЕНТИЧЕН старому поведению
            # (см. ai-chat.tsx: image_error → текстовое сообщение в чате).
            msg = result.get("pipeline_error") or "Провайдер не вернул изображение"
            logger.error("[ImageGen] ERROR: %s", msg)
            enriched["image_prompt"] = prompt
            enriched["image_error"] = {
                "code": "GENERATION_FAILED",
                "message": str(msg)[:200],
            }

    except Exception as exc:  # noqa: BLE001
        # build_vector_illustration сама не бросает исключений — сюда можно
        # попасть лишь при совсем неожиданной проблеме (напр. сбой импорта).
        # Фоллбэк — тот же контракт, что и раньше.
        msg = f"Ошибка генерации: {exc}"
        logger.error("[ImageGen] ERROR: %s", msg, exc_info=True)
        enriched["image_prompt"] = prompt
        enriched["image_error"] = {
            "code": "GENERATION_FAILED",
            "message": str(exc)[:200],
        }

    return enriched


# ──────────────────────────────────────────────────────────────────
# Публичный интерфейс
# ──────────────────────────────────────────────────────────────────

def enrich_board_steps(board_steps: list[dict], topic_hint: str = "") -> list[dict]:
    """
    Перехватывает `board_steps` от Llama и обогащает все команды типа
    `image_with_labels`, у которых есть поле `image_prompt`, — прогоняя
    каждую через полный пайплайн build_vector_illustration() (Banana → SAM2
    → Qwen → SVG; см. _enrich_command и ai_engine.illustration_pipeline).

    Запросы выполняются параллельно (ThreadPoolExecutor), что минимизирует
    суммарное время ожидания при нескольких иллюстрациях в одном ответе.

    Args:
        board_steps: оригинальный список шагов от модели.
        topic_hint:  тема урока/задачи на русском (обычно — `board["topic"]`,
                     см. вызов в draw_views.py: WhiteboardDrawView.post).
                     Прокидывается в Qwen для более осмысленных подписей
                     найденных объектов на иллюстрациях. Необязательный —
                     по умолчанию "" (пайплайн работает и без него).

    Returns:
        Тот же список, но команды с `image_prompt` заменены на команды
        с `image_url` (+ опционально `svg`/`objects` при удачной
        сегментации), либо с `image_error` при полном сбое генерации —
        контракт для фронтенда полностью сохранён (см. ai-chat.tsx).
    """
    if not isinstance(board_steps, list) or not board_steps:
        return board_steps

    # ── 1. Собираем команды, требующие обогащения ──
    # Структура: [(step_idx, cmd_idx, cmd_dict), ...]
    tasks: list[tuple[int, int, dict]] = []

    for si, step in enumerate(board_steps):
        if not isinstance(step, dict):
            continue
        for ci, cmd in enumerate(step.get("commands", [])):
            if (
                isinstance(cmd, dict)
                and cmd.get("type") == "image_with_labels"
                and cmd.get("image_prompt")
            ):
                tasks.append((si, ci, cmd))

    if not tasks:
        logger.debug("[ImageGen] Нет команд image_with_labels для обогащения")
        return board_steps

    logger.info(
        "[ImageGen] Обогащение %d команд image_with_labels (workers=%d)",
        len(tasks),
        _MAX_WORKERS,
    )

    # ── 2. Глубокое копирование board_steps (не мутируем оригинал) ──
    import copy
    result = copy.deepcopy(board_steps)

    # ── 3. Параллельные запросы к провайдеру ──
    future_to_position: dict = {}

    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        for si, ci, cmd in tasks:
            future = pool.submit(_enrich_command, cmd, topic_hint)
            future_to_position[future] = (si, ci)

        for future in as_completed(future_to_position):
            si, ci = future_to_position[future]
            try:
                enriched_cmd = future.result()
            except Exception as exc:  # noqa: BLE001
                # Крайне маловероятно (все исключения перехватываются внутри
                # _enrich_command), но на всякий случай
                logger.error(
                    "[ImageGen] Uncaught exception in worker: %s", exc, exc_info=True
                )
                enriched_cmd = result[si]["commands"][ci]  # оставляем как есть

            result[si]["commands"][ci] = enriched_cmd
            logger.debug(
                "[ImageGen] step[%d].commands[%d] → %s",
                si,
                ci,
                "✓ image_url" if "image_url" in enriched_cmd else "✗ error",
            )

    logger.info("[ImageGen] Обогащение завершено.")
    return result

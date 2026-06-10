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
  через пайплайн (см. ai_engine.illustration_pipeline.build_vector_
  illustration). Команда приводится к СТРОГОМУ контракту для фронтенда:
    • `base_image_url` — оригинальный растровый Data URL от Banana.
      ВСЕГДА заполнен при успехе, независимо от того, вызывался SAM2 или
      нет. Это основа ответа — картинка НЕ теряется (см. ai-chat.tsx:
      CREATE_IMAGE на доске);
    • `labels`         — подписи от Llama как есть (content + x/y в %);
    • `masks`          — опц. список полигонов SAM2
      [{label, polygon:[[x%,y%]], bbox_pct, color}] — заполняется ТОЛЬКО
      если Llama выставила requires_segmentation=true И SAM2 нашёл объекты.
      Иначе None (сцены/пейзажи показываются чистой картинкой + подписи).

  Поле `image_prompt` из команды убирается (оно отработало). При полном
  сбое генерации растра — `image_prompt` остаётся + добавляется
  `image_error` (фронтенд показывает текст-ошибку).

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
  Двухуровневая деградация — показ на доске НИКОГДА не ломается:
    • Не получили даже растр (сбой этапа [1]) → команда остаётся с
      `image_prompt` и получает `image_error` — фронтенд показывает
      текст-ошибку (см. ai-chat.tsx: cmd.image_error → сообщение в чате).
    • Растр получен, но SAM2 (опц.) не удался → команда ВСЁ РАВНО
      получает рабочий `base_image_url`, просто `masks=None` — для
      фронтенда это чистая картинка + подписи.
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
# STYLE_PRESETS — суффикс художественного стиля по ключу (совпадают с
# пресетами в UI: Flat / 2.5D / 3D / Sketch). Llama описывает СОДЕРЖАНИЕ,
# а нужный «почерк» жёстко приклеивается отсюда. Чтобы поменять вид всех
# иллюстраций конкретного стиля — правьте суффикс ПРЯМО ЗДЕСЬ.
#
# ВАЖНО про композицию: раньше стиль требовал «generous empty space / plain
# background / three-quarter angle» — это и давало центрированную «игрушку»
# вместо плаката. Новый 3D-суффикс требует широкоугольный кадр во весь формат
# (full frame, wide-angle landscape) — это убирает пустые поля и даёт вид
# учебного постера.
# Ключи СОВПАДАЮТ с id пресетов на фронтенде (src/config/
# imageGenerationConstants.ts → STYLE_PRESETS[].id): flat / 2_5d / 3d / sketch.
# Поэтому `style`, который шлёт фронт, мапится сюда напрямую (см. _resolve_style_suffix).
#
# Каждый пресет теперь = {"positive", "negative"}:
#   • positive — художественный «почерк» (приклеивается к телу промпта);
#   • negative — что для ЭТОГО стиля недопустимо (уходит в хвост, в DO-NOT-блок,
#     дополнительно к глобальному NEGATIVE_PROMPT через _build_final_prompt).
#
# Композиция теперь задаётся ГЛОБАЛЬНО через GLOBAL_PROMPT_PREFIX (центрированная
# схема на чистом белом фоне с полями). Поэтому ИЗ ВСЕХ стилей убран прежний
# «wide-angle / full frame composition» — именно он давал full-bleed, из-за
# которого подписи сливались с фоном. Все 4 стиля теперь = изолированные объекты
# на белом фоне; различается только художественный «почерк».
STYLE_PRESETS: dict[str, dict[str, str]] = {
    "flat": {
        "positive": (
            "Strictly 2D flat vector graphic, SVG style, pure solid colors ONLY, "
            "black outlines, coloring book style, absolute minimalism. "
            "Strictly rectangular layout, horizontal cross-section, landscape format."
        ),
        "negative": (
            "gradients, 3D, shadows, shading, realism, depth, bevel, lighting, "
            "texture, background scenery, "
            "circular shape, badge, icon, emblem, rounded edges, sphere."
        ),
    },
    "2_5d": {
        "positive": (
            "Detailed isometric 2.5D diagram, orthographic projection, rich soft "
            "shading, smooth glossy plastic materials, clear depth and volume, "
            "intricate well-modeled detail, polished educational 3D-vector render, "
            "pure white background."
        ),
        # NB: «complex textures» УБРАН из negative — он обеднял картинку. Оставляем
        # только то, что отличает 2.5D от flat/фото и держит изометрию.
        "negative": "2D flat, black outlines, realistic photo.",
    },
    "3d": {
        # Перспектива/глубина, чтобы СЛОМАТЬ изометрию (главная жалоба: 3D был
        # неотличим от изометрического 2.5D). NB: намеренно ОПУЩЕНЫ «horizon line»
        # и «cinematic immersive landscape» — они конфликтуют с белым фоном из
        # GLOBAL_PROMPT_PREFIX и вернули бы слияние подписей с фоном (см. решение).
        "positive": (
            "Highly detailed, polished 3D educational render, rich realistic "
            "materials and textures, soft studio lighting, gentle soft shadows, "
            "fine surface detail, isolated central objects on a pure white "
            "background, strictly educational style. "
            "Perspective camera, three-quarter perspective view, deep depth of "
            "field, non-isometric."
        ),
        # «white borders» НЕ добавляем — он бьёт по «ample white space margins»
        # из префикса. Остальной анти-изометрический список — как заказано.
        "negative": (
            "flat 2D, hard black outlines, full-frame background scenery, busy "
            "environment, photographic clutter, "
            "isometric, orthographic, cutaway box, diorama block, floating island."
        ),
    },
    "sketch": {
        "positive": (
            "Detailed hand-drawn technical illustration, intricate fine pencil-"
            "and-ink line work, careful cross-hatching and stippling for shading "
            "and depth, rich linework detail, precise strokes, isolated central "
            "diagram on a pure white background, strictly educational style."
        ),
        # NB: «soft shading» УБРАН — он мешал штриховке/hatching, которая и даёт
        # детализацию в скетче. Оставляем запрет цвета/градиентов/фото.
        "negative": (
            "color fills, gradients, full background scenery, watercolor, "
            "photorealism."
        ),
    },
}

# Палитры — ключи совпадают с id на фронтенде (COLOR_PALETTES[].id), включая
# дефисы: _resolve_palette_suffix делает только .lower(), дефисы не трогает.
# Суффиксы ДОЛЖНЫ дословно совпадать с prompt_suffix во фронтовом
# src/config/imageGenerationConstants.ts (фронт шлёт только id, реальный суффикс
# берётся отсюда — это и есть источник правды для генерации).
COLOR_PALETTES: dict[str, str] = {
    # Естественные / географические (natural-earth — палитра по умолчанию)
    "natural-earth": "strictly using natural realistic colors: clear water blue, nature green, earth brown, white clouds, realistic geographical tones",
    "oceanic-clean": "strictly using color palette: deep ocean blue, sky blue, pure white, cool grey",
    "monochrome-ink": "strictly using color palette: pure black, dark slate, light grey, pure white, no bright colors",
    # Медицинские / биотех (legacy)
    "he_inspired": "strictly using color palette: deep reds, warm beige, gray, soft pink",
    "warm_biotech": "strictly using color palette: cyan, deep blue, light gray, dark slate",
    "in_vitro_violet": "strictly using color palette: deep violet, muted beige, light mauve, dark green",
}

# Стиль по умолчанию (если фронт ничего не прислал или прислал неизвестный id).
DEFAULT_STYLE: str = getattr(settings, "IMAGE_GEN_DEFAULT_STYLE", "3d")

# Единый стиль-суффикс по умолчанию (POSITIVE). Имя сохранено для обратной
# совместимости (на него ссылаются docstring'и/пайплайн); конкретный запрос
# выбирает positive-суффикс по присланному `style` через _resolve_style_suffix.
IMAGE_STYLE_GUIDE: str = STYLE_PRESETS.get(DEFAULT_STYLE, STYLE_PRESETS["3d"])["positive"]

# Соотношение сторон генерируемой картинки. Жёстко 16:9 (landscape) — учебные
# иллюстрации должны быть альбомными плакатами, а не квадратными «игрушками».
IMAGE_ASPECT_RATIO: str = getattr(settings, "IMAGE_GEN_ASPECT_RATIO", "16:9")

# ──────────────────────────────────────────────────────────────────
# ГЛОБАЛЬНЫЙ префикс — применяется к ЛЮБОМУ запросу (t2i и i2i-edit)
# ──────────────────────────────────────────────────────────────────
# Две жёсткие гарантии, применяемые ВСЕГДА:
#   (1) композиция: ДЕТАЛИЗИРОВАННАЯ центральная иллюстрация на чистом белом фоне,
#       с полями вокруг (isolated figure, НЕ edge-to-edge) — поля нужны, чтобы
#       подписи overlay-слоя не сливались с картинкой;
#   (2) НИКАКОГО baked-in текста: всю типографику (подписи/формулы) рендерит
#       отдельный слой на фронтенде (IllustrationRenderer/ScientificIllustration),
#       поэтому в самой картинке не должно быть ни одного сгенерированного символа.
# ВАЖНО про КАЧЕСТВО: префикс НЕ должен упрощать саму иллюстрацию. Раньше тут было
# «DO NOT fill the entire frame with background scenery» + «ample empty margins» —
# это обедняло картинки (модель делала разреженные пустые схемы). Теперь явно
# требуем rich/detailed/high-quality центральный объект, а ограничиваем только
# КОМПОЗИЦИЮ (не full-bleed, светлые поля по краям), но не детализацию.
# Приклеивается в НАЧАЛО финального промпта (см. _build_final_prompt).
GLOBAL_PROMPT_PREFIX: str = (
    # Запрет текста — ПЕРВЫМ и эмфатично: у image-моделей сильный приор печатать
    # подписи на «диаграммах/educational», и слабый negative в хвосте его не
    # перебивает. Ведём с жёсткого «text-free», иначе модель впечатывает (к тому
    # же английские) подписи, и они сталкиваются с нашим overlay-слоем.
    "A COMPLETELY TEXT-FREE, UNLABELED illustration. There must be absolutely NO "
    "writing of any kind anywhere in the image: no words, no letters, no numbers, "
    "no captions, no titles, no annotations, no callouts, no legends, no UI. Show "
    "ONLY the visual objects themselves, never their names. "
    # Композиция/качество — после запрета текста.
    "It is a richly detailed, high-quality, polished scientific illustration, "
    "centered as an isolated figure on a clean solid white background, with "
    "comfortable white margins (it must NOT run edge-to-edge). "
)

# ──────────────────────────────────────────────────────────────────
# ГЛОБАЛЬНЫЙ negative prompt — применяется ВСЕГДА, при ЛЮБОМ стиле
# ──────────────────────────────────────────────────────────────────
# Проблема: Gemini иногда превращает стрелки направления в органические «вены»/
# щупальца и подмешивает анатомические/«мясные» текстуры (особенно в Sketch).
# Решение: жёсткий блок запретов, который приклеивается в КОНЕЦ финального промпта
# в обеих ветках _call_image_api (text-to-image и image-to-image edit), независимо
# от style/palette. У Gemini нет отдельного параметра negative_prompt, поэтому
# запреты выражаются текстом «DO NOT INCLUDE …» прямо в промпте.
NEGATIVE_PROMPT: str = (
    "DO NOT INCLUDE: anatomical textures, veins, flesh, blood, organic tentacles, "
    "messy lines, gore, medical anomalies. Arrows must be strict geometric vector "
    "arrows, not organic shapes."
)


def _normalize_style_key(style: str | None) -> str:
    """'2.5D'/'2-5d' → '2_5d', регистр; при неизвестном — DEFAULT_STYLE."""
    key = (style or DEFAULT_STYLE).strip().lower().replace(".", "_").replace("-", "_")
    return key if key in STYLE_PRESETS else DEFAULT_STYLE


def _resolve_style_suffix(style: str | None) -> str:
    """id стиля с фронтенда → POSITIVE-суффикс из STYLE_PRESETS."""
    return STYLE_PRESETS[_normalize_style_key(style)]["positive"]


def _resolve_style_negative(style: str | None) -> str:
    """id стиля → NEGATIVE-суффикс из STYLE_PRESETS (пусто, если у стиля его нет)."""
    return STYLE_PRESETS[_normalize_style_key(style)].get("negative", "")


def _resolve_palette_suffix(palette: str | None) -> str:
    """id палитры с фронтенда → суффикс из COLOR_PALETTES (пусто, если не задана/неизвестна)."""
    if not palette:
        return ""
    return COLOR_PALETTES.get(palette.strip().lower(), "")


def _build_final_prompt(core: str, style: str | None, palette: str | None) -> str:
    """
    Единая точка сборки ИТОГОВОЙ текстовой строки запроса к генератору
    (то, что в задачах называют buildFinalPrompt; фактически сборка всегда была
    здесь, на бэкенде, — фронт шлёт лишь id стиля/палитры).

    Порядок склейки фиксирован:
      [GLOBAL_PROMPT_PREFIX]  — центрированная схема на белом фоне, ВСЕГДА;
      [core]                  — единственная часть, различная для t2i/i2i-edit;
      [aspect ratio]
      [positive стиля]        — _resolve_style_suffix;
      [палитра]               — опц., _resolve_palette_suffix;
      [NEGATIVE_PROMPT]       — глобальные запреты, ВСЕГДА;
      [negative стиля]        — опц., _resolve_style_negative (Flat/2.5D и т.д.).
    """
    style_pos = _resolve_style_suffix(style)
    palette_suffix = _resolve_palette_suffix(palette)
    style_neg = _resolve_style_negative(style)

    text = (
        f"{GLOBAL_PROMPT_PREFIX}{core} "
        f"Image aspect ratio: {IMAGE_ASPECT_RATIO} (landscape orientation). "
        f"{style_pos}"
    )
    if palette_suffix:
        text += f" {palette_suffix}"
    text += f" {NEGATIVE_PROMPT}"
    if style_neg:
        text += f" Avoid for this style: {style_neg}"
    return text


# Максимальное число параллельных запросов к API генерации
_MAX_WORKERS: int = int(getattr(settings, "IMAGE_GEN_MAX_WORKERS", 3))


# ──────────────────────────────────────────────────────────────────
# Ядро: один запрос к провайдеру
# ──────────────────────────────────────────────────────────────────

def _call_image_api(
    prompt: str,
    style: str | None = None,
    palette: str | None = None,
    reference_image_url: str | None = None,
) -> str:
    """
    Отправляет запрос к OpenRouter (google/gemini-pro-image, standard tier).

    Args:
        prompt:              СОДЕРЖАНИЕ картинки (что изобразить).
        style:               id стиля с фронтенда (flat/2_5d/3d/sketch) → STYLE_PRESETS.
        palette:             id палитры с фронтенда (he_inspired/…) → COLOR_PALETTES.
        reference_image_url: URL или Data URL существующей картинки на доске.
                             Когда задан, запрос идёт в режиме image-to-image:
                             картинка передаётся как НАСТОЯЩИЙ image-input в
                             мультимодальном content. Gemini/Nano Banana — это
                             редактирующая модель, она кондиционирует генерацию на
                             пикселях референса и сохраняет композицию НАТИВНО
                             (механизмом редактирования, а не «уговорами в тексте»).

    ВАЖНО про «силу» редактирования: у Gemini/Nano Banana НЕТ числового
    denoising_strength / image_strength — это не Stable Diffusion и не Recraft
    (только у Recraft на OpenRouter есть image_config.strength). Поэтому баланс
    «сохранить геометрию / сменить стиль» задаётся ЧЕСТНОЙ инструкцией в промпте
    («keep the same composition, change only the style»), а не псевдо-числом.

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

    # ── Выбор режима: image-to-image (edit) vs text-to-image (чистая генерация) ──
    # Итоговую строку в ОБЕИХ ветках собирает _build_final_prompt: глобальный
    # белофоновый префикс + core + аспект + positive стиля + палитра + negative.
    if reference_image_url:
        # Режим смены стиля = НАТИВНОЕ редактирование. Референс передаётся как
        # настоящий image-input (первый элемент мультимодального content) — Gemini
        # видит реальные пиксели и сохраняет композицию своим edit-механизмом.
        core = (
            "Re-render the provided image in a new artistic style while keeping "
            f"the SAME composition. Subject / content: {prompt}. "
            "Keep every object in the same position, with the same relative size "
            "and the same overall layout as the provided image — change ONLY the "
            "rendering style, do NOT move, add or remove any OBJECT structurally. "
            # Текст — исключение из «ничего не убирай»: его, наоборот, ВЫЧИЩАЕМ,
            # иначе restyle тащит впечатанные подписи референса (они столкнутся
            # с нашим overlay-слоем). Подписи добавляются отдельным слоем.
            "EXCEPTION: remove every piece of text, lettering, label or caption "
            "that appears in the provided image — the output must be completely "
            "text-free."
        )
        text_part = _build_final_prompt(core, style, palette)
        message_content: Any = [
            {"type": "image_url", "image_url": {"url": reference_image_url}},
            {"type": "text", "text": text_part},
        ]
        logger.info(
            "[ImageGen] POST %s | model=%s | style=%s | palette=%s | mode=edit(i2i) | prompt=%.70s…",
            _API_URL, _MODEL, (style or DEFAULT_STYLE), (palette or "—"), prompt,
        )
    else:
        # Режим чистой генерации: только текстовый промпт.
        core = f"Subject / content to depict: {prompt}."
        message_content = _build_final_prompt(core, style, palette)
        logger.info(
            "[ImageGen] POST %s | model=%s | style=%s | palette=%s | mode=t2i | prompt=%.70s…",
            _API_URL, _MODEL, (style or DEFAULT_STYLE), (palette or "—"), prompt,
        )

    payload: dict[str, Any] = {
        "model": _MODEL,
        "modalities": ["image", "text"],
        "aspect_ratio": IMAGE_ASPECT_RATIO,
        "image_config": {"aspect_ratio": IMAGE_ASPECT_RATIO},
        "messages": [{"role": "user", "content": message_content}],
    }

    resp = requests.post(
        _API_URL,
        json=payload,
        headers=headers,
        timeout=_TIMEOUT,
    )

    resp.raise_for_status()
    data = resp.json()

    return _extract_image_url(data, prompt)


def generate_raster_image(
    prompt: str,
    style: str | None = None,
    palette: str | None = None,
    reference_image_url: str | None = None,
) -> str:
    """
    Публичная обёртка над _call_image_api — генерирует растровое изображение
    через Banana (Nano Banana 2 / gemini-3.1-flash-image-preview) с применением
    стиля/палитры, выбранных на фронтенде (см. STYLE_PRESETS / COLOR_PALETTES).

    Args:
        prompt:              содержание картинки.
        style:               id стиля с фронтенда (flat/2_5d/3d/sketch).
        palette:             id палитры с фронтенда (he_inspired/…).
        reference_image_url: URL / Data URL существующей картинки — при смене стиля.
                             Когда задан, Gemini редактирует её нативно (image-to-image),
                             сохраняя композицию (см. _call_image_api).

    Используется как шаг [1] в illustration_pipeline.build_vector_illustration
    (banana → base_image_url, далее опц. SAM2), а также в _enrich_command.

    Returns:
        Data URL ("data:image/png;base64,...") или https:// URL изображения.

    Raises:
        Те же исключения, что и _call_image_api (ValueError, requests.HTTPError,
        requests.Timeout) — вызывающий код должен сам обрабатывать сбои.
    """
    return _call_image_api(
        prompt,
        style=style,
        palette=palette,
        reference_image_url=reference_image_url,
    )


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

def _enrich_command(
    cmd: dict,
    topic_hint: str = "",
    style: str | None = None,
    palette: str | None = None,
    reference_image_url: str | None = None,
) -> dict:
    """
    Принимает команду `image_with_labels` с полем `image_prompt`, прогоняет
    её через build_vector_illustration() и возвращает команду в СТРОГОМ
    контракте для фронтенда: {type, base_image_url, labels, masks}.

      • base_image_url — ВСЕГДА оригинальная картинка от Banana при успехе;
      • labels         — подписи Llama как есть (content + x/y в %);
      • masks          — полигоны SAM2 (list) если requires_segmentation=true
                         и сегментация удалась, иначе None.

    Решение о сегментации принимает Llama через флаг `requires_segmentation`
    в команде (для сцен/пейзажей — false, SAM2 не вызывается вообще).

    Деградация (build_vector_illustration НИКОГДА не бросает исключения):
      • растр получен, но SAM2 не удался → отдаём base_image_url, masks=None;
      • растр не получен совсем → `image_prompt` + `image_error`
        (фронтенд превращает это в текст-ошибку, см. ai-chat.tsx).

    Args:
        topic_hint: тема урока/задачи на русском (обычно board["topic"]).
        style:      id стиля с фронтенда (flat/2_5d/3d/sketch).
        palette:    id палитры с фронтенда (he_inspired/…).

    При любой иной (неожиданной) ошибке возвращает команду +
    `image_error` с описанием.
    """
    prompt: str = cmd.get("image_prompt", "").strip()
    if not prompt:
        # Нет промпта — ничего не делаем (может быть уже обогащена)
        return cmd

    # Подписи от Llama: содержат и текст (`content`), и координаты объектов
    # (`x`/`y`, `arrow_to`) в процентах — они же seed points для SAM2.
    seed_labels: list[dict] = cmd.get("labels") or []

    # Решение о сегментации принимает Llama (`requires_segmentation`).
    # Для сцен/пейзажей/процессов («круговорот воды») — false: SAM2 не нужен,
    # достаточно чистой картинки + подписей. Для выделения отдельных объектов
    # (органеллы, детали) — true.
    requires_segmentation: bool = bool(cmd.get("requires_segmentation", False))

    # Базовая команда для фронтенда (строгий контракт):
    #   {type, base_image_url, labels, masks}
    # `image_prompt` убираем (он отработал), служебные поля не тащим.
    enriched: dict = {"type": "image_with_labels", "labels": seed_labels}
    if isinstance(cmd.get("alt"), str) and cmd["alt"].strip():
        enriched["alt"] = cmd["alt"].strip()

    try:
        # Отложенный импорт: illustration_pipeline импортирует
        # generate_raster_image ИЗ ЭТОГО модуля на верхнем уровне, поэтому
        # прямой импорт build_vector_illustration здесь (на верхнем уровне)
        # создал бы цикл. Откладываем до вызова — к этому моменту оба модуля
        # уже полностью загружены (тот же приём см. enrich_board_steps:
        # `import copy` внутри функции).
        from .illustration_pipeline import build_vector_illustration

        result = build_vector_illustration(
            prompt,
            topic_hint,
            seed_labels=seed_labels or None,
            requires_segmentation=requires_segmentation,
            style=style,
            palette=palette,
            reference_image_url=reference_image_url,
        )
        base_image_url = result.get("base_image_url")

        if base_image_url:
            # Успех. base_image_url — ВСЕГДА оригинальная картинка от Banana,
            # независимо от того, вызывался SAM2 или нет. masks — опционально.
            enriched["base_image_url"] = base_image_url
            enriched["masks"] = result.get("masks")  # list | None
            # Подписи: если пайплайн вернул ГРУНТНУТЫЕ по картинке координаты —
            # отдаём их (точнее, чем догадка Llama). Иначе оставляем исходные.
            grounded_labels = result.get("labels")
            if grounded_labels is not None:
                enriched["labels"] = grounded_labels

            pipeline_error = result.get("pipeline_error")
            if pipeline_error:
                logger.warning(
                    "[ImageGen] ✓ base_image_url получен (len=%d), но сегментация частично "
                    "не удалась (показываем картинку без масок): %s",
                    len(base_image_url), pipeline_error,
                )
            else:
                logger.info(
                    "[ImageGen] ✓ Успех (картинка=%d байт, сегментация=%s, масок=%d)",
                    len(base_image_url),
                    "да" if requires_segmentation else "нет",
                    len(result.get("masks") or []),
                )
        else:
            # Не получили даже растр — фронтенд показывает текст-ошибку.
            msg = result.get("pipeline_error") or "Провайдер не вернул изображение"
            logger.error("[ImageGen] ERROR: %s", msg)
            enriched["image_prompt"] = prompt
            enriched["masks"] = None
            enriched["image_error"] = {
                "code": "GENERATION_FAILED",
                "message": str(msg)[:200],
            }

    except Exception as exc:  # noqa: BLE001
        # build_vector_illustration сама не бросает исключений — сюда можно
        # попасть лишь при совсем неожиданной проблеме (напр. сбой импорта).
        msg = f"Ошибка генерации: {exc}"
        logger.error("[ImageGen] ERROR: %s", msg, exc_info=True)
        enriched["image_prompt"] = prompt
        enriched["masks"] = None
        enriched["image_error"] = {
            "code": "GENERATION_FAILED",
            "message": str(exc)[:200],
        }

    return enriched


# ──────────────────────────────────────────────────────────────────
# Публичный интерфейс
# ──────────────────────────────────────────────────────────────────

def enrich_board_steps(
    board_steps: list[dict],
    topic_hint: str = "",
    style: str | None = None,
    palette: str | None = None,
    reference_image_url: str | None = None,
) -> list[dict]:
    """
    Перехватывает `board_steps` от Llama и обогащает все команды типа
    `image_with_labels`, у которых есть поле `image_prompt`, — прогоняя
    каждую через build_vector_illustration() (Banana → base_image_url,
    опц. SAM2; см. _enrich_command и ai_engine.illustration_pipeline).

    Запросы выполняются параллельно (ThreadPoolExecutor), что минимизирует
    суммарное время ожидания при нескольких иллюстрациях в одном ответе.

    Args:
        board_steps: оригинальный список шагов от модели.
        topic_hint:  тема урока/задачи на русском (обычно — `board["topic"]`,
                     см. вызов в draw_views.py: WhiteboardDrawView.post).
                     Необязательный — по умолчанию "".
        style:       id стиля с фронтенда (flat/2_5d/3d/sketch) — применяется
                     ко ВСЕМ иллюстрациям этого ответа (StyleSelector в UI).
        palette:     id палитры с фронтенда (he_inspired/…).

    Returns:
        Тот же список, но команды с `image_prompt` приведены к контракту
        {base_image_url, labels, masks}, либо с `image_error` при полном
        сбое генерации (см. _enrich_command и ai-chat.tsx).
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
            future = pool.submit(
                _enrich_command, cmd, topic_hint, style, palette,
                reference_image_url,
            )
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

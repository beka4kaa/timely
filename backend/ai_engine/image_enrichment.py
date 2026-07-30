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
  Модель: bytedance-seed/seedream-4.5 ($0.04/картинка). Предыдущая модель
  впечатывала в иллюстрацию псевдо-текст («Fikicn», «Filek», «Porgls») даже
  с полным TEXT_FREE-контрактом — это ломало пайплайн, где подписи кладутся
  отдельным слоем. Seedream кадр отдаёт чистым.
  Tier: standard (задаётся через HTTP-заголовок X-OR-Provider-Tier)
  Endpoint: https://openrouter.ai/api/v1/chat/completions
  Специфика: `modalities` зависит от модели — см. _modalities_for.
             Чистые image-модели (Seedream) принимают только
             ["image"] и на ["image","text"] отвечают 404;
             мультимодальные (Gemini Image) — наоборот,
             ответ приходит в choices[0].message.content — список частей,
             среди которых ищем элемент с `type == "image_url"` (а также
             в message.images — см. _extract_image_url и его докстринг,
             почему проверка идёт именно в таком порядке).

Настройки в settings.py (заглушки, замените реальными)
──────────────────────────────────────────────────────
    IMAGE_GEN_API_URL  = "https://openrouter.ai/api/v1/chat/completions"
    IMAGE_GEN_API_KEY  = env("OPENROUTER_API_KEY")   # уже есть
    IMAGE_GEN_MODEL    = "bytedance-seed/seedream-4.5"
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

from .image_models import ImageGenOptions, resolve_options, supports_quality
from .usage import provider_from_base_url, record_model_usage

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
# Дефолт ПОСЛЕДНЕЙ инстанции: используется только вызовами, которые не
# передали `options`. Модель выбирает пользователь на доске, и её значение
# приезжает per-request через ImageGenOptions (см. ai_engine.image_models).
# Читать эту константу внутри _call_image_api напрямую НЕЛЬЗЯ: она
# фиксируется на импорте, и per-request выбор был бы молча проигнорирован.
_MODEL: str = getattr(
    settings,
    "IMAGE_GEN_MODEL",
    "bytedance-seed/seedream-4.5",
)
_TIMEOUT: int = int(getattr(settings, "IMAGE_GEN_TIMEOUT", 60))
_TIER: str = getattr(settings, "IMAGE_GEN_TIER", "standard")


def _is_image_only_model(model: str) -> bool:
    """Модель, которая умеет отдавать ТОЛЬКО картинку, без текстовой части.

    Seedream — чистая image-модель. Gemini-image (Nano Banana) —
    мультимодальная: возвращает и картинку, и текст. Разделение важно ровно
    в одном месте — `_modalities_for`, см. её docstring.

    ДОБАВЛЯЯ НОВУЮ image-модель, впишите её сюда. Иначе запрос уйдёт с
    modalities ["image", "text"], и провайдер ответит 404 — генерация
    отвалится целиком, а не деградирует.
    """
    lowered = model.lower()
    return "seedream" in lowered or "bytedance" in lowered


def _modalities_for(model: str) -> list[str]:
    """Какие модальности объявлять в запросе к OpenRouter.

    Чисто image-модели отклоняют запрос с "text" в modalities (проверено
    вживую: 404 "No endpoints found that support the requested output
    modalities: image, text"). Gemini-image, наоборот, возвращает и картинку,
    и текст, поэтому для него список остаётся полным.
    """
    return ["image"] if _is_image_only_model(model) else ["image", "text"]


# Image-модели специально сильны в рендеринге текста и на длинных промптах
# «топят» запреты: с полным TEXT_FREE_* контрактом модель всё равно впечатывала
# псевдо-подписи («Porgls», «Courcta», «Fikicn») прямо в иллюстрацию, что
# ломает пайплайн — подписи должны накладываться отдельным слоем по
# координатам грунтинга. Короткая фраза В САМОМ КОНЦЕ промпта это
# останавливает (проверено вживую: картинка стала чистой).
TEXT_FREE_TERMINAL: str = (
    "Absolutely no text, no letters, no numbers, no labels anywhere in the image."
)

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
# ЭТАЛОН КАЧЕСТВА — Figure Labs (см. их «Круговорот воды»): мягкий пастельный
# 3D в духе Cinema 4D / BioRender, cutaway-диорама на светлом фоне. Наши прежние
# пресеты целились мимо:
#   • flat «coloring book / pure solid colors / black outlines» → детская
#     раскраска вместо профессиональной BioRender-инфографики (у эталона —
#     мягкие градиенты и аккуратная подсветка даже во «флэте»);
#   • 3d-negative запрещал «isometric, cutaway box, diorama block» — то есть
#     ИМЕННО фирменную композицию эталона. Запреты сняты, «почерк» переписан
#     на soft clay/plastic + пастель + мягкий студийный свет.
STYLE_PRESETS: dict[str, dict[str, str]] = {
    "flat": {
        "positive": (
            "Modern premium flat vector scientific illustration in a professional "
            "science-visual style: clean smooth vector shapes, harmonious soft "
            "palette, subtle flat-design shading and gentle gradients that give "
            "light depth, crisp thin outlines only where they aid clarity, elegant "
            "rounded forms, polished professional educational look."
        ),
        "negative": (
            "childish coloring-book style, thick black outlines around everything, "
            "garish oversaturated colors, photorealistic 3D render, heavy textures, "
            "harsh shadows."
        ),
    },
    "2_5d": {
        "positive": (
            "Detailed isometric 2.5D educational illustration: precise orthographic "
            "projection, rich soft shading, smooth glossy plastic and matte clay "
            "materials, gentle pastel palette, clear depth and volume, meticulous "
            "miniature detail, polished premium explanatory render."
        ),
        "negative": (
            "2D flat, hard black outlines, realistic photo, harsh oversaturated "
            "colors."
        ),
    },
    "3d": {
        "positive": (
            "Soft, premium 3D educational render style: "
            "smooth rounded geometry, matte clay and glossy plastic materials, "
            "gentle pastel colors, soft studio lighting with delicate shadows and "
            "subtle ambient occlusion, light airy atmosphere, charming miniature-"
            "scene feel, gentle perspective with a clear sense of depth and "
            "volume, meticulous detail."
        ),
        "negative": (
            "flat 2D, hard black outlines, harsh oversaturated colors, "
            "photorealism, gritty textures, dark moody lighting, cluttered messy "
            "composition."
        ),
    },
    "scientific_flat_textbook": {
        "positive": (
            "Clean flat vector educational textbook diagram, precise 2D technical "
            "illustration, white background, soft light gray and muted blue palette, "
            "crisp dark blue-gray outlines, smooth flat fills, subtle depth only, "
            # ВАЖНО: в позитивной части НЕ упоминаем labels/labeled/text.
            # Раньше здесь было «clean labeled arrows … readable scientific
            # labels reserved for the deterministic overlay layer» — оговорку
            # «reserved for the overlay» диффузионная модель не понимает, она
            # видит «читаемые научные подписи» и рисует псевдо-текст поверх
            # схемы (наблюдалось на проде: «Ruterrflord's Gold Foil Experiment»).
            "consistent line weights, clean plain arrows without any writing, "
            "centered balanced composition, professional physics textbook style, "
            "minimal clutter, high clarity, high contrast, polished infographic quality. "
            # Раньше пресет заканчивался на «minimal clutter» и давал голый
            # контур: тело нечем отличить от опоры, вектор — от размерной линии.
            # Просим ровно ту насыщенность, что есть в хороших учебниках:
            # заливки, цветовое разделение ролей, лёгкий объём — но без 3D.
            "Objects have solid tinted fills, not empty outlines: bodies in soft grey-blue, "
            "supports and ground in a heavier neutral tone, motion and force arrows in a "
            "saturated accent blue so they read instantly against the objects. "
            "Add gentle flat shading and a soft contact shadow under each object to give "
            "light volume while staying strictly 2D. Auxiliary construction lines are thin "
            "and dashed. The result should look like a figure from a modern professional "
            "textbook, rich and finished — never a bare wireframe sketch."
        ),
        "negative": (
            "photorealistic, 3D render, cinematic lighting, dark background, black "
            "canvas, UI frame, card border, neon glow, heavy shadow, rough pencil "
            "sketch, messy hand drawing, watercolor, oil painting, cartoon mascot, "
            "distorted text, misspelled labels, random extra labels, cluttered "
            "diagram, perspective distortion, warped geometry, blurry lines, low "
            "resolution, noisy background, decorative elements, unnecessary texture."
        ),
    },
    # Эталон — чернильный скетч из конспекта физика (как классические learning-
    # иллюстрации «Support Beam / Uniform Cylinder»): уверенное перо, жирные
    # контуры переменной толщины, диагональная штриховка, чуть «живые»
    # неидеальные линии. СТРОГО монохром: даже стрелки и вода — чернила, без
    # единого цветного пятна (палитра для sketch не применяется вообще, см.
    # _build_final_prompt — раньше «clear water blue» из палитры красил воду).
    "sketch": {
        "positive": (
            "STRICTLY MONOCHROME hand-drawn black ink pen illustration, like a "
            "careful scientific sketch: bold confident pen outlines with varying "
            "line weight, diagonal hatching and cross-hatching for shading and "
            "volume, charming slightly imperfect hand-drawn linework, black ink "
            "on clean white paper only — no color anywhere, not even on water "
            "or arrows. Every arrow is "
            "hand-drawn in the same ink pen: a slightly wobbly confident "
            "stroke with a simple hand-drawn arrowhead, as if sketched by "
            "hand in one motion."
        ),
        "negative": (
            "ANY color, colored fills, blue water, gradients, watercolor, "
            "photorealism, thin scratchy chaotic lines, sterile digital vector "
            "smoothness, perfectly geometric CAD-style arrows, grey washes, "
            "circular composition, circle outline, badge, emblem, medallion, "
            "vignette, framed sketch, picture frame, card layout."
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

TEXT_FREE_OUTPUT_CONTRACT: str = (
    "TEXT-FREE OUTPUT CONTRACT: generate a pure raster illustration with ZERO "
    "visible typography or glyphs. Do not draw readable text, pseudo-text, "
    "letters, numbers, labels, captions, title blocks, legends, callout text, "
    "watermarks, signatures, UI text, map labels, or process-name words in any "
    # Фраза «the application will add all labels later» убрана намеренно:
    # модель не рассуждает про «later», она видит «add all labels» и рисует их.
    "language. If the subject normally has labels, leave those areas completely "
    "empty. Named concepts in the prompt are private instructions only: represent "
    "them with objects, motion, arrows, layout, color, and shapes, never as "
    "written words. "
)

TEXT_FREE_FINAL_GUARD: str = (
    "FINAL CHECK BEFORE RETURNING THE IMAGE: there must be no typography at all "
    "inside the pixels. Do not write any process names, object names, category "
    "names, formulas, captions, legends, labels, title text, or pseudo-text; "
    "show meaning only with unlabeled visual regions, objects, arrows, shapes, "
    "colors, and spatial relationships."
)

FULL_RECTANGLE_COMPOSITION_CONTRACT: str = (
    "COMPOSITION CONTRACT: use the full rectangular 16:9 canvas as a normal "
    "complete image. Do not enclose the scene inside a circle, oval, badge, "
    "medallion, icon, vignette, framed card, picture frame, border, or rounded "
    "container. Do not add a white mat or empty card around the illustration. "
    "The image should feel open and full-size, with the subject naturally "
    "occupying the available rectangular frame. "
)

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
    TEXT_FREE_OUTPUT_CONTRACT +
    FULL_RECTANGLE_COMPOSITION_CONTRACT +
    # Композиция/качество — после запрета текста.
    "It is a richly detailed, high-quality, polished scientific illustration, "
    "drawn directly in the rectangular image area on a clean light background. "
)

# Префикс для СЦЕН/процессов (requires_segmentation=False): экосистемы,
# географические/биологические процессы, строение атмосферы и т.п.
#
# ЭВОЛЮЦИЯ (важно, чтобы не ходить по кругу):
#   v1 «isolated on white» → плоские пустые «игрушки» (жалоба №1);
#   v2 «FILLS THE ENTIRE FRAME edge-to-edge» → мультяшный плакат во весь кадр,
#      по качеству всё ещё далеко от эталона (жалоба №2, сравнение с Figure Labs).
# Эталон (Figure Labs, см. их «Круговорот воды»): это НЕ full-bleed — это
# ЦЕНТРИРОВАННАЯ CUTAWAY-ДИОРАМА (блок-разрез воды/рельефа со слоистыми боками)
# на мягком, очень светлом фоне с полями, в духе BioRender / премиальных учебных
# инфографик. Процессы показаны чистыми жирными векторными стрелками. Именно эту
# композицию и просим. Запрет текста сохраняем (типографику кладёт overlay-слой).
SCENE_PROMPT_PREFIX: str = (
    TEXT_FREE_OUTPUT_CONTRACT +
    FULL_RECTANGLE_COMPOSITION_CONTRACT +
    "A premium educational science illustration with polished textbook quality: "
    "ONE cohesive, complete scene with real "
    "depth. When the subject involves terrain, water bodies or internal structure, "
    "present it as a clean cutaway cross-section scene with visible layered sides "
    "when useful, but keep it open in the full rectangular canvas. All processes "
    "and motion are shown with clean, bold, smoothly "
    "curved directional arrows. Carefully composed, harmonious and generously "
    "detailed — never cluttered, never childish. "
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
# NB: формулировка про стрелки стиле-нейтральна («clean and deliberate», а не
# «strict geometric vector») — sketch рисует стрелки ОТ РУКИ (см. его positive),
# и прежний жёсткий «vector arrows» конфликтовал с рукописным пером.
NEGATIVE_PROMPT: str = (
    "DO NOT INCLUDE: readable text, pseudo-text, words, letters, numbers, labels, "
    "captions, legends, callout text, map labels, title blocks, watermarks, "
    "signatures, typographic marks, circular crops, circle outlines, badges, "
    "emblems, medallions, framed cards, picture frames, decorative borders, "
    "vignettes, white mats, anatomical textures, veins, flesh, blood, "
    "organic tentacles, messy lines, gore, medical anomalies, duplicate supports, "
    "parallel duplicate platforms, extra rails, braces, wedges, pedestals, "
    "double-headed arrows, duplicate arrows, crossing arrows, or callout arrows "
    "aimed into the center of an object. Arrows must be clean, deliberate and "
    "easy to understand visually, never organic or tentacle-like shapes."
)

SCIENTIFIC_FLAT_STYLE_KEY = "scientific_flat_textbook"

SCIENTIFIC_DIAGRAM_PROMPT_CONTRACT: str = (
    "SCIENTIFIC DIAGRAM MODE. Diagram intent: generate a clean educational "
    "scientific diagram that preserves the physical or mathematical meaning, "
    "using only the necessary objects, arrows and relationships. Presentation: "
    "use a professional educational figure on a white or very light background. "
    "Apply the selected rendering style consistently, but never let that style "
    "change object count, attachment, contact, vector direction or scientific "
    "meaning. Geometry and layout: keep one unambiguous side-view or front-view "
    "topology whenever the subject allows it, even if the selected style adds "
    "depth; keep the composition centered, balanced and readable, "
    # «clear separation between objects» стояло без оговорок, и модель отделяла
    # тело от опоры: брусок висел над чертой земли, как будто левитирует.
    # Разделять нужно только НЕ СВЯЗАННЫЕ объекты.
    "with clear separation between UNRELATED objects. "
    "PHYSICAL CONTACT IS MANDATORY: anything resting on a surface must actually "
    "touch it — the bottom edge of the body sits flush on the supporting line "
    "with zero gap, and a soft contact shadow marks the touch point. Render each "
    "requested ground or support exactly once as one connected filled surface. "
    "Any visible thickness must belong to that same connected surface; it must "
    "never look like a second parallel platform, rail, brace or pedestal. Ropes, "
    "threads and springs visibly attach at both ends: to the object and to its anchor. "
    "A viewer must be able to tell what holds what. Arrows must point exactly in the "
    "intended direction and use consistent arrowhead sizes. Avoid label overlaps "
    "by leaving clean whitespace around objects and arrows. Scientific correctness: "
    "do not add extra forces, bodies, axes, mechanisms, labels, arrows or decorative "
    # Было: «keep text areas clean and simple for readable labels» — это прямое
    # приглашение нарисовать читаемые подписи. Оставляем только запрет.
    "objects that were not requested. Leave generous empty whitespace next to each "
    "object instead of writing anything there. Do not invent, rewrite, misspell, "
    "render, distort or bake any label, formula, symbol or caption into the pixels. "
    "Avoid: dark background, black card "
    # «heavy shadows» оставляем в запрете, но мягкая контактная тень нужна:
    # без неё тело не читается как стоящее на опоре (см. блок PHYSICAL CONTACT).
    "UI, neon glow, glow behind text, heavy dramatic shadows, objects floating "
    "above their support, messy linework, clutter, distorted text, extra labels, "
    "incorrect arrows and "
    "random decorations. "
)

MECHANICS_DIAGRAM_PROMPT_CONTRACT: str = (
    "MECHANICS TOPOLOGY CONTRACT. First satisfy the physical topology, then render "
    "it: count the requested bodies, surfaces, supports and connectors, and draw "
    "each exactly once. One requested force equals exactly one single-headed "
    "vector arrow. Every force arrow starts at the center of mass of the affected "
    "body and points outward from that body; no force arrow may terminate at the "
    "body center. Gravity points vertically downward. A normal force is "
    "perpendicular to and away from the contact surface. Friction is parallel to "
    "the contact surface and opposes the stated or implied motion. Keep force "
    "arrows visually separate: no double-headed arrows, no duplicated arrows, no "
    "crossing arrow shafts and no pointer or callout arrow aimed at an object. "
    "Do not add coordinate axes, dashed construction guides or auxiliary arrows "
    "unless the subject explicitly requests them. "
)

INCLINED_PLANE_PROMPT_CONTRACT: str = (
    "INCLINED PLANE EXACT TOPOLOGY. Draw exactly ONE block and exactly ONE "
    "continuous inclined surface. The surface is one simple triangular wedge or "
    "one connected slab with a single upper slope; the complete bottom face of "
    "the block rests flush on that upper slope. Do not draw a second parallel "
    "beam, rail, strip, shelf, mini-platform, brace, leg or wedge beneath, behind "
    "or through the block. If surface thickness is visible, its lower boundary "
    "is only the outline of the SAME connected surface, never another object. "
    "Show the requested angle only as one clean unlabeled arc at the foot of the "
    "slope. "
)

SCIENTIFIC_DIAGRAM_CONTEXT_RE = re.compile(
    r"("
    r"scientific|science|educational|textbook|учебн|научн|"
    r"physics|физик|mechanics|механик|free[-\s]*body|force|сила|normal\s+force|"
    r"gravity|гравитац|friction|трени|inclined|наклон|descent|спуск|"
    r"math|математ|function|функци|graph|график|parabola|парабол|axis|axes|ось|"
    r"geometry|геометр|triangle|треуг|angle|угол|theta|тета|"
    r"chemistry|хими|molecule|молекул|reaction|реакци|"
    r"biology|биолог|cell|клетк|photosynthesis|фотосинтез|water\s*cycle|круговорот|"
    r"engineering|инженер|schematic|схем|circuit|цеп[ьи]|электр|"
    r"optics|оптик|ray\s*diagram|lens|линз|mirror|зеркал|"
    r"cylinder|цилиндр|thread|нить|rope|support|опор|beam|балк|spring|пружин"
    r")",
    re.I,
)

EXPLICIT_NON_TEXTBOOK_STYLE_RE = re.compile(
    r"("
    r"chalkboard|blackboard|hand[-\s]*drawn|pencil|sketch|rough\s+sketch|"
    r"realistic|photorealistic|photo[-\s]*real|3d|three[-\s]*dimensional|"
    r"isometric|watercolor|oil\s+painting|карандаш|скетч|эскиз|от\s+руки|"
    r"мелом|реалист|фотореал|объ[её]мн|изометр"
    r")",
    re.I,
)

TASK_DIAGRAM_STYLE_CONTRACT: str = (
    "TASK / PROBLEM DIAGRAM MODE: because this is a school problem or explanatory "
    "task diagram, keep the image almost flat and teacher-drawn, like a clean "
    "notebook sketch or a simple diagram drawn on a classroom whiteboard. Use "
    "plain 2D side/front views, simple geometric bodies, simple supports, strings, "
    "beams, cylinders, blocks and arrows. "
    # Раньше здесь жёстко требовался монохром, и он спорил с палитрой запроса:
    # схема выходила голым серым контуром, где тело не отличить от опоры.
    # Ограниченная палитра — да, обесцвечивание — нет.
    "Keep the palette restrained: neutral greys for bodies and supports plus ONE "
    "clear accent color used consistently for all arrows and motion, so roles are "
    "distinguishable at a glance. Objects are filled, not hollow outlines. "
    "Avoid decorative scenery, landscapes, glossy 3D volume, "
    "isometric depth, complex mechanical textures, realistic rendering, gradients, "
    "large shadows, and overly detailed parts. Use only the essential arrows "
    "needed to explain the given motion or forces; do not invent extra arrows, "
    "extra labels, extra mechanisms, or additional background objects. "
)

TASK_DIAGRAM_CONTEXT_RE = re.compile(
    r"("
    r"задач|problem|word\s*problem|physics|физик|mechanics|механик|"
    r"математ|math|geometry|геометр|force|сила|mass|масса|тело|block|блок|"
    r"cylinder|цилиндр|rod|стерж|beam|балк|support|опор|thread|нить|rope|вер[её]в|"
    r"spring|пружин|friction|трени|incline|наклон|acceleration|ускор|velocity|скорост|"
    r"rotation|вращ|unwind|размат|vector|вектор|diagram|схем|graph|график|парабол"
    r")",
    re.I,
)

MECHANICS_DIAGRAM_CONTEXT_RE = re.compile(
    r"("
    r"physics|физик|mechanics|механик|free[-\s]*body|force|сила|gravity|"
    r"гравитац|weight|тяжест|normal\s+force|нормал|friction|трени|mass|масса|"
    r"block|брусок|тело|incline|inclined|наклон|pendulum|маятник|pulley|блок|"
    r"rope|thread|нить|spring|пружин|velocity|скорост|acceleration|ускор"
    r")",
    re.I,
)

INCLINED_PLANE_CONTEXT_RE = re.compile(
    r"(inclined?\s+(?:plane|surface)|incline|sloped?\s+surface|наклон\w*\s+плоск\w*)",
    re.I,
)

_TEXT_REQUEST_CLEANUPS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b(with|including|include|showing)\s+(text|labels?|captions?|annotations?|titles?|legends?|callouts?)\b", re.I), ""),
    (re.compile(r"\b(labelled|labeled|annotated|captioned|titled)\b", re.I), ""),
    (re.compile(r"\b(text|label|labels|caption|captions|annotation|annotations|legend|legends|callout|callouts)\s+(inside|on|within)\s+the\s+image\b", re.I), ""),
    (re.compile(r"\b(?:a|an|the)?\s*(?:circular|round|rounded|oval)\s+(?:illustration|diagram|image|scene|composition|badge|emblem|medallion)\b", re.I), "a full rectangular illustration"),
    (re.compile(r"\b(?:circle|circular|round|oval)\s+(?:outline|frame|border|crop|vignette|badge|emblem|medallion|composition)\b", re.I), ""),
    (re.compile(r"\b(?:inside|within|in)\s+(?:a|an|the)\s+(?:circle|oval|badge|emblem|medallion|frame|card|vignette)\b", re.I), ""),
    (re.compile(r"\b(?:framed|bordered|vignette|badge|emblem|medallion|icon)\s+(?:illustration|diagram|image|scene|composition)\b", re.I), "full rectangular illustration"),
    (re.compile(r"\bdiagram\b", re.I), "illustration"),
    (re.compile(r"\binfographic\b", re.I), "illustration"),
    (re.compile(r"\bposter\b", re.I), "visual"),
)


def _sanitize_image_prompt(prompt: str) -> str:
    """
    Llama иногда всё равно возвращает `image_prompt` с "labeled diagram" /
    "annotated infographic". Это не содержание, а инструкция к генератору
    впечатывать текст. Чистим такие триггеры до сборки финального промпта.
    """
    cleaned = prompt.strip()
    for pattern, replacement in _TEXT_REQUEST_CLEANUPS:
        cleaned = pattern.sub(replacement, cleaned)
    cleaned = re.sub(r"\b(?:inside|within|in)\s+(?:a|an|the)?\s*$", "", cleaned, flags=re.I)
    cleaned = re.sub(r"\s{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.;:])", r"\1", cleaned)
    return cleaned.strip(" ,.;:") or prompt.strip()


def _normalize_style_key(style: str | None) -> str:
    """'2.5D'/'2-5d' → '2_5d', регистр; при неизвестном — DEFAULT_STYLE."""
    key = (style or DEFAULT_STYLE).strip().lower().replace(".", "_").replace("-", "_")
    return key if key in STYLE_PRESETS else DEFAULT_STYLE


def _effective_style_key(
    style: str | None,
    scientific_diagram: bool = False,
    explicit_style_override: bool = False,
) -> str:
    """
    Backend-only style router.

    Scientific diagrams default to the clean textbook preset when the frontend
    sends no style or the generic "flat" style. Explicit non-flat UI styles
    (sketch / 2.5D / 3D) stay intact, and prompt-level overrides can also opt
    out of the automatic textbook mapping.
    """
    raw = (style or "").strip().lower().replace(".", "_").replace("-", "_")
    key = raw if raw in STYLE_PRESETS else _normalize_style_key(style)
    if (
        scientific_diagram
        and not explicit_style_override
        and (not raw or key in {"flat", SCIENTIFIC_FLAT_STYLE_KEY})
    ):
        return SCIENTIFIC_FLAT_STYLE_KEY
    return key


def _resolve_style_suffix(
    style: str | None,
    scientific_diagram: bool = False,
    explicit_style_override: bool = False,
) -> str:
    """id стиля с фронтенда → POSITIVE-суффикс из STYLE_PRESETS."""
    return STYLE_PRESETS[
        _effective_style_key(style, scientific_diagram, explicit_style_override)
    ]["positive"]


def _resolve_style_negative(
    style: str | None,
    scientific_diagram: bool = False,
    explicit_style_override: bool = False,
) -> str:
    """id стиля → NEGATIVE-суффикс из STYLE_PRESETS (пусто, если у стиля его нет)."""
    return STYLE_PRESETS[
        _effective_style_key(style, scientific_diagram, explicit_style_override)
    ].get("negative", "")


def _resolve_palette_suffix(palette: str | None) -> str:
    """id палитры с фронтенда → суффикс из COLOR_PALETTES (пусто, если не задана/неизвестна)."""
    if not palette:
        return ""
    return COLOR_PALETTES.get(palette.strip().lower(), "")


def _is_task_diagram_context(*parts: str | None) -> bool:
    """Heuristic gate for word-problem / school-task diagrams."""
    context = " ".join(p for p in parts if isinstance(p, str))
    return bool(context and TASK_DIAGRAM_CONTEXT_RE.search(context))


def _is_scientific_diagram_context(*parts: str | None) -> bool:
    """Heuristic gate for textbook-style science, math and engineering diagrams."""
    context = " ".join(p for p in parts if isinstance(p, str))
    return bool(context and SCIENTIFIC_DIAGRAM_CONTEXT_RE.search(context))


def _is_mechanics_diagram_context(*parts: str | None) -> bool:
    """Heuristic gate for force/vector topology rules."""
    context = " ".join(p for p in parts if isinstance(p, str))
    return bool(context and MECHANICS_DIAGRAM_CONTEXT_RE.search(context))


def _is_inclined_plane_context(*parts: str | None) -> bool:
    """Heuristic gate for the strict one-block/one-surface incline contract."""
    context = " ".join(p for p in parts if isinstance(p, str))
    return bool(context and INCLINED_PLANE_CONTEXT_RE.search(context))


def _has_explicit_non_textbook_style(*parts: str | None) -> bool:
    """Detect user text asking for a different visual style than flat textbook."""
    context = " ".join(p for p in parts if isinstance(p, str))
    return bool(context and EXPLICIT_NON_TEXTBOOK_STYLE_RE.search(context))


def _task_diagram_palette(palette: str | None, task_diagram: bool) -> str | None:
    """
    Палитра по умолчанию для схем к задачам.

    Раньше здесь стоял monochrome-ink: «природная» палитра для чертежа
    действительно избыточна, но чисто серый выхолащивал схему до примитивного
    контура — цветом не отличить тело от опоры и вектор от размерной линии.
    oceanic-clean оставляет чертёж строгим, но даёт синий акцент для стрелок и
    заливок, как в учебниках (и как у референсов, на которые мы равняемся).
    """
    if not task_diagram:
        return palette
    normalized = (palette or "").strip().lower()
    if not normalized or normalized == "natural-earth":
        return "oceanic-clean"
    return palette


def _build_final_prompt(
    core: str,
    style: str | None,
    palette: str | None,
    scene: bool = False,
    task_diagram: bool = False,
    scientific_diagram: bool = False,
    explicit_style_override: bool = False,
    model: str | None = None,
    aspect_ratio: str | None = None,
) -> str:
    """
    Единая точка сборки ИТОГОВОЙ текстовой строки запроса к генератору
    (то, что в задачах называют buildFinalPrompt; фактически сборка всегда была
    здесь, на бэкенде, — фронт шлёт лишь id стиля/палитры).

    Порядок склейки фиксирован:
      [PREFIX]                — композиция: белый фон (объекты) ИЛИ диорама (сцены);
      [core]                  — единственная часть, различная для t2i/i2i-edit;
      [aspect ratio]
      [positive стиля]        — _resolve_style_suffix;
      [scientific mode]       — опц. строгий textbook prompt для science/math;
      [task diagram mode]     — опц. школьная плоская схема для задач;
      [палитра]               — опц., _resolve_palette_suffix;
      [NEGATIVE_PROMPT]       — глобальные запреты, ВСЕГДА;
      [negative стиля]        — _resolve_style_negative, ВСЕГДА (новые негативы
                                сцено-совместимы: запрещают только «почерк» —
                                раскраску/фото/грязь, а не окружение).

    scene:
      • False (объекты, requires_segmentation=true) — изолированная фигура на белом
        фоне (GLOBAL_PROMPT_PREFIX): белый фон нужен SAM2 для чистой сегментации.
      • True  (сцены/процессы, requires_segmentation=false) —
        центрированная cutaway-диорама на светлом фоне (SCENE_PROMPT_PREFIX),
        эталон — Figure Labs / BioRender.
    """
    style_key = _effective_style_key(
        style,
        scientific_diagram=scientific_diagram,
        explicit_style_override=explicit_style_override,
    )
    style_pos = _resolve_style_suffix(
        style,
        scientific_diagram=scientific_diagram,
        explicit_style_override=explicit_style_override,
    )
    # Sketch — строго монохромный: цветовая палитра к нему НЕ применяется
    # (именно палитра «clear water blue…» красила воду в скетчах в голубой).
    is_monochrome = style_key == "sketch"
    effective_palette = _task_diagram_palette(palette, task_diagram)
    palette_suffix = "" if is_monochrome else _resolve_palette_suffix(effective_palette)
    style_neg = _resolve_style_negative(
        style,
        scientific_diagram=scientific_diagram,
        explicit_style_override=explicit_style_override,
    )

    # Science/math task diagrams should not inherit the scene prompt's 3D/cutaway
    # bias. Keep them on the neutral light-background prefix, then add the
    # explicit textbook contract below.
    prefix = (
        GLOBAL_PROMPT_PREFIX
        if scientific_diagram
        else (SCENE_PROMPT_PREFIX if scene else GLOBAL_PROMPT_PREFIX)
    )

    text = (
        f"{prefix}{core} "
        f"Image aspect ratio: {aspect_ratio or IMAGE_ASPECT_RATIO} "
        "(landscape orientation). "
        f"{style_pos}"
    )
    if scientific_diagram:
        text += f" {SCIENTIFIC_DIAGRAM_PROMPT_CONTRACT}"
        if _is_mechanics_diagram_context(core):
            text += f" {MECHANICS_DIAGRAM_PROMPT_CONTRACT}"
        if _is_inclined_plane_context(core):
            text += f" {INCLINED_PLANE_PROMPT_CONTRACT}"
    if task_diagram:
        text += f" {TASK_DIAGRAM_STYLE_CONTRACT}"
    if palette_suffix:
        text += f" {palette_suffix}"
    text += f" {NEGATIVE_PROMPT}"
    if style_neg:
        text += f" Avoid for this style: {style_neg}"

    text += f" {TEXT_FREE_FINAL_GUARD}"
    # Чистые image-модели лучше всего соблюдают запрет текста, если короткая
    # директива стоит буквально последней. На полном промпте раньше хвостом был
    # только длинный общий guard, и модель всё равно печатала FRiction / 30°G /
    # псевдо-буквы вроде «Fikicn».
    if _is_image_only_model(model or _MODEL):
        text += f" {TEXT_FREE_TERMINAL}"
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
    scene: bool = False,
    task_diagram: bool = False,
    scientific_diagram: bool = False,
    explicit_style_override: bool = False,
    compact_prompt: bool = False,
    options: ImageGenOptions | None = None,
) -> str:
    """
    Отправляет запрос к OpenRouter (модель из `options`, standard tier).

    Args:
        prompt:              СОДЕРЖАНИЕ картинки (что изобразить).
        options:             провалидированный выбор пользователя (модель,
                             качество, аспект). None → дефолт инсталляции.
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
    prompt = prompt.strip() if compact_prompt else _sanitize_image_prompt(prompt)

    # Модель берём ТОЛЬКО отсюда: `_MODEL` зафиксирован на импорте, и обращение
    # к нему ниже по телу функции потеряло бы выбор пользователя.
    if options is None:
        options = resolve_options()
    model = options.model
    aspect_ratio = options.aspect_ratio

    if not _API_KEY:
        raise ValueError(
            "IMAGE_GEN_API_KEY не задан. "
            "Добавьте OPENROUTER_API_KEY в переменные окружения."
        )

    headers = {
        "Authorization": f"Bearer {_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": getattr(settings, "SITE_URL", "https://timelyplan.me"),
        "X-Title": "Timely AI Tutor Board",
    }

    # ── Выбор режима: image-to-image (edit) vs text-to-image (чистая генерация) ──
    # Итоговую строку в ОБЕИХ ветках собирает _build_final_prompt: глобальный
    # белофоновый префикс + core + аспект + positive стиля + палитра + negative.
    if compact_prompt:
        # Planner-mode prompts are already assembled from a validated semantic
        # scene.  Do not append the legacy multi-paragraph style/negative
        # contracts: they dilute exact counts and relations.  One terminal
        # text guard remains because Seedream follows it reliably.
        compact_text = prompt
        if (
            _is_image_only_model(model)
            and TEXT_FREE_TERMINAL.lower() not in compact_text.lower()
        ):
            compact_text = f"{compact_text} {TEXT_FREE_TERMINAL}"
        if reference_image_url:
            message_content = [
                {"type": "image_url", "image_url": {"url": reference_image_url}},
                {"type": "text", "text": compact_text},
            ]
            compact_mode = "compact-edit"
        else:
            message_content = compact_text
            compact_mode = "compact-t2i"
        logger.info(
            "[ImageGen] POST %s | model=%s | style=%s | mode=%s | prompt=%.100s…",
            _API_URL,
            model,
            style or DEFAULT_STYLE,
            compact_mode,
            prompt,
        )
    elif reference_image_url:
        if scientific_diagram:
            core = (
                "Restyle the provided structure image in the selected rendering "
                "style while preserving its exact scientific topology. Preserve "
                "geometry, object count, object positions, physical contacts, "
                "attachments, force-vector origins, vector directions and scientific "
                f"meaning. Subject / content: {prompt}. Do not add or remove bodies, "
                "supports, surfaces, connectors, arrows or construction geometry. "
                "Do not move an arrowhead, reverse a vector, separate touching "
                "objects or create a duplicate support. Leave all whitespace regions "
                "free of glyph-like marks. Remove every visible piece of text, "
                "lettering, caption, pseudo-text or symbol from the pixels."
            )
        else:
            # Режим смены стиля = НАТИВНОЕ редактирование. Референс передаётся как
            # настоящий image-input (первый элемент мультимодального content) — Gemini
            # видит реальные пиксели и сохраняет композицию своим edit-механизмом.
            core = (
                "Re-render the provided image in a new artistic style while keeping "
                f"the SAME composition. Subject / content: {prompt}. "
                "Keep every object in the same position, with the same relative size "
                "and the same overall layout as the provided image — change ONLY the "
                "rendering style, do NOT move, add or remove any OBJECT structurally. "
                "Keep the full rectangular canvas composition; never crop the scene "
                "into a circle, badge, medallion, vignette, framed card, or border. "
                # Текст — исключение из «ничего не убирай»: его, наоборот, ВЫЧИЩАЕМ,
                # иначе restyle тащит впечатанные подписи референса (они столкнутся
                # с нашим overlay-слоем). Подписи добавляются отдельным слоем.
                "EXCEPTION: remove every piece of text, lettering, label, caption, "
                "pseudo-text, or glyph-like mark that appears in the provided image — "
                "the output must be completely text-free."
            )
        text_part = _build_final_prompt(
            core,
            style,
            palette,
            scene=scene,
            task_diagram=task_diagram,
            scientific_diagram=scientific_diagram,
            explicit_style_override=explicit_style_override,
            model=model,
            aspect_ratio=aspect_ratio,
        )
        message_content: Any = [
            {"type": "image_url", "image_url": {"url": reference_image_url}},
            {"type": "text", "text": text_part},
        ]
        logger.info(
            "[ImageGen] POST %s | model=%s | style=%s→%s | palette=%s | task_diagram=%s | scientific=%s | mode=edit(i2i) | prompt=%.70s…",
            _API_URL, model, (style or DEFAULT_STYLE),
            _effective_style_key(style, scientific_diagram, explicit_style_override),
            (_task_diagram_palette(palette, task_diagram) or "—"), task_diagram,
            scientific_diagram, prompt,
        )
    else:
        # Режим чистой генерации: только текстовый промпт.
        core = (
            "Subject / visual content to depict. These words are instructions for "
            f"the generator only and must never appear as writing in the image: {prompt}. "
            "Depict every named concept or process with unlabeled visual objects, "
            "arrows, motion, and spatial relationships only."
        )
        message_content = _build_final_prompt(
            core,
            style,
            palette,
            scene=scene,
            task_diagram=task_diagram,
            scientific_diagram=scientific_diagram,
            explicit_style_override=explicit_style_override,
            model=model,
            aspect_ratio=aspect_ratio,
        )
        logger.info(
            "[ImageGen] POST %s | model=%s | style=%s→%s | palette=%s | task_diagram=%s | scientific=%s | mode=t2i | prompt=%.70s…",
            _API_URL, model, (style or DEFAULT_STYLE),
            _effective_style_key(style, scientific_diagram, explicit_style_override),
            (_task_diagram_palette(palette, task_diagram) or "—"), task_diagram,
            scientific_diagram, prompt,
        )

    image_config: dict[str, Any] = {"aspect_ratio": aspect_ratio}
    # Качество отправляем ТОЛЬКО модели, которая его заявляет. Ни у одной
    # image-модели OpenRouter `quality` не значится в supported_parameters,
    # поэтому это best-effort: провайдер вправе его проигнорировать. Слать его
    # модели без поддержки нельзя — «не отправляй неподдерживаемые параметры».
    if options.quality and supports_quality(model):
        image_config["quality"] = options.quality

    payload: dict[str, Any] = {
        "model": model,
        "modalities": _modalities_for(model),
        "aspect_ratio": aspect_ratio,
        "image_config": image_config,
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

    image_url = _extract_image_url(data, prompt)
    record_model_usage(
        data,
        model=model,
        provider=provider_from_base_url(_API_URL),
        feature="image_generation",
        input_payload=payload,
        image_count=1,
        metadata={
            "style": style or DEFAULT_STYLE,
            "mode": "image_to_image" if reference_image_url else "text_to_image",
            # Модель и качество в metadata — то, по чему потом сравнивается
            # качество и стоимость двух моделей на одинаковых сюжетах.
            **options.meta,
        },
    )
    return image_url


def generate_raster_image(
    prompt: str,
    style: str | None = None,
    palette: str | None = None,
    reference_image_url: str | None = None,
    scene: bool = False,
    task_diagram: bool = False,
    scientific_diagram: bool = False,
    explicit_style_override: bool = False,
    compact_prompt: bool = False,
    options: ImageGenOptions | None = None,
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
        compact_prompt:      отправить уже собранный semantic-planner prompt без
                             legacy style/negative contracts.

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
        scene=scene,
        task_diagram=task_diagram,
        scientific_diagram=scientific_diagram,
        explicit_style_override=explicit_style_override,
        compact_prompt=compact_prompt,
        options=options,
    )


def generate_image(
    prompt: str,
    *,
    model: str | None = None,
    quality: str | None = None,
    aspect_ratio: str | None = None,
    reference_image_url: str | None = None,
) -> str:
    """
    Минимальный публичный вход в генерацию картинки по «сырым» параметрам.

    В отличие от `generate_raster_image`, здесь не нужно знать про
    style/palette/scientific-флаги: функция сама валидирует model/quality по
    allowlist и собирает `ImageGenOptions`. Используется там, где параметры
    приходят снаружи как строки.

    Raises:
        UnsupportedImageModel: модели нет в allowlist.
        Плюс те же исключения, что и у `_call_image_api` (ValueError,
        requests.HTTPError, requests.Timeout).
    """
    return _call_image_api(
        prompt,
        reference_image_url=reference_image_url,
        options=resolve_options(model, quality, aspect_ratio),
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
    skip_grounding: bool = False,
    options: ImageGenOptions | None = None,
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

    if options is None:
        options = resolve_options()

    # Подписи от Llama: содержат и текст (`content`), и координаты объектов
    # (`x`/`y`, `arrow_to`) в процентах — они же seed points для SAM2.
    seed_labels: list[dict] = cmd.get("labels") or []

    # Решение о сегментации принимает Llama (`requires_segmentation`).
    # Для сцен/пейзажей/процессов — false: SAM2 не нужен,
    # достаточно чистой картинки + подписей. Для выделения отдельных объектов
    # (органеллы, детали) — true.
    requires_segmentation: bool = bool(cmd.get("requires_segmentation", False))
    label_context = " ".join(
        str(label.get("content", ""))
        for label in seed_labels
        if isinstance(label, dict)
    )
    context_parts = (
        topic_hint,
        prompt,
        cmd.get("alt") if isinstance(cmd.get("alt"), str) else None,
        label_context,
    )
    style_raw = (style or "").strip().lower().replace(".", "_").replace("-", "_")
    explicit_non_textbook_style = (
        style_raw in {"sketch", "2_5d", "3d"}
        or _has_explicit_non_textbook_style(*context_parts)
    )
    task_diagram_detected = _is_task_diagram_context(*context_parts)
    scientific_diagram_detected = task_diagram_detected or _is_scientific_diagram_context(*context_parts)
    # Стиль и научная семантика — независимые оси. Раньше Sketch/2.5D/3D
    # отключали scientific_diagram целиком, а вместе с ним исчезали физические
    # инварианты: при restyle модель добавляла опоры и меняла стрелки. Теперь
    # explicit override сохраняет выбранный художественный preset, но строгая
    # топология и запрет текста остаются включены.
    task_diagram = task_diagram_detected and not explicit_non_textbook_style
    scientific_diagram = scientific_diagram_detected
    if task_diagram:
        logger.info(
            "[ImageGen] Task diagram mode enabled (palette=%s → %s)",
            palette or "—",
            _task_diagram_palette(palette, True) or "—",
        )
    if scientific_diagram and not explicit_non_textbook_style:
        logger.info(
            "[ImageGen] Scientific flat textbook mode enabled (style=%s → %s)",
            style or DEFAULT_STYLE,
            _effective_style_key(style, scientific_diagram=True),
        )
    elif scientific_diagram and explicit_non_textbook_style:
        logger.info(
            "[ImageGen] Scientific topology enabled; explicit style override kept style=%s",
            style or DEFAULT_STYLE,
        )

    # Базовая команда для фронтенда (строгий контракт):
    #   {type, base_image_url, labels, masks}
    # `image_prompt` убираем (он отработал), служебные поля не тащим.
    enriched: dict = {"type": "image_with_labels", "labels": seed_labels}
    # Штамп стиля генерации (flat/2_5d/3d/sketch) — фронтенд по нему выбирает
    # типографику подписей: рукописный Caveat ТОЛЬКО для sketch, остальным —
    # строгий современный sans (см. IllustrationRenderer/ScientificIllustration).
    enriched["gen_style"] = _effective_style_key(
        style,
        scientific_diagram=scientific_diagram,
        explicit_style_override=explicit_non_textbook_style,
    )
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
            skip_grounding=skip_grounding,
            task_diagram=task_diagram,
            scientific_diagram=scientific_diagram,
            explicit_style_override=explicit_non_textbook_style,
            options=options,
        )
        base_image_url = result.get("base_image_url")

        if base_image_url:
            # Успех. base_image_url — ВСЕГДА оригинальная картинка от Banana,
            # независимо от того, вызывался SAM2 или нет. masks — опционально.
            enriched["base_image_url"] = base_image_url
            enriched["masks"] = result.get("masks")  # list | None
            # A/B-метаданные: чем именно нарисована ЭТА картинка. Берём то, что
            # сообщил пайплайн (он мог уйти в детерминированный SVG и не звать
            # image-модель вовсе), и только при молчании — заявленный выбор.
            enriched["image_model"] = result.get("image_model", options.model)
            enriched["image_quality"] = result.get("image_quality", options.quality)
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
    skip_grounding: bool = False,
    options: ImageGenOptions | None = None,
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
                reference_image_url, skip_grounding, options,
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

"""
illustration_pipeline.py
────────────────────────────────────────────────────────────────────
Пайплайн генерации иллюстрации с НАПРАВЛЯЕМОЙ (prompted) сегментацией —
архитектура в духе Figure Labs. Главный принцип: оригинальная картинка
от Banana НИКОГДА не теряется. Сегментация — опциональное дополнение.

    image_prompt (текст, англ.) + labels от Llama + requires_segmentation
        │
        ▼
    [1] Nano Banana 2  (image_enrichment.generate_raster_image, OpenRouter)
        │   растровое изображение, единый визуальный стиль
        │   → base_image_url (ВСЕГДА возвращается, это основа ответа)
        │
        ├─ requires_segmentation == False (сцена/пейзаж/процесс) ─────────┐
        │     SAM2 пропускаем, masks=None. Фронтенд показывает чистую     │
        │     картинку + подписи Llama. Основной, быстрый путь.            │
        ▼                                                                  │
    [2] SAM 2  (Mac Studio :8002, FastAPI) — НАПРАВЛЯЕМАЯ сегментация     │
        │   координаты подписей Llama (arrow_to/x,y, в процентах) →        │
        │   seed points для SAM2 → точные маски РОВНО тех объектов,        │
        │   на которые указывает учитель (фон/стиль не мешают)             │
        ▼                                                                  │
    [3] Маски → полигоны в процентах (_mask_to_polygon_pct)               │
        │                                                                  │
        ▼                                                                  ▼
    {"base_image_url", "masks": [{label, polygon, bbox_pct, color}] | None}

ПОЧЕМУ НАПРАВЛЯЕМАЯ СЕГМЕНТАЦИЯ (а не слепой перебор сетки)
──────────────────────────────────────────────────────────────────
  Llama уже знает, ГДЕ объекты (она сама расставила подписи с
  координатами arrow_to). Передаём эти точки прямо в SAM2 — он
  математически вырезает границы объекта под точкой, независимо от
  стиля отрисовки. Это и точнее, и быстрее слепого перебора сетки,
  и не требует Qwen (подпись уже есть от Llama).

  Для сцен/пейзажей (круговорот воды, экосистема) сегментация вообще
  не нужна — там подписи указывают на ОБЛАСТИ цельной картинки, а не
  на отдельные физические объекты. Поэтому Llama выставляет
  requires_segmentation=false, и мы отдаём чистый растр + подписи.

Точка вызова
────────────
    from ai_engine.illustration_pipeline import build_vector_illustration
    result = build_vector_illustration(
        image_prompt="cell with nucleus and mitochondria, ...",
        topic_hint="Биология: клетка",
        seed_labels=[{"content": "Ядро", "x": 30, "y": 40,
                      "arrow_to": {"x": 30, "y": 45}}],
        requires_segmentation=True,
    )
    # result = {"base_image_url": "data:...",
    #           "masks": [{"label", "polygon", "bbox_pct", "color"}, ...] | None}

Обработка ошибок
─────────────────
  Пайплайн НИКОГДА не бросает исключения и собирает максимум из того,
  что получилось. При сбое SAM2 всё равно вернётся base_image_url
  (masks=None) — фронтенд показывает картинку без подсветки. Полный
  сбой (base_image_url=None + pipeline_error) возможен только на этапе
  [1] — генерации растра.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import cv2
import numpy as np
import requests
from django.conf import settings

from .image_enrichment import generate_raster_image

logger = logging.getLogger(__name__)

# ──────────────────────────────────────────────────────────────────
# Конфигурация (из settings, с фоллбэком на env — см. config/settings.py)
# ──────────────────────────────────────────────────────────────────

_MAC_HOST: str = getattr(settings, "MAC_STUDIO_HOST", os.getenv("MAC_STUDIO_HOST", "100.74.104.27"))

_SAM2_API_URL: str = getattr(settings, "SAM2_API_URL", f"http://{_MAC_HOST}:8002/api/segment/")
_SAM2_TIMEOUT: int = int(getattr(settings, "SAM2_TIMEOUT", 120))
# Длинная сторона копии изображения для SAM2 и параллелизм запросов к нему —
# см. развёрнутое обоснование в settings.py (коротко: время запроса критически
# зависит от разрешения — 28с на реальной картинке 1408×768 против ~3с на её
# уменьшенной копии 384×~210, и сервис НЕ выигрывает от распараллеливания).
_SAM2_MAX_DIM: int = int(getattr(settings, "ILLUSTRATION_SAM2_MAX_DIM", 384))
_SAM2_MAX_WORKERS: int = int(getattr(settings, "ILLUSTRATION_SAM2_MAX_WORKERS", 2))

_QWEN_API_BASE_URL: str = getattr(settings, "QWEN_API_BASE_URL", f"http://{_MAC_HOST}:8080/v1")
_QWEN_API_KEY: str = getattr(settings, "QWEN_API_KEY", "sk-local")
_QWEN_MODEL_NAME: str = getattr(settings, "QWEN_MODEL_NAME", "mlx-community/Qwen3.6-27B-4bit")
_QWEN_TIMEOUT: int = int(getattr(settings, "QWEN_TIMEOUT", 60))

# Vision-грунтинг подписей: после генерации спрашиваем у Qwen, ГДЕ объекты реально
# оказались на картинке, и переносим туда подписи. Координаты от Llama — лишь
# догадка, сделанная ДО генерации растра, поэтому подписи «летают». Можно
# отключить (ILLUSTRATION_VISION_GROUNDING=false), если Qwen-сервис недоступен.
_VISION_GROUNDING: bool = str(
    getattr(settings, "ILLUSTRATION_VISION_GROUNDING", os.getenv("ILLUSTRATION_VISION_GROUNDING", "1"))
).strip().lower() not in ("0", "false", "no", "")
# На сколько процентов поднять текст подписи над центром объекта (чтобы текст
# стоял НАД объектом, как подпись, а не закрывал его). arrow_to при этом —
# точно центр объекта (туда указывают точка и линия в ScientificIllustration).
_GROUNDING_LABEL_RISE_PCT: float = float(getattr(settings, "ILLUSTRATION_GROUNDING_RISE_PCT", 7.0))

# Точность vision-грунтинга (эмпирически замерено на живом Qwen):
#   • разрешение картинки для Qwen: 384px давал 0 попаданий, ~800-1024px → норм.
#     НЕ переиспользуем SAM2-даунскейл (384) — для координат он слишком мелкий;
#   • координатная СЕТКА поверх картинки (Set-of-Mark): ошибка 9% → 0.5%. Модель
#     СЧИТЫВАЕТ координаты по сетке, а не «гадает» (VLM тянет координаты к
#     диагонали/углам). Сетка наносится ТОЛЬКО на копию для Qwen, не на ответ.
_GROUNDING_MAX_DIM: int = int(getattr(settings, "ILLUSTRATION_GROUNDING_MAX_DIM", 1024))
_GROUNDING_USE_GRID: bool = str(
    getattr(settings, "ILLUSTRATION_GROUNDING_USE_GRID", os.getenv("ILLUSTRATION_GROUNDING_USE_GRID", "1"))
).strip().lower() not in ("0", "false", "no", "")

_GRID_N: int = int(getattr(settings, "ILLUSTRATION_GRID_N", 3))
_MAX_OBJECTS: int = int(getattr(settings, "ILLUSTRATION_MAX_OBJECTS", 6))
# Воркеры для Qwen-подписей (лёгкие vision-запросы на маленьких фрагментах —
# параллелятся гораздо лучше тяжёлой SAM2-сегментации, см. _SAM2_MAX_WORKERS)
_MAX_WORKERS: int = int(getattr(settings, "ILLUSTRATION_MAX_WORKERS", 4))

# Дедупликация масок: если ОДНА из пары перекрывается с другой больше чем на
# столько (см. _overlap_ratio — это НЕ IoU, а доля МЕНЬШЕЙ маски, покрытая
# большей), считаем их одним объектом и оставляем точную/маленькую версию.
# Почему не IoU: он зависит от соотношения площадей и потому "слеп" именно к
# тому браку SAM2, который и нужно ловить — маске-"всё сразу" (см. находку в
# этой сессии: маска на 82% кадра давала с маской куба IoU ≈ 0.12 — ниже
# порога 0.6 и потому не дедуплицировалась, хотя содержала его целиком).
_DEDUPE_OVERLAP_THRESHOLD = 0.6
# Маски за пределами этого диапазона площади — это либо шум, либо весь фон
_MIN_AREA_RATIO = 0.015
_MAX_AREA_RATIO = 0.85

# Палитра контуров — приглушённые, гармонируют с IMAGE_STYLE_GUIDE
# (мягкая пастельная палитра единого стиля иллюстраций)
_OUTLINE_COLORS = ["#5b8def", "#ef9a6b", "#7fb88a", "#caa6e0", "#e0a3b0", "#9bb3c4"]


# ──────────────────────────────────────────────────────────────────
# Кодирование / декодирование изображений
# ──────────────────────────────────────────────────────────────────

def _image_url_to_bgr(image_url: str) -> np.ndarray:
    """Data URL ('data:image/...;base64,...') или http(s) URL → OpenCV BGR ndarray."""
    if image_url.startswith("data:"):
        _, _, b64_part = image_url.partition(",")
        raw = base64.b64decode(b64_part)
    else:
        resp = requests.get(image_url, timeout=30)
        resp.raise_for_status()
        raw = resp.content

    arr = np.frombuffer(raw, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Не удалось декодировать сгенерированное изображение")
    return img


def _bgr_to_png_b64(img: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", img)
    if not ok:
        raise ValueError("Не удалось закодировать изображение в PNG")
    return base64.b64encode(buf).decode("ascii")


def _downscale_for_sam2(img_bgr: np.ndarray) -> np.ndarray:
    """
    Уменьшает копию изображения для отправки в SAM2 — длинная сторона
    не больше `_SAM2_MAX_DIM`.

    КЛЮЧЕВАЯ оптимизация по результатам нагрузочного теста на реальной
    сгенерированной иллюстрации (1408×768): один запрос к SAM2 на полном
    разрешении занимает ≈28 СЕКУНД, а на копии 384×~210 — ≈3 секунды
    (10-кратное ускорение, score маски не отличается — у обеих ~0.99).
    Этого с запасом достаточно для поиска объектов: контур всё равно
    упрощается на этапе сборки SVG (`_mask_to_svg_path_d`), а пиксельная
    точность контура источника, по сути, не используется напрямую — важна
    лишь сама геометрия найденного объекта. Маски затем растягиваются
    обратно к оригинальному разрешению через `_upscale_mask`, и весь
    дальнейший расчёт (bbox, IoU, контуры, обрезка для Qwen) идёт уже в
    исходных координатах — на итоговое качество SVG это не влияет.

    Если изображение и так меньше `_SAM2_MAX_DIM` — возвращает как есть.
    """
    h, w = img_bgr.shape[:2]
    scale = min(1.0, _SAM2_MAX_DIM / float(max(h, w)))
    if scale >= 0.999:
        return img_bgr
    new_w, new_h = max(1, round(w * scale)), max(1, round(h * scale))
    return cv2.resize(img_bgr, (new_w, new_h), interpolation=cv2.INTER_AREA)


def _upscale_mask(mask: np.ndarray, target_w: int, target_h: int) -> np.ndarray:
    """Растягивает маску (полученную для уменьшенной копии) обратно к исходному разрешению."""
    if mask.shape[1] == target_w and mask.shape[0] == target_h:
        return mask
    return cv2.resize(mask, (target_w, target_h), interpolation=cv2.INTER_NEAREST)


# ──────────────────────────────────────────────────────────────────
# [2] SAM 2 — сегментация по сетке стартовых точек
# ──────────────────────────────────────────────────────────────────

def _grid_points(width: int, height: int, n: int) -> list[tuple[int, int]]:
    """
    Равномерная сетка n×n точек СТРОГО внутри изображения (с отступом
    от краёв в половину ячейки — края обычно фон, а не объекты).
    """
    xs = np.linspace(width * 0.5 / n, width * (n - 0.5) / n, n)
    ys = np.linspace(height * 0.5 / n, height * (n - 0.5) / n, n)
    return [(int(round(x)), int(round(y))) for y in ys for x in xs]


def _sam2_segment_point(image_b64: str, point: tuple[int, int]) -> dict | None:
    """
    Запрашивает у SAM2 маску для ОДНОЙ foreground-точки.

    Контракт сервиса (см. /openapi.json на :8002):
        POST /api/segment/  {image_base64, points: [[x,y],...], labels: [1|0,...]}
        →  {mask_base64: "<PNG bool-маска>", score: float}

    Returns None при любой ошибке (сеть/таймаут/пустой ответ) — кандидат
    просто выпадает из выборки, пайплайн продолжает работу с остальными.
    """
    try:
        resp = requests.post(
            _SAM2_API_URL,
            json={"image_base64": image_b64, "points": [[point[0], point[1]]], "labels": [1]},
            timeout=_SAM2_TIMEOUT,
        )
        resp.raise_for_status()
        data = resp.json()
        mask_png = base64.b64decode(data["mask_base64"])
        mask = cv2.imdecode(np.frombuffer(mask_png, np.uint8), cv2.IMREAD_GRAYSCALE)
        if mask is None:
            return None
        return {"mask": mask, "score": float(data.get("score", 0.0)), "seed_point": point}
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Illustration] SAM2 segment(point=%s) failed: %s", point, exc)
        return None


def _mask_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.where(mask > 127)
    if xs.size == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


# Если bbox маски занимает СТОЛЬКО от ширины И от высоты кадра — это не
# отдельный объект, а "вся сцена" (см. _looks_like_background_mask).
_FULL_FRAME_BBOX_RATIO = 0.92


def _looks_like_background_mask(bbox: tuple[int, int, int, int], width: int, height: int) -> bool:
    """
    True, если bbox маски растянут почти на весь кадр И по ширине, И по
    высоте одновременно — геометрический "отпечаток" маски ФОНА, а не
    отдельного объекта.

    Зачем это нужно (находка этой сессии, см. диагностику с ASCII-отрисовкой
    масок): когда стартовая точка попадает на фон (а не на объект), SAM2
    совершенно ОБОСНОВАННО сегментирует именно фон — связную область "кадр
    минус объекты" (буквально: сплошная заливка с вырезанными в ней силуэтами
    куба и сферы). Это валидная сегментация по своей природе, просто не
    объект, а его дополнение — поэтому:
      • площадь (≈82%) проходит общий фильтр _MAX_AREA_RATIO (0.85) —
        одного только порога по площади недостаточно;
      • _overlap_ratio с масками настоящих объектов был РОВНО 0.000 (это
        ДОПОЛНЕНИЕ объектов, а не контейнер) — дедупликация по перекрытию
        тоже не помогает, нужна отдельная геометрическая проверка.

    Почему именно bbox, а не, скажем, площадь или касание краёв: фоновая
    маска тянется от края до края кадра ПО ОБЕИМ ОСЯМ почти всегда (фон
    окружает объекты со всех сторон), тогда как одиночный объект в стиле
    "generous negative space" (см. IMAGE_STYLE_GUIDE) — нет (проверено: bbox
    куба и сферы — 24%×51% и 21%×39% от кадра, оба далеко за порогом 0.92;
    а у фоновой маски — 100%×99.6%). Касание краёв пиксель-в-пиксель ловить
    не стали — у самой фоновой маски на тестовом изображении верхняя и
    нижняя кромки на 1-3px не дотягивали до краёв (артефакт точности маски).
    """
    x0, y0, x1, y1 = bbox
    return (x1 - x0 + 1) >= _FULL_FRAME_BBOX_RATIO * width \
        and (y1 - y0 + 1) >= _FULL_FRAME_BBOX_RATIO * height


def _overlap_ratio(mask_a: np.ndarray, mask_b: np.ndarray) -> float:
    """
    Доля МЕНЬШЕЙ из двух масок, перекрывающаяся с другой:
    intersection / min(area_a, area_b).

    Сознательно НЕ IoU (intersection / union) — та делит на СУММАРНУЮ площадь
    и потому даёт низкое значение для пары "точная маска объекта" + "маска,
    целиком содержащая этот объект внутри себя плюс ещё много всего" (даже
    при ПОЛНОМ включении меньшей в большую: пример из этой сессии — маска
    на 82% кадра содержала маску куба (9.6% кадра) целиком, но IoU между
    ними был лишь ≈0.12, заметно ниже порога дедупликации 0.6).

    `_overlap_ratio` свободен от этого изъяна: при полном включении меньшей
    маски в большую (неважно, во сколько раз большая крупнее) он даёт ≈1.0,
    как и для двух почти идентичных масок одного размера — то есть ловит
    ОБА сценария дублирования, которые нужно ловить:
      • "тот же объект найден из двух разных стартовых точек" (масштабы и
        формы близки → intersection ≈ area_a ≈ area_b);
      • "SAM2 по неоднозначной точке (на стыке/тени между объектами) отдал
        маску-„всё сразу“, целиком содержащую уже найденный точный объект".
    """
    a = mask_a > 127
    b = mask_b > 127
    smaller = min(int(a.sum()), int(b.sum()))
    if smaller == 0:
        return 0.0
    return float(np.logical_and(a, b).sum()) / float(smaller)


def _content_seed_points(img_bgr: np.ndarray, max_points: int = 14) -> list[tuple[int, int]]:
    """
    ОСНОВНОЙ источник стартовых точек: отделяет фон от содержимого и находит
    "ядра" объектов через пик-детекцию на distance transform — это надёжно
    разделяет даже визуально СОПРИКАСАЮЩИЕСЯ объекты (см. ниже, почему это
    важно именно для нашего стиля генерации).

    Почему не просто центроиды связных областей (предыдущая версия этой
    функции; и почему не просто сетка):

      • Сетка: эмпирически проверено в этой сессии — сетка 4×4 (узлы раз в
        150px) на сцене с тремя некрупными фигурами в разных углах поймала
        только ОДНУ из них, две другие провалились "между" точками.
        Регулярная сетка хорошо покрывает один крупный центральный объект,
        но плохо — несколько мелких разбросанных, а именно так обычно
        выглядит учебная иллюстрация ("нарисуй куб и сферу" и т.п.).

      • Простые центроиды связных областей: тоже проверено эмпирически —
        на РЕАЛЬНОЙ сгенерированной иллюстрации (куб + сфера на пастельной
        студийной подложке) их мягкие контактные тени сливаются в одно
        связное пятно (типичная черта стиля "soft studio lighting" из
        IMAGE_STYLE_GUIDE!), и наивный подход даёт ОДНУ точку где-то между
        объектами → SAM2 сегментирует их обоих как один блоб (82% кадра).

    Решение — то же, что в классическом watershed-разделении смежных
    объектов: считаем distance transform (значение пикселя = расстояние до
    ближайшей фоновой точки — получается "карта высот", где каждый объект
    образует свой пик в самой "толстой" своей части), и берём ЛОКАЛЬНЫЕ
    МАКСИМУМЫ этой карты. У слипшихся объектов остаются РАЗНЫЕ пики (с
    "перевалом" на стыке), поэтому они корректно разделяются — проверено:
    на той самой картинке с кубом и сферой получаем два чётких пика именно
    в их центрах, а не один между ними.

    Сам факт "отличается от фона" по-прежнему берём из той же мягкой
    эвристики (фон в нашем стиле — однотонный, см. IMAGE_STYLE_GUIDE:
    "plain neutral background"), но дальше работаем умнее, чем "один
    кандидат на связную область".

    Возвращает до `max_points` точек, отсортированных по убыванию "высоты"
    пика (= во сколько примерно объект толще/крупнее — крупные/уверенные
    кандидаты идут первыми).
    """
    h, w = img_bgr.shape[:2]
    border = max(2, min(h, w) // 25)
    border_px = np.concatenate([
        img_bgr[:border, :].reshape(-1, 3),
        img_bgr[-border:, :].reshape(-1, 3),
        img_bgr[:, :border].reshape(-1, 3),
        img_bgr[:, -border:].reshape(-1, 3),
    ]).astype(np.int16)
    bg_color = np.median(border_px, axis=0)

    diff = np.linalg.norm(img_bgr.astype(np.int16) - bg_color, axis=2)
    fg_mask = (diff > 28).astype(np.uint8)
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    fg_mask = cv2.morphologyEx(fg_mask, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    if not fg_mask.any():
        return []

    # "Карта высот": расстояние каждого fg-пикселя до ближайшего bg-пикселя.
    # Пик соответствует самой "толстой"/центральной части объекта — то есть
    # именно туда, куда и нужно поставить foreground-точку для SAM2.
    dist = cv2.distanceTransform(fg_mask, cv2.DIST_L2, 5)
    if dist.max() < 1.0:
        return []

    # Локальные максимумы: всё, что выше половины глобального пика. На
    # "перевале" между слипшимися объектами distance transform всегда
    # заметно ниже, чем в их ядрах — порог 0.5 устойчиво их разделяет
    # (проверено эмпирически на тестовых изображениях с touching-объектами).
    peak_mask = (dist > 0.5 * dist.max()).astype(np.uint8)
    n_labels, peak_labels, stats, _ = cv2.connectedComponentsWithStats(peak_mask, connectivity=8)

    total = float(w * h)
    found = []
    for i in range(1, n_labels):
        if stats[i, cv2.CC_STAT_AREA] < 4:
            continue  # шум — пик из одного-двух пикселей на тонком "мостике"
        ys, xs = np.where(peak_labels == i)
        cx, cy = int(round(float(xs.mean()))), int(round(float(ys.mean())))
        peak_height = float(dist[cy, cx])
        # Грубая оценка площади объекта по высоте его пика (≈ вписанный круг) —
        # для сортировки и финального фильтра по размеру вполне достаточно.
        approx_area_ratio = (np.pi * peak_height ** 2) / total
        if approx_area_ratio > _MAX_AREA_RATIO:
            continue
        found.append((peak_height, cx, cy))

    found.sort(reverse=True)
    return [(x, y) for _, x, y in found[:max_points]]


def _collect_distinct_objects(img_bgr: np.ndarray) -> list[dict]:
    """
    Находит различимые объекты на изображении. Источники стартовых точек —
    ГИБРИД (см. обоснование в `_content_seed_points`):
      (a) ОСНОВНОЙ: центроиды "не-фоновых" связных областей — находит
          объекты напрямую, независимо от их размера и положения;
      (b) ПОДСТРАХОВКА: регулярная сетка — на случай текстурного фона
          или слияния цветов, когда (a) не сработает как надо.

    Дальше:
      1. бросает все точки в SAM2 параллельно (ThreadPoolExecutor)
      2. отбрасывает маски-шум (слишком маленькие) и маски-фон (почти весь кадр)
      3. дедуплицирует совпадающие/вложенные маски по _overlap_ratio, идя от
         САМЫХ МАЛЕНЬКИХ к большим (одна и та же фигура часто находится с
         нескольких разных стартовых точек внутри неё — а вдобавок SAM2
         иногда отдаёт маску-„всё сразу“ для неоднозначной точки на стыке
         между объектами; обработка по возрастанию площади гарантирует, что
         точная маленькая маска объекта будет принята РАНЬШЕ такой большой
         маски-контейнера и вытеснит её — см. докстринг _overlap_ratio,
         почему для этого не годится IoU, и находку в этой сессии, где
         маска на 82% кадра пережила IoU-дедупликацию против куба и сферы)
      4. сортирует по уверенности (score) и оставляет не более _MAX_OBJECTS

    Возвращает список {mask, score, seed_point, bbox, area_ratio},
    отсортированный по убыванию score.
    """
    height, width = img_bgr.shape[:2]

    # Уменьшенная копия для SAM2 — критично для скорости (см. _downscale_for_sam2:
    # 28с/запрос на полном разрешении против ~3с на копии). Все стартовые точки
    # считаем сразу в её системе координат — после получения маски растягиваем
    # обратно к исходному разрешению (_upscale_mask), и далее везде работаем
    # в оригинальных координатах.
    sam_img = _downscale_for_sam2(img_bgr)
    sam_h, sam_w = sam_img.shape[:2]
    image_b64 = _bgr_to_png_b64(sam_img)
    logger.info(
        "[Illustration] для SAM2 используем копию %dx%d (оригинал %dx%d)",
        sam_w, sam_h, width, height,
    )

    content_points = _content_seed_points(sam_img)
    grid_candidates = _grid_points(sam_w, sam_h, _GRID_N)

    # Узел сетки добавляем, только если он не дублирует уже найденную
    # content-aware точку — экономим вызовы SAM2 (каждый стоит несколько
    # секунд, и сервис почти не выигрывает от распараллеливания, см. ниже)
    min_gap = min(sam_w, sam_h) / (2.0 * _GRID_N)
    points = list(content_points)
    for gp in grid_candidates:
        if all((gp[0] - sx) ** 2 + (gp[1] - sy) ** 2 > min_gap ** 2 for sx, sy in points):
            points.append(gp)

    logger.info(
        "[Illustration] стартовые точки: %d content-aware + %d из сетки = %d итого",
        len(content_points), len(points) - len(content_points), len(points),
    )

    total_area = float(width * height)
    candidates: list[dict] = []

    # ВАЖНО: SAM2-сервис почти не выигрывает от параллелизма — эмпирически
    # измерено, что 4 одновременных запроса замедляют КАЖДЫЙ в 3-5 раз и не
    # дают выигрыша по суммарному времени, плюс резко повышают риск таймаутов
    # (в одном из тестов burst на ~20 точек уложил все запросы в таймаут).
    # Поэтому здесь намеренно низкий `_SAM2_MAX_WORKERS` (по умолчанию 2).
    with ThreadPoolExecutor(max_workers=_SAM2_MAX_WORKERS) as pool:
        futures = [pool.submit(_sam2_segment_point, image_b64, pt) for pt in points]
        for future in as_completed(futures):
            res = future.result()
            if res is not None:
                res["mask"] = _upscale_mask(res["mask"], width, height)
                candidates.append(res)

    logger.info(
        "[Illustration] SAM2: %d/%d стартовых точек дали маску",
        len(candidates), len(points),
    )

    # Сначала — общий фильтр по размеру/форме (шум, фон, "вся сцена"), без сортировки.
    valid: list[dict] = []
    n_bg = 0
    for cand in candidates:
        mask = cand["mask"]
        area_ratio = float((mask > 127).sum()) / total_area
        if area_ratio < _MIN_AREA_RATIO or area_ratio > _MAX_AREA_RATIO:
            continue  # шум или почти весь кадр
        bbox = _mask_bbox(mask)
        if bbox is None:
            continue
        if _looks_like_background_mask(bbox, width, height):
            # Точка-затравка попала на фон — SAM2 честно сегментировал именно
            # его (см. докстринг _looks_like_background_mask и диагностику в
            # этой сессии: ascii-отрисовка показала ровно "кадр с двумя
            # дырками", а не объект). И по площади (≈82% < 0.85), и по IoU/
            # overlap_ratio с настоящими объектами (= 0, это их ДОПОЛНЕНИЕ,
            # а не дубликат) такая маска проходит мимо остальных фильтров —
            # нужна именно эта геометрическая проверка.
            n_bg += 1
            continue
        cand["bbox"] = bbox
        cand["area_ratio"] = area_ratio
        valid.append(cand)

    if n_bg:
        logger.info(
            "[Illustration] отфильтровано %d маск(и) фона/всей сцены (точка попала не на объект)",
            n_bg,
        )

    # Дедупликация — ОБЯЗАТЕЛЬНО от меньших масок к большим (не по score!).
    # Так точная маска отдельного объекта попадает в `kept` ДО маски-контейнера,
    # которая её перекрывает, и подавляет последнюю через _overlap_ratio
    # (которая в обе стороны симметрична и не зависит от порядка сравнения —
    # порядок обхода важен только для того, КАКАЯ из дублирующейся пары
    # окажется "первой принятой", т.е. выживет).
    kept: list[dict] = []
    for cand in sorted(valid, key=lambda c: c["area_ratio"]):
        mask = cand["mask"]
        if any(_overlap_ratio(mask, k["mask"]) > _DEDUPE_OVERLAP_THRESHOLD for k in kept):
            continue  # дубликат/контейнер уже принятого (более точного) объекта
        kept.append(cand)

    # А вот ИТОГОВЫЙ порядок — по уверенности модели (как и раньше): так
    # подписи и SVG-контуры строятся для самых уверенных находок первыми,
    # а если претендентов больше _MAX_OBJECTS — отсекаем наименее уверенные.
    kept.sort(key=lambda c: -c["score"])
    kept = kept[:_MAX_OBJECTS]

    logger.info("[Illustration] После дедупликации: %d отдельных объектов", len(kept))
    return kept


def _collect_objects_from_labels(
    img_bgr: np.ndarray,
    seed_labels: list[dict],
) -> list[dict]:
    """
    Направляемая (prompted) сегментация — архитектура Figure Labs:
    передаём в SAM2 КОНКРЕТНЫЕ координаты из JSON-ответа Llama вместо
    слепого перебора сетки.

    Каждый label содержит {content, x, y, arrow_to: {x, y}} — все координаты
    в ПРОЦЕНТАХ (0-100) от размера изображения. Используем `arrow_to`
    (указывает на сам объект) если есть, иначе `x`/`y` (позиция текста).

    SAM2 видит точку и математически вырезает границы объекта, на который
    она указывает — независимо от стиля изображения (3D, flat, sketch...).

    Лейблы уже известны из Llama (`content`) — Qwen для этого пути не нужен.
    Возвращает тот же формат, что _collect_distinct_objects, с дополнительным
    полем `label` (текст из Llama).
    """
    height, width = img_bgr.shape[:2]

    sam_img = _downscale_for_sam2(img_bgr)
    sam_h, sam_w = sam_img.shape[:2]
    image_b64 = _bgr_to_png_b64(sam_img)
    total_area = float(width * height)

    # Преобразуем проценты → пиксели в системе координат уменьшенного изображения
    points_with_content: list[tuple[int, int, str]] = []
    for lbl in seed_labels:
        arrow = lbl.get("arrow_to") or lbl
        x_pct = float(arrow.get("x", lbl.get("x", 50)))
        y_pct = float(arrow.get("y", lbl.get("y", 50)))
        px = int(max(1, min(sam_w - 2, x_pct * sam_w / 100.0)))
        py = int(max(1, min(sam_h - 2, y_pct * sam_h / 100.0)))
        content = str(lbl.get("content") or lbl.get("text") or "Объект").strip()
        points_with_content.append((px, py, content))

    logger.info(
        "[Illustration] Prompted SAM2: %d точек из Llama labels → %s",
        len(points_with_content),
        [(x, y, c) for x, y, c in points_with_content],
    )

    with ThreadPoolExecutor(max_workers=_SAM2_MAX_WORKERS) as pool:
        future_to_content = {
            pool.submit(_sam2_segment_point, image_b64, (px, py)): content
            for px, py, content in points_with_content
        }
        candidates: list[dict] = []
        for future, content in future_to_content.items():
            res = future.result()
            if res is not None:
                res["mask"] = _upscale_mask(res["mask"], width, height)
                res["label"] = content  # уже знаем из Llama — Qwen не нужен
                candidates.append(res)

    logger.info(
        "[Illustration] Prompted SAM2: %d/%d точек дали маску",
        len(candidates), len(points_with_content),
    )

    # Те же фильтры, что в _collect_distinct_objects (шум, фон, слипшиеся)
    valid: list[dict] = []
    for cand in candidates:
        mask = cand["mask"]
        area_ratio = float((mask > 127).sum()) / total_area
        if area_ratio < _MIN_AREA_RATIO or area_ratio > _MAX_AREA_RATIO:
            continue
        bbox = _mask_bbox(mask)
        if bbox is None:
            continue
        if _looks_like_background_mask(bbox, width, height):
            continue
        cand["bbox"] = bbox
        cand["area_ratio"] = area_ratio
        valid.append(cand)

    if not valid:
        logger.info("[Illustration] Prompted SAM2: все маски отфильтрованы (фон/шум)")
        return []

    # Дедупликация: от меньших масок к большим (как в _collect_distinct_objects)
    valid.sort(key=lambda c: (c["mask"] > 127).sum())
    kept: list[dict] = []
    for cand in valid:
        if all(_overlap_ratio(cand["mask"], k["mask"]) < 0.5 for k in kept):
            kept.append(cand)

    kept.sort(key=lambda c: -c["score"])
    kept = kept[:_MAX_OBJECTS]

    logger.info("[Illustration] Prompted SAM2 итого: %d объектов", len(kept))
    return kept


# ──────────────────────────────────────────────────────────────────
# [3] Qwen — короткая подпись для вырезанного фрагмента-объекта
# ──────────────────────────────────────────────────────────────────

def _qwen_label_crop(img_bgr: np.ndarray, bbox: tuple[int, int, int, int], topic_hint: str) -> str:
    """
    Просит Qwen (vision) дать короткую (1-3 слова) русскую подпись для
    ОДНОГО вырезанного объекта — модели показывают маленький сфокусированный
    фрагмент вместо полной сцены, потому что определять "что это" по
    крупному плану VLM умеют гораздо надёжнее, чем оценивать координаты
    на полной картинке (см. объяснение в шапке модуля).
    """
    x0, y0, x1, y1 = bbox
    pad = int(0.15 * max(x1 - x0, y1 - y0, 1))
    h, w = img_bgr.shape[:2]
    crop = img_bgr[max(0, y0 - pad):min(h, y1 + pad), max(0, x0 - pad):min(w, x1 + pad)]
    if crop.size == 0:
        return "Объект"

    try:
        crop_b64 = _bgr_to_png_b64(crop)
    except Exception:
        return "Объект"

    topic_line = f" Тема иллюстрации: «{topic_hint}»." if topic_hint else ""
    prompt = (
        "На картинке — один вырезанный объект из научной иллюстрации."
        f"{topic_line} Дай ему короткую подпись для учебной схемы "
        "(1-3 слова, на русском, как в учебнике, с заглавной буквы). "
        "Ответь ТОЛЬКО подписью, без точки, кавычек и пояснений."
    )

    try:
        resp = requests.post(
            f"{_QWEN_API_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {_QWEN_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": _QWEN_MODEL_NAME,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{crop_b64}"}},
                    ],
                }],
                "max_tokens": 24,
                "temperature": 0.2,
            },
            timeout=_QWEN_TIMEOUT,
        )
        resp.raise_for_status()
        label = resp.json()["choices"][0]["message"]["content"].strip()
        label = label.strip(' \t\n."\'«»').splitlines()[0][:60]
        return label or "Объект"
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Illustration] Qwen label(bbox=%s) failed: %s", bbox, exc)
        return "Объект"


def _label_objects(img_bgr: np.ndarray, objects: list[dict], topic_hint: str) -> None:
    """Параллельно проставляет `label` каждому объекту (мутирует список на месте)."""
    with ThreadPoolExecutor(max_workers=_MAX_WORKERS) as pool:
        future_to_obj = {
            pool.submit(_qwen_label_crop, img_bgr, obj["bbox"], topic_hint): obj
            for obj in objects
        }
        for future in as_completed(future_to_obj):
            future_to_obj[future]["label"] = future.result()


# ──────────────────────────────────────────────────────────────────
# [1.5] Vision-грунтинг координат подписей
# ──────────────────────────────────────────────────────────────────
# Почему это нужно: координаты подписей (x/y, arrow_to) придумывает Llama ДО
# того, как Banana нарисует картинку, — это её догадка «где примерно объект»,
# а не реальное положение на сгенерированном растре. Поэтому подписи «летают».
# Решение: показываем Qwen (vision) ГОТОВУЮ картинку + список объектов и просим
# вернуть их РЕАЛЬНЫЕ центры в процентах. Туда и переносим указатель подписи.

def _resize_long_side(img_bgr: np.ndarray, max_dim: int) -> np.ndarray:
    """Ресайз так, чтобы длинная сторона = max_dim (если картинка больше)."""
    h, w = img_bgr.shape[:2]
    s = min(1.0, max_dim / float(max(h, w)))
    if s >= 0.999:
        return img_bgr
    return cv2.resize(img_bgr, (max(1, round(w * s)), max(1, round(h * s))), interpolation=cv2.INTER_AREA)


def _overlay_coord_grid(img_bgr: np.ndarray) -> np.ndarray:
    """
    Наносит светлую координатную сетку (линии каждые 10%, подписи 0..100 по
    верхней и левой осям) — «измерительные леса» ТОЛЬКО для vision-запроса.
    На итоговую картинку пользователю НЕ попадает.

    Эмпирически (замер на живом Qwen): сетка роняет ошибку координат с ~9% до
    ~0.5% — модель СЧИТЫВАЕТ позицию по сетке вместо «гадания» (без сетки VLM
    систематически тянет координаты к диагонали/углам).
    """
    h, w = img_bgr.shape[:2]
    g = img_bgr.copy()
    for p in range(10, 100, 10):
        x, y = int(p / 100 * w), int(p / 100 * h)
        cv2.line(g, (x, 0), (x, h), (180, 180, 180), 1, cv2.LINE_AA)
        cv2.line(g, (0, y), (w, y), (180, 180, 180), 1, cv2.LINE_AA)
        cv2.putText(g, str(p), (x + 2, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (110, 110, 110), 1, cv2.LINE_AA)
        cv2.putText(g, str(p), (2, max(12, y - 3)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (110, 110, 110), 1, cv2.LINE_AA)
    return g


def _norm_name(s: Any) -> str:
    """Нормализация имени для матчинга: NFC + lower + strip (устойчиво к й/ё и регистру)."""
    return unicodedata.normalize("NFC", str(s)).strip().lower()


def _parse_grounding_json(raw: str) -> list[tuple[str, float, float]]:
    """
    Парсит ответ Qwen в УПОРЯДОЧЕННЫЙ список [(имя_norm, x%, y%), ...] —
    порядок сохраняем, чтобы можно было сматчить позиционно, если имена не
    совпали буквально. Терпим к мусору: пробует чистый JSON, затем вырезает
    первый [...]-массив. Координаты вне 0-100 отбрасываются.
    """
    if not raw:
        return []
    txt = raw.replace("```json", "").replace("```", "").strip()
    data: Any = None
    try:
        data = json.loads(txt)
    except Exception:
        m = re.search(r"\[.*\]", txt, re.S)
        if m:
            try:
                data = json.loads(m.group(0))
            except Exception:
                return []
    if not isinstance(data, list):
        return []

    out: list[tuple[str, float, float]] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        name = _norm_name(item.get("name") or item.get("content") or item.get("label") or "")
        try:
            x = float(item.get("x"))
            y = float(item.get("y"))
        except (TypeError, ValueError):
            continue
        if 0.0 <= x <= 100.0 and 0.0 <= y <= 100.0:
            out.append((name, x, y))
    return out


def _ground_labels_with_vision(
    img_bgr: np.ndarray,
    labels: list[dict],
    topic_hint: str = "",
) -> list[dict]:
    """
    Спрашивает у Qwen (vision) РЕАЛЬНЫЕ позиции объектов на сгенерированной
    картинке и возвращает НОВЫЙ список подписей с уточнёнными координатами:
      • arrow_to        → точный центр объекта (туда смотрят точка и линия);
      • x / y (текст)   → чуть ВЫШЕ центра (_GROUNDING_LABEL_RISE_PCT), чтобы
                          подпись стояла над объектом, а не закрывала его.

    Деградация: подпись, которую Qwen не локализовал, остаётся с координатами
    Llama. При недоступности Qwen / нераспарсенном ответе — список возвращается
    как есть (пайплайн никогда не падает из-за грунтинга).
    """
    if not labels:
        return labels

    names = [str(l.get("content") or l.get("text") or "").strip() for l in labels]
    names = [n for n in names if n]
    if not names:
        return labels

    # Подготовка копии для Qwen. ВАЖНО (замер на живом Qwen): для координат нужна
    # НЕ мелкая (384 SAM2-копия давала 0 попаданий), а ~1024px + координатная
    # сетка — она роняет ошибку с ~9% до ~0.5% (см. _overlay_coord_grid).
    try:
        vis = _resize_long_side(img_bgr, _GROUNDING_MAX_DIM)
        if _GROUNDING_USE_GRID:
            vis = _overlay_coord_grid(vis)
        img_b64 = _bgr_to_png_b64(vis)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Illustration] grounding: не удалось подготовить картинку: %s", exc)
        return labels

    topic_line = f" Тема: «{topic_hint}»." if topic_hint else ""
    grid_line = (
        " На изображение нанесена координатная СЕТКА: тонкие серые линии каждые "
        "10%, по верхней и левой осям подписаны числа 0..100 (x: лево=0, право=100; "
        "y: верх=0, низ=100). СЧИТЫВАЙ координаты центра объекта ПО СЕТКЕ, не на глаз."
    ) if _GROUNDING_USE_GRID else (
        " Координаты в ПРОЦЕНТАХ: x — от ширины (0=левый край, 100=правый), "
        "y — от высоты (0=верх, 100=низ)."
    )
    # NB: НЕ просим «пропустить отсутствующие» — на сцене подписи часто
    # ПРОЦЕССЫ (испарение/осадки), а не предметы, и с «пропусти» Qwen выкидывал
    # их все. Просим центр ОБЛАСТИ процесса и ВСЕ объекты в ТОМ ЖЕ порядке/именах
    # — это даёт и матч по имени, и позиционный фолбэк.
    prompt = (
        "На изображении — научная иллюстрация." + topic_line + grid_line +
        " Для КАЖДОГО объекта/процесса из списка укажи координаты центра ОБЛАСТИ, "
        "где он показан (если это процесс — испарение, осадки и т.п. — укажи центр "
        "зоны, где он происходит: соответствующие стрелки/поток/элемент). "
        "Верни ВСЕ перечисленные пункты, СТРОГО в том же порядке и с теми же "
        "названиями. Список: " + "; ".join(names) + ". "
        'Ответь СТРОГО JSON-массивом [{"name":"<пункт>","x":<0-100>,"y":<0-100>}], '
        "без markdown и пояснений."
    )

    try:
        resp = requests.post(
            f"{_QWEN_API_BASE_URL}/chat/completions",
            headers={"Authorization": f"Bearer {_QWEN_API_KEY}", "Content-Type": "application/json"},
            json={
                "model": _QWEN_MODEL_NAME,
                "messages": [{
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}},
                    ],
                }],
                "max_tokens": 600,
                "temperature": 0.0,
            },
            timeout=_QWEN_TIMEOUT,
        )
        resp.raise_for_status()
        raw = resp.json()["choices"][0]["message"]["content"] or ""
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Illustration] grounding: Qwen недоступен, координаты Llama как есть: %s", exc)
        return labels

    located_list = _parse_grounding_json(raw)
    if not located_list:
        logger.info("[Illustration] grounding: Qwen ничего не локализовал, координаты Llama как есть")
        return labels
    by_name = {name: (x, y) for name, x, y in located_list}

    rise = _GROUNDING_LABEL_RISE_PCT
    grounded: list[dict] = []
    n_fixed = 0
    for i, lbl in enumerate(labels):
        new = dict(lbl)
        name = _norm_name(lbl.get("content") or lbl.get("text") or "")
        pos = by_name.get(name)
        # Фолбэк: если по имени не нашли, но Qwen вернул столько же пунктов в том
        # же порядке — берём позиционно (модель иногда чуть переформулирует имя).
        if pos is None and len(located_list) == len(labels):
            pos = (located_list[i][1], located_list[i][2])
        if pos is not None:
            ox, oy = pos
            new["arrow_to"] = {"x": round(ox, 1), "y": round(oy, 1)}
            new["x"] = round(ox, 1)
            new["y"] = round(min(96.0, max(4.0, oy - rise)), 1)
            n_fixed += 1
        grounded.append(new)

    logger.info(
        "[Illustration] grounding: уточнено %d/%d подписей по реальной картинке",
        n_fixed, len(labels),
    )
    return grounded


# ──────────────────────────────────────────────────────────────────
# [4] Контур маски → полигон в процентах (для наложения на доске)
# ──────────────────────────────────────────────────────────────────

def _mask_to_polygon_pct(
    mask: "np.ndarray", width: int, height: int, simplify_eps: float = 2.0
) -> list[list[float]] | None:
    """
    Внешний контур маски → упрощённый полигон в ПРОЦЕНТАХ от размеров
    изображения (0-100).

    Проценты, а не пиксели — чтобы фронтенд мог наложить контур поверх
    картинки ЛЮБОГО размера на доске (картинка масштабируется, полигон
    масштабируется вместе с ней без пересчёта на бэкенде).

    Упрощение (Дуглас-Пекер через cv2.approxPolyDP) обязательно: сырой
    контур SAM2 может содержать тысячи точек — после упрощения остаются
    только «углы» фигуры, JSON остаётся компактным.
    """
    binary = (mask > 127).astype(np.uint8)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    contour = max(contours, key=cv2.contourArea)
    approx = cv2.approxPolyDP(contour, simplify_eps, True).reshape(-1, 2)
    if len(approx) < 3:
        return None

    return [
        [round(float(x) / width * 100, 2), round(float(y) / height * 100, 2)]
        for x, y in approx
    ]
# ──────────────────────────────────────────────────────────────────
# Публичный пайплайн
# ──────────────────────────────────────────────────────────────────

def build_vector_illustration(
    image_prompt: str,
    topic_hint: str = "",
    seed_labels: list[dict] | None = None,
    requires_segmentation: bool = False,
    style: str | None = None,
    palette: str | None = None,
    reference_image_url: str | None = None,
) -> dict[str, Any]:
    """
    Пайплайн генерации иллюстрации с НАПРАВЛЯЕМОЙ (prompted) сегментацией —
    архитектура в духе Figure Labs.

    Главный принцип: ОРИГИНАЛЬНАЯ картинка от Banana НИКОГДА не теряется.
    Она всегда возвращается как `base_image_url`, а сегментация — лишь
    опциональное дополнение поверх неё.

      [1] ВСЕГДА генерируем растр через Banana → base_image_url.
      [2] Сегментация управляется флагом `requires_segmentation`:
          • False (пейзажи, сцены, процессы — «круговорот воды»):
            SAM2 НЕ вызываем, masks=None. Фронтенд показывает чистую
            картинку + подписи Llama. Это основной, быстрый путь.
          • True (нужно выделить ОТДЕЛЬНЫЕ объекты — органеллы клетки,
            детали механизма, геом. тела): берём координаты подписей Llama
            (arrow_to/x,y — в процентах) как seed points для SAM2, получаем
            точные маски ровно тех объектов, на которые указывает учитель,
            и отдаём их как полигоны в процентах (фронтенд рисует подсветку
            поверх картинки).

    Args:
        image_prompt:          описание содержимого (англ.) — что нарисовать.
        topic_hint:            тема урока (зарезервировано под уточнение
                               подписей; для prompted-пути не используется —
                               подписи уже есть от Llama).
        seed_labels:           подписи Llama [{content, x, y, arrow_to:{x,y}}],
                               координаты в процентах. Seed points для SAM2.
        requires_segmentation: запускать ли SAM2 (решение принимает Llama).
        style:                 id стиля с фронтенда (flat/2_5d/3d/sketch) —
                               прокидывается в generate_raster_image.
        palette:               id палитры с фронтенда (he_inspired/…).
        reference_image_url:   URL/Data URL существующей картинки на доске — при
                               смене стиля. Когда задан, этап [1] идёт в режиме
                               нативного image-to-image (edit) у Gemini/Nano Banana
                               и сохраняет композицию (см. generate_raster_image).

    Returns:
        {
          "base_image_url": "data:image/...;base64,..." | None,  # ВСЕГДА при успехе
          "labels": [ {content, x, y, arrow_to:{x,y}}, ... ],    # присутствует, если
                                                                 # были seed_labels: координаты
                                                                 # УТОЧНЕНЫ vision-грунтингом
                                                                 # по реальной картинке (Qwen),
                                                                 # либо как у Llama при сбое/выкл.
          "masks": [                                              # None если сегментация
            {"label": str, "polygon": [[x%,y%],...],              # не запрашивалась/не дала
             "bbox_pct": [x0%,y0%,x1%,y1%], "color": str,         # результата
             "score": float}, ...
          ] | None,
          "pipeline_error": str,   # присутствует только при сбое
        }

    Никогда не бросает исключения наружу — деградирует постепенно:
    если SAM2 не сработал, всё равно возвращается base_image_url (masks=None).
    Полный сбой возможен только на этапе [1] (генерация растра).
    """
    result: dict[str, Any] = {"base_image_url": None, "masks": None}

    # ── [1] Растр через Banana — ВСЕГДА, это основа ответа ──
    try:
        image_url = generate_raster_image(
            image_prompt,
            style=style,
            palette=palette,
            reference_image_url=reference_image_url,
        )
        result["base_image_url"] = image_url
    except Exception as exc:  # noqa: BLE001
        logger.error("[Illustration] Генерация растра не удалась: %s", exc, exc_info=True)
        result["pipeline_error"] = f"Генерация изображения не удалась: {exc}"
        return result

    # ── [1.5] Vision-грунтинг координат подписей (для ЛЮБЫХ иллюстраций) ──
    # Координаты Llama — догадка, сделанная ДО генерации; уточняем их по РЕАЛЬНОЙ
    # картинке через Qwen. Работает и для сцен без сегментации («круговорот воды»).
    # img_bgr декодируем здесь ОДИН раз и переиспользуем ниже для SAM2.
    img_bgr = None
    if seed_labels:
        if _VISION_GROUNDING:
            try:
                img_bgr = _image_url_to_bgr(image_url)
                # Грунтим: arrow_to → реальный центр объекта, текст — над ним.
                # Уточнённые координаты идут и в ответ, и (как seed) в SAM2 ниже.
                seed_labels = _ground_labels_with_vision(img_bgr, seed_labels, topic_hint)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "[Illustration] vision-грунтинг не удался, координаты Llama как есть: %s", exc
                )
        result["labels"] = seed_labels

    # Сегментация не нужна (сцена/пейзаж/процесс) — отдаём картинку + (грунт.) подписи.
    if not requires_segmentation:
        logger.info(
            "[Illustration] requires_segmentation=False → base_image_url + подписи (SAM2 пропущен)"
        )
        return result

    if not seed_labels:
        logger.info(
            "[Illustration] requires_segmentation=True, но seed_labels пусты → SAM2 пропущен"
        )
        return result

    # ── [2] Декодируем растр для SAM2 (если ещё не декодировали в [1.5]) ──
    if img_bgr is None:
        try:
            img_bgr = _image_url_to_bgr(image_url)
        except Exception as exc:  # noqa: BLE001
            logger.warning("[Illustration] Декодирование растра не удалось, отдаём без масок: %s", exc)
            result["pipeline_error"] = f"Не удалось декодировать изображение для сегментации: {exc}"
            return result

    height, width = img_bgr.shape[:2]

    # ── [3] Направляемая сегментация: координаты Llama → seed points SAM2 ──
    try:
        logger.info(
            "[Illustration] Направляемая сегментация: %d seed_labels от Llama",
            len(seed_labels),
        )
        objects = _collect_objects_from_labels(img_bgr, seed_labels)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[Illustration] SAM2 сегментация не удалась, отдаём без масок: %s", exc)
        result["pipeline_error"] = f"Сегментация не удалась: {exc}"
        return result

    if not objects:
        logger.info("[Illustration] SAM2 не вернул масок по координатам подписей")
        result["pipeline_error"] = "SAM2 не нашёл объектов по координатам подписей"
        return result

    # ── [4] Маски SAM2 → полигоны в процентах (для наложения на доске) ──
    masks: list[dict] = []
    for i, obj in enumerate(objects):
        polygon = _mask_to_polygon_pct(obj["mask"], width, height)
        if not polygon:
            continue
        x0, y0, x1, y1 = obj["bbox"]
        masks.append({
            "label": obj.get("label", "Объект"),
            "polygon": polygon,
            "bbox_pct": [
                round(x0 / width * 100, 2),
                round(y0 / height * 100, 2),
                round(x1 / width * 100, 2),
                round(y1 / height * 100, 2),
            ],
            "color": _OUTLINE_COLORS[i % len(_OUTLINE_COLORS)],
            "score": round(obj["score"], 3),
        })

    result["masks"] = masks or None
    logger.info(
        "[Illustration] Готово: base_image_url + %d масок (полигоны в %%)",
        len(masks),
    )
    return result

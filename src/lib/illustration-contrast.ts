/**
 * illustration-contrast.ts
 * ────────────────────────────────────────────────────────────────────
 * Динамический контраст подписей поверх AI-иллюстраций — приём «нативной
 * врезки» текста, как в композитинге Figure Labs:
 *
 *   1. ЯРКОСТЬ ФОНА. Картинка от генератора каждый раз разная, поэтому
 *      цвет текста нельзя хардкодить. Изображение один раз читается в
 *      offscreen-canvas, и для каждой подписи сэмплируются пиксели ровно
 *      под её координатами (x/y в процентах → пиксели канваса). Яркость
 *      считается по классике: L = (0.299·R + 0.587·G + 0.114·B) / 255.
 *      L > 0.5 (светлый фон) → текст #1A1A1A; L < 0.5 (тёмный) → #F8F8F8.
 *
 *   2. АДАПТИВНЫЙ ОРЕОЛ (halo). Плотный многослойный text-shadow тоном фона
 *      «прорезает» стрелки и линии под текстом. НО ореол нужен не везде:
 *      на чистом однотонном фоне он смотрится грязным пятном (жалоба
 *      пользователя: «где-то нужна обводка, а где-то нет»). Поэтому вместе
 *      с яркостью сэмплируется НЕОДНОРОДНОСТЬ патча (std яркости):
 *        • пёстрый фон / граница / стрелки (σ высокая) → полный ореол;
 *        • средне-серый фон (текст слабо контрастен любым цветом) → ореол;
 *        • чистый светлый или тёмный фон → ореола НЕТ — голый текст
 *          выглядит нативно врезанным, как у Figure Labs.
 *      Именно text-shadow, а НЕ -webkit-text-stroke: stroke в HTML рисуется
 *      ПО ЦЕНТРУ контура глифа и при плотности 3-4px съедает сам шрифт;
 *      стопка теней даёт такой же плотный ореол, не трогая letterform.
 *
 * Производительность: ImageData декодируется ОДИН раз на src (модульный
 * LRU-кэш, см. _imageDataCache) и переиспользуется всеми подписями и
 * обоими рендерерами (ScientificIllustration и IllustrationRenderer).
 * Сэмплирование — чистая математика по готовому буферу, без re-decode.
 */

import { useEffect, useMemo, useState } from "react";
import type React from "react";

/** Точка сэмплирования: координаты в ПРОЦЕНТАХ (0–100) от размеров картинки. */
export interface SamplePoint {
  x: number;
  y: number;
}

/** Результат сэмплирования фона под одной подписью. */
export interface BackdropSample {
  /** Средняя яркость патча, 0..1 (Rec. 601). */
  luminance: number;
  /** Неоднородность фона: стандартное отклонение яркости в патче (0 = однотонный). */
  contrast: number;
}

/** Цвета текста по ТЗ: тёмный для светлого фона, светлый для тёмного. */
export const TEXT_ON_LIGHT = "#1A1A1A";
export const TEXT_ON_DARK = "#F8F8F8";

/**
 * Относительная яркость пикселя (Rec. 601), нормированная в 0..1.
 * L = (0.299·R + 0.587·G + 0.114·B) / 255
 */
export function relativeLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

function haloShadow(halo: string): string {
  // 8 слоёв с нарастающим blur: внутренние дают плотное ядро ореола
  // (имитация обводки), внешние — мягкое растворение в фон.
  return [2, 2, 3, 3, 4, 5, 7, 9].map((blur) => `0 0 ${blur}px ${halo}`).join(", ");
}

/**
 * Инлайн-стили подписи по измеренному фону под ней.
 *
 * Цвет текста — по яркости: светлый фон → #1A1A1A, тёмный → #F8F8F8.
 *
 * Ореол — АДАПТИВНЫЙ, тоном фона (его работа — маскировать стрелки,
 * растворяясь в подложке; белый ореол на тёмном фоне светился бы пятном):
 *   • сила = max(пёстрость фона, «среднесерость» фона);
 *   • пёстрость: σ яркости в патче — стрелки/границы/текстура дают высокую;
 *   • среднесерость: |L − 0.5| мало → любой цвет текста слабо контрастен,
 *     ореол нужен даже на однотонном фоне;
 *   • сила < 0.12 → ореола НЕТ совсем: на чистом фоне голый текст выглядит
 *     нативно врезанным (это и просил пользователь — без лишней обводки).
 *
 * `sample === null` (картинка ещё читается / CORS не дал пиксели) —
 * консервативный дефолт: тёмный текст + умеренный белый ореол. Наши сцены
 * генерятся на светлом фоне (см. SCENE_PROMPT_PREFIX), так что дефолт почти
 * всегда совпадает с финальным результатом — перескока цвета нет.
 */
function withCollisionBackdrop(
  styles: React.CSSProperties,
  sample: BackdropSample | null,
  enabled: boolean,
): React.CSSProperties {
  if (!enabled) return styles;
  const dark = (sample?.luminance ?? 1) < 0.58;
  return {
    ...styles,
    backgroundColor: dark ? "rgba(12, 16, 24, 0.96)" : "rgba(255, 255, 255, 0.96)",
    borderRadius: 4,
    padding: "2px 4px",
  };
}

export function contrastStylesFor(
  sample: BackdropSample | null,
  preventLineworkOverlap = false,
): React.CSSProperties {
  if (sample == null) {
    return withCollisionBackdrop(
      {
        color: TEXT_ON_LIGHT,
        textShadow: haloShadow("rgba(255, 255, 255, 0.85)"),
      },
      sample,
      preventLineworkOverlap,
    );
  }

  const { luminance, contrast } = sample;
  const darkBg = luminance < 0.58;
  const color = darkBg ? TEXT_ON_DARK : TEXT_ON_LIGHT;

  // Пёстрость: σ < 0.03 — практически однотонный фон; σ > 0.15 — граница/
  // стрелки/текстура (пороги подобраны по типичным значениям: чистое небо
  // на сгенерированных сценах даёт σ≈0.01-0.02, контур горы — σ≈0.2+).
  const busyness = clamp01((contrast - 0.03) / 0.12);
  // Среднесерость: L≈0.5 → и чёрный, и белый текст читаются плохо.
  const midTone = clamp01(1 - Math.abs(luminance - 0.5) * 2.5);
  const strength = Math.max(busyness, midTone);

  // Чистый фон с уверенным контрастом — без ореола: «нативная врезка».
  if (strength < 0.12) {
    return withCollisionBackdrop({ color }, sample, preventLineworkOverlap);
  }

  // Плотность ореола растёт с необходимостью: 0.3 (едва заметный) → 0.95.
  const alpha = 0.3 + 0.65 * strength;
  const halo = darkBg
    ? `rgba(10, 12, 16, ${alpha.toFixed(2)})`
    : `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
  return withCollisionBackdrop(
    { color, textShadow: haloShadow(halo) },
    sample,
    preventLineworkOverlap,
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Чтение картинки в ImageData (offscreen, один раз на src)
 * ──────────────────────────────────────────────────────────────────── */

// Длинная сторона рабочего канваса. Координаты подписей приходят с шагом
// ~0.1%, т.е. 320px даёт суб-процентную точность сэмплирования — при этом
// декодирование и getImageData почти бесплатны даже для тяжёлых картинок.
const MAX_DIM = 320;

// Радиус патча (в px канваса) вокруг точки подписи: подпись занимает
// область, а не пиксель, плюс одиночный пиксель — это шум (блик/контур).
// Патч 13×13 на 320px-канвасе ≈ 4% картинки — сопоставимо с реальной
// площадью текста подписи; этого хватает и для средней яркости, и для
// оценки неоднородности (σ): попавшая в патч стрелка/граница заметно
// поднимает σ и включает ореол.
const PATCH_RADIUS = 6;

// LRU-кэш декодированных ImageData по src: повторные вызовы хука (второй
// рендерер, обновление координат после vision-грунтинга) не декодируют
// картинку заново. Data URL от Banana — строки в мегабайты, поэтому кэп
// маленький: на доске одновременно живут единицы иллюстраций.
const _imageDataCache = new Map<string, ImageData>();
const _CACHE_CAP = 8;

function cacheGet(src: string): ImageData | undefined {
  const hit = _imageDataCache.get(src);
  if (hit) {
    // LRU: переставляем в конец Map (последний = самый свежий)
    _imageDataCache.delete(src);
    _imageDataCache.set(src, hit);
  }
  return hit;
}

function cachePut(src: string, data: ImageData): void {
  _imageDataCache.set(src, data);
  if (_imageDataCache.size > _CACHE_CAP) {
    const oldest = _imageDataCache.keys().next().value;
    if (oldest !== undefined) _imageDataCache.delete(oldest);
  }
}

function loadImage(src: string, cors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (cors) img.crossOrigin = "Anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src.slice(0, 80)}`));
    img.src = src;
  });
}

function drawToImageData(img: HTMLImageElement): ImageData {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const scale = Math.min(1, MAX_DIM / Math.max(w, h, 1));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, 0, 0, cw, ch);
  return ctx.getImageData(0, 0, cw, ch); // SecurityError, если canvas tainted
}

/**
 * src → ImageData с обходом CORS-tainting (тот же приём, что в
 * useVectorizeImage): сперва прямая загрузка с crossOrigin='Anonymous';
 * если canvas «запятнан» — fetch → Blob → Data URL (same-origin для Canvas).
 * Для data:-URL (наш основной случай — Banana отдаёт base64) работает
 * первая же попытка без всякого CORS.
 */
async function getImageDataForSrc(src: string): Promise<ImageData> {
  const cached = cacheGet(src);
  if (cached) return cached;

  let data: ImageData;
  try {
    data = drawToImageData(await loadImage(src, true));
  } catch {
    const response = await fetch(src, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const dataUrl: string = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    data = drawToImageData(await loadImage(dataUrl, false));
  }

  cachePut(src, data);
  return data;
}

/** Яркость (среднее) и неоднородность (σ) патча вокруг точки (px канваса). */
function sampleBackdropAt(data: ImageData, px: number, py: number): BackdropSample | null {
  const { width, height, data: buf } = data;
  const lums: number[] = [];
  for (let dy = -PATCH_RADIUS; dy <= PATCH_RADIUS; dy++) {
    for (let dx = -PATCH_RADIUS; dx <= PATCH_RADIUS; dx++) {
      const x = px + dx;
      const y = py + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const o = (y * width + x) * 4;
      // Прозрачные пиксели (PNG с альфой) бленднём на белую подложку доски —
      // под ними подпись фактически лежит на светлом фоне.
      const a = buf[o + 3] / 255;
      const r = buf[o] * a + 255 * (1 - a);
      const g = buf[o + 1] * a + 255 * (1 - a);
      const b = buf[o + 2] * a + 255 * (1 - a);
      lums.push(relativeLuminance(r, g, b));
    }
  }
  if (lums.length === 0) return null;
  const mean = lums.reduce((s, l) => s + l, 0) / lums.length;
  const variance = lums.reduce((s, l) => s + (l - mean) ** 2, 0) / lums.length;
  return { luminance: mean, contrast: Math.sqrt(variance) };
}

/* ────────────────────────────────────────────────────────────────────
 * Хук
 * ──────────────────────────────────────────────────────────────────── */

/* ────────────────────────────────────────────────────────────────────
 * Детерминированная раскладка подписей
 * ────────────────────────────────────────────────────────────────────
 * Проблема: координаты текста от модели «плавают» — на каждой генерации
 * подпись оказывается в новом месте, иногда на самом объекте или у края.
 * Решение: координаты текста от модели ИГНОРИРУЕМ; берём только ЯКОРЬ
 * (arrow_to — центр объекта, уточнённый vision-грунтингом на бэкенде) и
 * раскладываем текст ПРАВИЛАМИ:
 *   • фиксированный набор офсетов-кандидатов вокруг якоря (над объектом —
 *     конвенция №1, затем под, по диагоналям, по бокам);
 *   • жёсткие ограничения: bbox текста не пересекаются между собой, с
 *     leader-line или с заметной линией/стрелкой в растре; leader-line
 *     начинается на внешней границе bbox и не проходит через чужой текст;
 *   • мягкий скоринг используется только ПОСЛЕ проверок — чтобы среди
 *     допустимых мест выбрать ближайшее и семантически естественное.
 *     Если canvas недоступен, geometry-only ограничения всё равно действуют.
 * Алгоритм rule-based без стохастики: одинаковые подписи → пиксель-в-
 * пиксель одинаковая раскладка, в любом стиле генерации.
 */

// `fromBackend` помечает кандидата, собранного из присланных бэкендом x/y.
// Скоринг даёт ему бонус — см. BACKEND_PLACEMENT_BONUS.
type Offset = { dx: number; dy: number; fromBackend?: boolean };

/** Базовые кандидаты-офсеты от якоря (в % картинки), в порядке предпочтения. */
const CANDIDATE_OFFSETS: ReadonlyArray<Offset> = [
  { dx: 0, dy: -12 },   // над объектом — конвенция по умолчанию
  { dx: 0, dy: 13 },    // под объектом
  { dx: -16, dy: -9 },  // сверху-слева
  { dx: 16, dy: -9 },   // сверху-справа
  { dx: -20, dy: 0 },   // слева
  { dx: 20, dy: 0 },    // справа
  { dx: -16, dy: 10 },  // снизу-слева
  { dx: 16, dy: 10 },   // снизу-справа
  { dx: -28, dy: -13 }, // дальние слоты только когда рядом всё занято
  { dx: 28, dy: -13 },
  { dx: -28, dy: 14 },
  { dx: 28, dy: 14 },
];

// Безопасная зона АВТОМАТИЧЕСКОЙ раскладки: текстовый блок центрируется в
// точке, поэтому держим её подальше от краёв. Ручное перетаскивание этой зоной
// не ограничено — см. OUT_OF_FRAME_MARGIN_PCT.
const BOUNDS = { xMin: 10, xMax: 90, yMin: 6, yMax: 92 };

// Насколько далеко за рамку картинки можно утащить подпись руками.
//
// Зачем вообще выпускать: на плотной схеме свободного места внутри кадра просто
// нет, и подпись неизбежно ложится на стрелку или на соседний текст. Вынести её
// на поле — штатный приём учебной графики, выноска при этом продолжает
// показывать на объект.
//
// Почему не безгранично: ограничение ловит «улёт» при резком рывке мышью, после
// которого подпись пришлось бы искать по всей доске. Полкадра в каждую сторону
// — этого хватает, чтобы освободить любую точку внутри картинки.
//
// NB: рамка НИКОГДА не резала подписи через CSS — ни overflow:hidden, ни
// clip-path в дереве иллюстрации нет. Держал их ровно этот clamp.
const OUT_OF_FRAME_MARGIN_PCT = 50;
const LABEL_GAP_PCT = 2.2;
const MIN_LEADER_DISTANCE_PCT = 8.5;
const CONNECTOR_GAP_PCT = 0.9;
const CONNECTOR_BOX_GAP_PCT = 0.7;

// Максимальная длина выноски. Это ЗАПРЕТ, а не штраф: линия через весь кадр
// нечитаема в принципе, сколько бы чистого фона под текстом ни было. Значение
// согласовано с `_MAX_CONNECTOR_DISTANCE_PCT = 30` в backend/label_layout.py
// плюс небольшой допуск на клампинг к BOUNDS.
export const MAX_LEADER_DISTANCE_PCT = 32;

// Штраф за уход на противоположную от якоря половину кадра. Портирован из
// backend/label_layout.py (там ровно +8.0): без него подпись «телепортируется»
// к дальнему краю, потому что фон там чище, и выноска идёт через всю картинку.
const CROSS_FRAME_PENALTY = 8;

// Бонус позиции, ПРИСЛАННОЙ БЭКЕНДОМ. Бэкенд уже искал тихие зоны по картинке
// (label_layout.py) и штрафовал пересечение кадра. Его выбор должен проигрывать
// только жёсткому запрету, а не «чуть более чистому» фону — иначе вся серверная
// раскладка выбрасывается впустую.
const BACKEND_PLACEMENT_BONUS = 6;

// Насколько чистый фон может «перевесить» лучший по расстоянию вариант. Раньше
// выбор был лексикографическим (`bestClear ?? bestFallback`), поэтому ЛЮБОЕ
// чистое место побеждало близкое с малейшим следом краски. Порог сохраняет
// предпочтение читаемого фона, но не за счёт улёта через кадр.
const CLEAR_PREFERENCE_MARGIN = 4;

/** Геометрия выноски уже после раскладки текста. */
export interface LabelConnector {
  start: SamplePoint;
  end: SamplePoint;
}

/** Итог раскладки одной подписи. */
export interface LabelPlacement {
  /** Финальная позиция ТЕКСТА (проценты 0–100). */
  x: number;
  y: number;
  /** Фон под финальной позицией — для contrastStylesFor. */
  sample: BackdropSample | null;
  /** Консервативная оценка bbox текста в процентах изображения. */
  width: number;
  height: number;
  /** Выноска начинается за пределами bbox, поэтому не перечёркивает текст. */
  connector: LabelConnector | null;
  /** Fail-safe для полностью занятого кадра: непрозрачная подложка маскирует штрих. */
  needsBackdrop: boolean;
}

/**
 * Перемещает уже рассчитанную подпись, сохраняя её научный якорь.
 *
 * Подпись можно увести ЗА пределы кадра (на поле рядом с иллюстрацией) — там
 * она не спорит с геометрией, а выноска продолжает показывать на объект.
 * Далеко улететь не даёт OUT_OF_FRAME_MARGIN_PCT. Если пользователь тянет
 * текст прямо на точку привязки, подпись мягко останавливается перед ней: так
 * target и стрелка не оказываются под буквами. Начало leader-line каждый раз
 * вычисляется заново от внешней границы bbox.
 */
/**
 * Показывать ли выноску у подписи — ЕДИНОЕ правило для всех рендереров.
 *
 * Раньше `IllustrationRenderer` рисовал выноску только у вручную перемещённой
 * подписи, а `ScientificIllustration` — всегда. Из-за первого варианта
 * авто-подпись, которую раскладка увела от объекта, оставалась сиротой: текст
 * есть, а на что он указывает — непонятно.
 *
 * Правило: выноска нужна, когда подпись ДАЛЕКО от своей цели. Рядом стоящей
 * подписи линия только добавляет шум, поэтому там её по-прежнему нет —
 * ручное перемещение при этом всегда считается «далеко» осознанно, чтобы связь
 * с объектом не терялась после перетаскивания.
 */
export function shouldShowLeaderLine(
  placement: Pick<LabelPlacement, "x" | "y" | "connector">,
  arrowTo: SamplePoint | undefined,
  manuallyPlaced = false,
): boolean {
  if (placement.connector == null) return false;
  if (manuallyPlaced) return true;
  if (!arrowTo) return false;
  return distance({ x: placement.x, y: placement.y }, arrowTo) >= MIN_LEADER_DISTANCE_PCT;
}

export function moveLabelPlacement(
  placement: LabelPlacement,
  target: SamplePoint | undefined,
  requested: SamplePoint,
): LabelPlacement {
  const halfW = placement.width / 2;
  const halfH = placement.height / 2;
  // Границы считаем по ЦЕНТРУ подписи, но с поправкой на её половину, иначе
  // широкий текст улетал бы за поле сильнее узкого при одном и том же лимите.
  const clampPosition = (point: SamplePoint): SamplePoint => ({
    x: Math.min(
      100 + OUT_OF_FRAME_MARGIN_PCT - halfW,
      Math.max(halfW - OUT_OF_FRAME_MARGIN_PCT, point.x),
    ),
    y: Math.min(
      100 + OUT_OF_FRAME_MARGIN_PCT - halfH,
      Math.max(halfH - OUT_OF_FRAME_MARGIN_PCT, point.y),
    ),
  });

  let position = clampPosition(requested);

  if (target) {
    let dx = position.x - target.x;
    let dy = position.y - target.y;
    let length = Math.hypot(dx, dy);

    if (length < 0.001) {
      dx = placement.x - target.x;
      dy = placement.y - target.y;
      length = Math.hypot(dx, dy);
    }
    if (length < 0.001) {
      dx = 0;
      dy = -1;
      length = 1;
    }

    const ux = dx / length;
    const uy = dy / length;
    const exitX = Math.abs(ux) < 0.001 ? Number.POSITIVE_INFINITY : halfW / Math.abs(ux);
    const exitY = Math.abs(uy) < 0.001 ? Number.POSITIVE_INFINITY : halfH / Math.abs(uy);
    const minimumDistance = Math.min(exitX, exitY) + CONNECTOR_GAP_PCT + 1.25;

    if (length < minimumDistance) {
      position = clampPosition({
        x: target.x + ux * minimumDistance,
        y: target.y + uy * minimumDistance,
      });
    }
  }

  const box = labelBox(position.x, position.y, placement.width, placement.height);
  return {
    ...placement,
    x: position.x,
    y: position.y,
    sample: null,
    connector: connectorFor(box, target),
    // При произвольном ручном положении пиксельная карта уже не проверена.
    // Компактная подложка гарантирует, что линии растра не пройдут по буквам.
    needsBackdrop: true,
  };
}

export type LabelTargetKind = "object" | "vector" | "angle" | "region";

type LabelInput = SamplePoint & {
  arrow_to?: SamplePoint;
  content?: string;
  target_kind?: LabelTargetKind;
};

type LabelBox = {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
};

function visibleTextLength(text: string | undefined): number {
  if (!text) return 8;
  return text
    .replace(/\$+/g, "")
    .replace(/\\[a-zA-Z]+/g, "mm")
    .replace(/\s+/g, " ")
    .trim().length || 8;
}

function estimatedLabelMetrics(label: LabelInput): { width: number; height: number } {
  // Labels are rendered as compact centered text. We cannot measure DOM here
  // without creating layout feedback loops, so use a conservative percent
  // estimate that works for the small board images where collisions hurt most.
  const len = visibleTextLength(label.content);
  const naturalWidth = len * 1.18 + 4;
  const width = Math.min(34, Math.max(8, naturalWidth));
  const lines = Math.max(1, Math.ceil(naturalWidth / width));
  // react-latex-next может увеличить line box почти вдвое даже у визуально
  // однострочной подписи (MathML + KaTeX baseline). Берём фактический худший
  // размер с запасом, иначе выноска формально покидает расчётный bbox, но всё
  // ещё попадает в DOM-box формулы.
  return { width, height: 10.5 + (lines - 1) * 5.2 };
}

function labelBox(x: number, y: number, widthPct: number, heightPct: number): LabelBox {
  const halfW = widthPct / 2;
  const halfH = heightPct / 2;
  return {
    x,
    y,
    width: widthPct,
    height: heightPct,
    left: x - halfW,
    right: x + halfW,
    top: y - halfH,
    bottom: y + halfH,
  };
}

function overlapArea(a: LabelBox, b: LabelBox): number {
  const x = Math.max(0, Math.min(a.right + LABEL_GAP_PCT, b.right) - Math.max(a.left - LABEL_GAP_PCT, b.left));
  const y = Math.max(0, Math.min(a.bottom + LABEL_GAP_PCT, b.bottom) - Math.max(a.top - LABEL_GAP_PCT, b.top));
  return x * y;
}

function distance(a: SamplePoint, b: SamplePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function distancePointToSegment(point: SamplePoint, a: SamplePoint, b: SamplePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return distance(point, a);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy });
}

function boxCenter(box: LabelBox): SamplePoint {
  return { x: box.x, y: box.y };
}

function expandedBox(box: LabelBox, gap: number): LabelBox {
  return {
    ...box,
    width: box.width + gap * 2,
    height: box.height + gap * 2,
    left: box.left - gap,
    right: box.right + gap,
    top: box.top - gap,
    bottom: box.bottom + gap,
  };
}

function pointInsideBox(point: SamplePoint, box: LabelBox): boolean {
  return (
    point.x >= box.left
    && point.x <= box.right
    && point.y >= box.top
    && point.y <= box.bottom
  );
}

function orientation(a: SamplePoint, b: SamplePoint, c: SamplePoint): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function pointOnSegment(point: SamplePoint, a: SamplePoint, b: SamplePoint): boolean {
  const epsilon = 1e-6;
  return (
    Math.abs(orientation(a, b, point)) <= epsilon
    && point.x >= Math.min(a.x, b.x) - epsilon
    && point.x <= Math.max(a.x, b.x) + epsilon
    && point.y >= Math.min(a.y, b.y) - epsilon
    && point.y <= Math.max(a.y, b.y) + epsilon
  );
}

function segmentsIntersect(
  a1: SamplePoint,
  a2: SamplePoint,
  b1: SamplePoint,
  b2: SamplePoint,
): boolean {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  const epsilon = 1e-6;

  if (
    ((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon))
    && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))
  ) {
    return true;
  }

  return (
    (Math.abs(o1) <= epsilon && pointOnSegment(b1, a1, a2))
    || (Math.abs(o2) <= epsilon && pointOnSegment(b2, a1, a2))
    || (Math.abs(o3) <= epsilon && pointOnSegment(a1, b1, b2))
    || (Math.abs(o4) <= epsilon && pointOnSegment(a2, b1, b2))
  );
}

function segmentIntersectsBox(
  start: SamplePoint,
  end: SamplePoint,
  box: LabelBox,
): boolean {
  if (pointInsideBox(start, box) || pointInsideBox(end, box)) return true;
  const topLeft = { x: box.left, y: box.top };
  const topRight = { x: box.right, y: box.top };
  const bottomRight = { x: box.right, y: box.bottom };
  const bottomLeft = { x: box.left, y: box.bottom };
  return (
    segmentsIntersect(start, end, topLeft, topRight)
    || segmentsIntersect(start, end, topRight, bottomRight)
    || segmentsIntersect(start, end, bottomRight, bottomLeft)
    || segmentsIntersect(start, end, bottomLeft, topLeft)
  );
}

function connectorsCross(a: LabelConnector, b: LabelConnector): boolean {
  // Несколько физических величин могут быть заземлены в одной точке. Их
  // выноски закономерно сходятся там — это не считается пересечением в поле.
  if (distance(a.end, b.end) < 0.75) return false;
  return segmentsIntersect(a.start, a.end, b.start, b.end);
}

/**
 * Находим точку пересечения луча «центр подписи → объект» с bbox текста и
 * выносим начало ещё на небольшой зазор наружу. Линия никогда не лежит под
 * собственным текстом — независимо от CSS-ореола.
 */
function connectorFor(box: LabelBox, target: SamplePoint | undefined): LabelConnector | null {
  if (!target) return null;
  const dx = target.x - box.x;
  const dy = target.y - box.y;
  const totalDistance = Math.hypot(dx, dy);
  if (totalDistance < 1e-6 || pointInsideBox(target, expandedBox(box, CONNECTOR_GAP_PCT))) {
    return null;
  }

  const tx = Math.abs(dx) < 1e-6 ? Number.POSITIVE_INFINITY : box.width / 2 / Math.abs(dx);
  const ty = Math.abs(dy) < 1e-6 ? Number.POSITIVE_INFINITY : box.height / 2 / Math.abs(dy);
  const edgeT = Math.min(tx, ty);
  const gapT = CONNECTOR_GAP_PCT / totalDistance;
  return {
    start: {
      x: box.x + dx * (edgeT + gapT),
      y: box.y + dy * (edgeT + gapT),
    },
    end: target,
  };
}

function targetKindFor(label: LabelInput): LabelTargetKind {
  if (label.target_kind) return label.target_kind;
  const text = (label.content ?? "").toLowerCase();
  if (/θ|theta|угол|градус|°/.test(text)) return "angle";
  if (
    /сил|force|gravity|weight|тяжест|нормал|friction|трени|натяж|tension|скорост|velocity|ускор|acceleration|\bmg\b/.test(text)
    || /^(?:\$?\s*)?(?:n|t|f|v|a|g)(?:\s*\$?)?$/i.test(text)
  ) {
    return "vector";
  }
  return "object";
}

function isAngleLabel(label: LabelInput): boolean {
  return targetKindFor(label) === "angle";
}

function isVectorLabel(label: LabelInput): boolean {
  return targetKindFor(label) === "vector";
}

function semanticOffsets(label: LabelInput): Offset[] {
  const text = (label.content ?? "").toLowerCase();
  if (/θ|theta|угол/.test(text)) {
    return [
      { dx: 4, dy: -5 },
      { dx: 7, dy: -5 },
      { dx: 2, dy: -8 },
      { dx: -4, dy: -5 },
      { dx: 6, dy: 1 },
      { dx: -6, dy: 1 },
    ];
  }
  if (/трени|friction|f[_\s]?тр|сила\s*f/.test(text)) {
    return [
      { dx: 9, dy: -7 },
      { dx: -9, dy: -7 },
      { dx: 11, dy: 5 },
      { dx: -11, dy: 5 },
    ];
  }
  if (/нормал|normal|^n$|\bn\b/.test(text)) {
    return [
      { dx: -8, dy: -8 },
      { dx: 8, dy: -8 },
      { dx: 10, dy: 4 },
      { dx: -10, dy: 4 },
    ];
  }
  if (/гравитац|gravity|тяжест|weight|\bmg\b/.test(text)) {
    return [
      { dx: 8, dy: -4 },
      { dx: -8, dy: -4 },
      { dx: 9, dy: 6 },
      { dx: -9, dy: 6 },
    ];
  }
  if (isVectorLabel(label)) {
    return [
      { dx: 8, dy: -6 },
      { dx: -8, dy: -6 },
      { dx: 9, dy: 5 },
      { dx: -9, dy: 5 },
    ];
  }
  return [];
}

function radialOffsets(anchor: SamplePoint): Offset[] {
  const vx = anchor.x - 50;
  const vy = anchor.y - 50;
  const len = Math.hypot(vx, vy) || 1;
  const ux = vx / len;
  const uy = vy / len;
  return [
    { dx: ux * 18, dy: uy * 12 },
    { dx: ux * 24, dy: uy * 16 },
  ];
}

/**
 * Резервная сетка по всему безопасному полю. Она нужна, когда вокруг объекта
 * уже проходят несколько сил/стрелок: локальные офсеты тогда принципиально не
 * могут дать чистое место, а уменьшение шрифта только маскирует проблему.
 */
function globalSearchOffsets(anchor: SamplePoint): Offset[] {
  const xs = [14, 24, 36, 50, 64, 76, 86];
  const ys = [9, 18, 29, 41, 53, 65, 77, 89];
  return ys
    .flatMap((y) => xs.map((x) => ({ dx: x - anchor.x, dy: y - anchor.y })))
    .sort((a, b) => {
      const distanceDelta = Math.hypot(a.dx, a.dy) - Math.hypot(b.dx, b.dy);
      if (Math.abs(distanceDelta) > 1e-6) return distanceDelta;
      if (a.dy !== b.dy) return a.dy - b.dy;
      return a.dx - b.dx;
    });
}

function uniqueOffsets(offsets: ReadonlyArray<Offset>): Offset[] {
  const seen = new Set<string>();
  return offsets.filter((offset) => {
    const key = `${offset.dx.toFixed(3)},${offset.dy.toFixed(3)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function candidateOffsetsFor(label: LabelInput, anchor: SamplePoint): Offset[] {
  const kind = targetKindFor(label);
  const preferredDistance = distance(label, anchor);
  // Верхняя граница согласована с `_MAX_CONNECTOR_DISTANCE_PCT = 30` в
  // backend/label_layout.py: раньше здесь было 26, и легальная серверная
  // раскладка на 26–30% молча отбрасывалась, после чего позиция искалась с нуля.
  const preferredMax = kind === "angle" ? 10 : kind === "vector" ? 18 : 30;
  const preferred: Offset[] =
    Number.isFinite(label.x)
    && Number.isFinite(label.y)
    && preferredDistance >= 2
    && preferredDistance <= preferredMax
      ? [{ dx: label.x - anchor.x, dy: label.y - anchor.y, fromBackend: true }]
      : [];
  if (isAngleLabel(label)) {
    return uniqueOffsets([
      ...preferred,
      ...semanticOffsets(label),
      ...CANDIDATE_OFFSETS,
      ...globalSearchOffsets(anchor),
    ]);
  }
  if (isVectorLabel(label)) {
    return uniqueOffsets([
      ...preferred,
      ...semanticOffsets(label),
      ...CANDIDATE_OFFSETS,
      ...globalSearchOffsets(anchor),
    ]);
  }
  return uniqueOffsets([
    ...preferred,
    ...semanticOffsets(label),
    ...radialOffsets(anchor),
    ...CANDIDATE_OFFSETS,
    ...globalSearchOffsets(anchor),
  ]);
}

interface SurfaceRisk {
  inkRatio: number;
  darkRatio: number;
  edgeRatio: number;
  contrast: number;
}

/**
 * Проверяем ВЕСЬ bbox будущего текста, а не пять точек. Даже тонкая вертикальная
 * стрелка занимает мало площади и легко проходила между прежними пробами.
 * `darkRatio` ловит такой штрих, `edgeRatio` — светлые/антиалиасные контуры,
 * `inkRatio` — цветные стрелки и серые поверхности.
 */
function candidateSurfaceRisk(data: ImageData | null, box: LabelBox): SurfaceRisk | null {
  if (!data) return null;
  const toStartPx = (pct: number, dim: number) =>
    Math.floor((Math.min(100, Math.max(0, pct)) / 100) * (dim - 1));
  const toEndPx = (pct: number, dim: number) =>
    Math.ceil((Math.min(100, Math.max(0, pct)) / 100) * (dim - 1));
  const left = toStartPx(box.left, data.width);
  const right = toEndPx(box.right, data.width);
  const top = toStartPx(box.top, data.height);
  const bottom = toEndPx(box.bottom, data.height);

  let count = 0;
  let ink = 0;
  let dark = 0;
  let edges = 0;
  let luminanceSum = 0;
  let luminanceSquareSum = 0;
  const { width, height, data: pixels } = data;

  const rgbaAt = (x: number, y: number): [number, number, number] => {
    const offset = (y * width + x) * 4;
    const alpha = pixels[offset + 3] / 255;
    return [
      pixels[offset] * alpha + 255 * (1 - alpha),
      pixels[offset + 1] * alpha + 255 * (1 - alpha),
      pixels[offset + 2] * alpha + 255 * (1 - alpha),
    ];
  };

  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const [r, g, b] = rgbaAt(x, y);
      const luminance = relativeLuminance(r, g, b);
      const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      count += 1;
      luminanceSum += luminance;
      luminanceSquareSum += luminance * luminance;
      if (luminance < 0.91 || saturation > 0.17) ink += 1;
      if (luminance < 0.72) dark += 1;

      if (x < Math.min(right, width - 1)) {
        const [nr, ng, nb] = rgbaAt(x + 1, y);
        if (Math.max(Math.abs(r - nr), Math.abs(g - ng), Math.abs(b - nb)) > 30) {
          edges += 1;
        }
      }
      if (y < Math.min(bottom, height - 1)) {
        const [nr, ng, nb] = rgbaAt(x, y + 1);
        if (Math.max(Math.abs(r - nr), Math.abs(g - ng), Math.abs(b - nb)) > 30) {
          edges += 1;
        }
      }
    }
  }

  if (count === 0) return null;
  const mean = luminanceSum / count;
  return {
    inkRatio: ink / count,
    darkRatio: dark / count,
    edgeRatio: edges / (count * 2),
    contrast: Math.sqrt(Math.max(0, luminanceSquareSum / count - mean * mean)),
  };
}

function surfaceIsClear(risk: SurfaceRisk | null): boolean {
  return (
    risk == null
    || (
      risk.darkRatio <= 0.006
      && risk.inkRatio <= 0.025
      && risk.edgeRatio <= 0.022
      && risk.contrast <= 0.065
    )
  );
}

function surfaceRiskPenalty(risk: SurfaceRisk | null): number {
  if (!risk) return 0;
  return (
    risk.darkRatio * 120
    + risk.inkRatio * 30
    + risk.edgeRatio * 90
    + risk.contrast * 18
  );
}

/** Сэмпл «под текстом»: центр + два горизонтальных соседа (текст широкий). */
function sampleTextArea(data: ImageData, xPct: number, yPct: number): BackdropSample | null {
  const toPx = (pct: number, dim: number) =>
    Math.round((Math.min(100, Math.max(0, pct)) / 100) * (dim - 1));
  const probes = [-6, 0, 6]
    .map((dx) => sampleBackdropAt(data, toPx(xPct + dx, data.width), toPx(yPct, data.height)))
    .filter((s): s is BackdropSample => s != null);
  if (probes.length === 0) return null;
  return {
    luminance: probes.reduce((s, p) => s + p.luminance, 0) / probes.length,
    // Худший (максимальный) σ из проб: если ЛЮБАЯ часть текста ляжет на
    // стрелку/границу — позиция считается пёстрой.
    contrast: Math.max(...probes.map((p) => p.contrast)),
  };
}

type PlacedLabel = {
  box: LabelBox;
  connector: LabelConnector | null;
};

type CandidatePlacement = PlacedLabel & {
  score: number;
  surfaceClear: boolean;
};

export function layoutIllustrationLabels(
  data: ImageData | null,
  labels: ReadonlyArray<LabelInput>,
): LabelPlacement[] {
  const anchors = labels.map((l) => l.arrow_to ?? { x: l.x, y: l.y });
  const placed: PlacedLabel[] = [];

  return labels.map((label, i) => {
    const anchor = anchors[i];
    const targetKind = targetKindFor(label);
    const angleLabel = targetKind === "angle";
    const vectorLabel = targetKind === "vector";
    const metrics = estimatedLabelMetrics(label);
    // Все допустимые кандидаты, выбор — ниже одним проходом. Раньше здесь были
    // два аккумулятора `bestClear`/`bestFallback`, и выбор между ними шёл
    // лексикографически: чистый фон побеждал близкое расположение при любом
    // разрыве в score.
    const candidates: CandidatePlacement[] = [];
    const seenCandidates = new Set<string>();

    candidateOffsetsFor(label, anchor).forEach((off, ci) => {
      const halfW = metrics.width / 2;
      const xMin = Math.max(BOUNDS.xMin, halfW + 1);
      const xMax = Math.min(BOUNDS.xMax, 99 - halfW);
      const x = Math.min(xMax, Math.max(xMin, anchor.x + off.dx));
      const y = Math.min(BOUNDS.yMax, Math.max(BOUNDS.yMin, anchor.y + off.dy));
      const box = labelBox(x, y, metrics.width, metrics.height);
      const candidateKey = `${x.toFixed(2)},${y.toFixed(2)}`;
      if (seenCandidates.has(candidateKey)) return;
      seenCandidates.add(candidateKey);
      const connector = connectorFor(box, label.arrow_to);
      const missingRequiredConnector = label.arrow_to != null && connector == null;

      // Это именно запреты, а не штрафы: недопустимый кандидат не может
      // «победить» из-за близости к объекту.
      const overlapsPlacedText = placed.some((entry) => overlapArea(box, entry.box) > 0);
      const onForeignAnchor = anchors.some(
        (a, ai) =>
          ai !== i &&
          a.x >= box.left - 2 &&
          a.x <= box.right + 2 &&
          a.y >= box.top - 2 &&
          a.y <= box.bottom + 2,
      );
      const onOwnAnchor = label.arrow_to != null && pointInsideBox(anchor, expandedBox(box, 0.5));
      const boxCrossesPlacedConnector = placed.some(
        (entry) =>
          entry.connector != null
          && segmentIntersectsBox(
            entry.connector.start,
            entry.connector.end,
            expandedBox(box, CONNECTOR_BOX_GAP_PCT),
          ),
      );
      const connectorCrossesPlacedText =
        connector != null
        && placed.some((entry) =>
          segmentIntersectsBox(
            connector.start,
            connector.end,
            expandedBox(entry.box, CONNECTOR_BOX_GAP_PCT),
          ));
      const connectorCrossesConnector =
        connector != null
        && placed.some((entry) => entry.connector != null && connectorsCross(connector, entry.connector));
      const connectorThroughForeignAnchor =
        connector != null
        && anchors.some(
          (a, ai) =>
            ai !== i
            && distance(a, connector.end) >= 0.75
            && distancePointToSegment(a, connector.start, connector.end) < 3.5,
        );

      const leaderDistance = distance(boxCenter(box), anchor);
      // Выноска через весь кадр нечитаема при любом фоне, поэтому это запрет,
      // а не штраф. Аварийный путь ниже остаётся последним рубежом, если
      // ВООБЩЕ ни один кандидат не прошёл.
      const leaderTooLong = leaderDistance > MAX_LEADER_DISTANCE_PCT;

      if (
        overlapsPlacedText
        || missingRequiredConnector
        || onForeignAnchor
        || onOwnAnchor
        || boxCrossesPlacedConnector
        || connectorCrossesPlacedText
        || connectorCrossesConnector
        || connectorThroughForeignAnchor
        || leaderTooLong
      ) {
        return;
      }

      const minLeaderDistance = angleLabel ? 2.5 : vectorLabel ? 5 : MIN_LEADER_DISTANCE_PCT;
      const tooClosePenalty = leaderDistance < minLeaderDistance
        ? (minLeaderDistance - leaderDistance) * (vectorLabel ? 1.1 : 0.45)
        : 0;
      const preferredMaxDistance = angleLabel ? 8 : vectorLabel ? 14 : 18;
      const tooFarPenalty =
        Math.max(0, leaderDistance - preferredMaxDistance)
        * (angleLabel ? 0.9 : vectorLabel ? 0.7 : 0.2);
      const anchorCenterDistance = distance(anchor, { x: 50, y: 50 });
      const labelCenterDistance = distance(boxCenter(box), { x: 50, y: 50 });
      const inwardPenalty = !angleLabel && labelCenterDistance < anchorCenterDistance + 4
        ? (anchorCenterDistance + 4 - labelCenterDistance) * 0.12
        : 0;
      const surfaceRisk = candidateSurfaceRisk(data, expandedBox(box, 0.5));
      const backdropPenalty =
        surfaceRiskPenalty(surfaceRisk) * (angleLabel ? 0.7 : vectorLabel ? 1.2 : 1);
      // Клампинг к границе сдвинул кандидата с его офсета — лёгкий штраф
      // (позиция уже не «над объектом», предпочтём не обрезанный вариант).
      const clampPenalty =
        Math.abs(x - (anchor.x + off.dx)) + Math.abs(y - (anchor.y + off.dy)) > 0.5 ? 0.3 : 0;

      // Подпись ушла на противоположную от якоря половину кадра — выноска
      // пересечёт картинку. Тот же сдерживающий фактор, что +8.0 в
      // backend/label_layout.py:226; на фронте его не было вовсе.
      //
      // Проверка ТОЛЬКО горизонтальная, как на бэкенде. Вертикальная давала
      // ложные срабатывания на штатном «над объектом»: якорь чуть ниже
      // середины, подпись чуть выше — формально разные половины, а на деле
      // сдвиг на десяток процентов.
      const center = boxCenter(box);
      const crossFramePenalty =
        anchor.x < 50 !== center.x < 50 ? CROSS_FRAME_PENALTY : 0;

      // Позиция от бэкенда: он уже анализировал картинку и держал выноску
      // короткой. Бонус, а не запрет — жёсткие проверки выше её всё ещё режут.
      const backendBonus = off.fromBackend ? BACKEND_PLACEMENT_BONUS : 0;

      const score =
        tooClosePenalty +
        tooFarPenalty +
        inwardPenalty +
        backdropPenalty +
        clampPenalty +
        crossFramePenalty -
        backendBonus +
        ci * 0.04; // порядок кандидатов: при прочих равных — над объектом

      candidates.push({
        box,
        connector,
        score,
        surfaceClear: surfaceIsClear(surfaceRisk),
      });
    });

    const emergencyBox = labelBox(
      Math.min(99 - metrics.width / 2, Math.max(metrics.width / 2 + 1, anchor.x)),
      Math.min(BOUNDS.yMax, Math.max(BOUNDS.yMin, anchor.y)),
      metrics.width,
      metrics.height,
    );
    // Раньше здесь было `bestClear ?? bestFallback` — лексикографика, из-за
    // которой ЛЮБОЕ чистое место побеждало близкое с малейшим следом краски,
    // независимо от score. На насыщенном растре это и давало «подпись у
    // противоположного края и выноска через всю картинку». Теперь чистый фон
    // предпочитается только когда он не проигрывает по score больше, чем на
    // CLEAR_PREFERENCE_MARGIN.
    const cheapest = (list: ReadonlyArray<CandidatePlacement>) =>
      list.reduce<CandidatePlacement | null>(
        (best, item) => (best == null || item.score < best.score ? item : best),
        null,
      );
    const bestOverall = cheapest(candidates);
    const bestClear = cheapest(candidates.filter((c) => c.surfaceClear));
    // Чистый фон предпочитаем, только если он не проигрывает по score больше,
    // чем на CLEAR_PREFERENCE_MARGIN. Так читаемость остаётся приоритетом, но
    // не ценой улёта подписи через кадр.
    const preferClear =
      bestClear != null
      && (bestOverall == null
        || bestClear.score <= bestOverall.score + CLEAR_PREFERENCE_MARGIN);
    const chosen: CandidatePlacement =
      (preferClear ? bestClear : null)
      ?? bestOverall
      ?? {
        box: emergencyBox,
        connector: connectorFor(emergencyBox, label.arrow_to),
        score: Number.POSITIVE_INFINITY,
        surfaceClear: data == null,
      };
    placed.push({ box: chosen.box, connector: chosen.connector });
    // Если весь кадр занят, `needsBackdrop` включает компактную непрозрачную
    // подложку. Это последний рубеж: стрелка всё равно не читается сквозь текст.
    return {
      x: chosen.box.x,
      y: chosen.box.y,
      sample: data ? sampleTextArea(data, chosen.box.x, chosen.box.y) : null,
      width: chosen.box.width,
      height: chosen.box.height,
      connector: chosen.connector,
      needsBackdrop: data != null && !chosen.surfaceClear,
    };
  });
}

/**
 * Раскладка подписей по картинке `src`: детерминированные позиции текста
 * (см. layoutIllustrationLabels) + фон под каждой для динамического контраста.
 *
 * До декодирования картинки возвращает geometry-only раскладку текущего
 * запроса, после — уточнённую по пикселям. Результат от предыдущего `src` или
 * набора labels никогда не показывается даже на один React-render: именно
 * такой короткий stale-frame раньше визуально накладывал повторные запросы.
 */
export function useSmartLabels(
  src: string | null | undefined,
  labels: ReadonlyArray<LabelInput>,
): LabelPlacement[] {
  // Identity-независимый ключ — эффект не перезапускается от пересоздания
  // массива с теми же координатами.
  const coordsKey = useMemo(
    () =>
      labels
        .map((l) => `${l.x},${l.y},${l.arrow_to ? `${l.arrow_to.x},${l.arrow_to.y}` : ""},${l.target_kind ?? ""},${l.content ?? ""}`)
        .join(";"),
    [labels],
  );
  const normalizedSrc = src ?? null;
  const geometryPlacements = useMemo(
    () => layoutIllustrationLabels(null, labels),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coordsKey заменяет identity массива
    [coordsKey],
  );

  const [resolved, setResolved] = useState<{
    src: string | null;
    coordsKey: string;
    placements: LabelPlacement[];
  }>(() => ({
    src: normalizedSrc,
    coordsKey,
    placements: geometryPlacements,
  }));

  useEffect(() => {
    if (!src || labels.length === 0) {
      setResolved({
        src: normalizedSrc,
        coordsKey,
        placements: geometryPlacements,
      });
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const imageData = await getImageDataForSrc(src);
        if (cancelled) return;
        setResolved({
          src,
          coordsKey,
          placements: layoutIllustrationLabels(imageData, labels),
        });
      } catch {
        // Пиксели недоступны (сеть/CORS) — всё равно используем
        // детерминированную геометрическую раскладку вокруг arrow_to,
        // а не сырые координаты модели, иначе текст ложится на фигуры.
        if (!cancelled) {
          setResolved({
            src,
            coordsKey,
            placements: geometryPlacements,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coordsKey заменяет labels
  }, [src, coordsKey, geometryPlacements, normalizedSrc]);

  return resolved.src === normalizedSrc && resolved.coordsKey === coordsKey
    ? resolved.placements
    : geometryPlacements;
}

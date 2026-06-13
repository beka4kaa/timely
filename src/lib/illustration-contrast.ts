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
export function contrastStylesFor(sample: BackdropSample | null): React.CSSProperties {
  if (sample == null) {
    return {
      color: TEXT_ON_LIGHT,
      textShadow: haloShadow("rgba(255, 255, 255, 0.85)"),
    };
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
  if (strength < 0.12) return { color };

  // Плотность ореола растёт с необходимостью: 0.3 (едва заметный) → 0.95.
  const alpha = 0.3 + 0.65 * strength;
  const halo = darkBg
    ? `rgba(10, 12, 16, ${alpha.toFixed(2)})`
    : `rgba(255, 255, 255, ${alpha.toFixed(2)})`;
  return { color, textShadow: haloShadow(halo) };
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
 *   • скоринг кандидатов в основе геометрический: границы, коллизии с уже
 *     размещёнными подписями, чужие якоря, длина leader-line, порядок
 *     предпочтения. Если пиксели картинки доступны, добавляется мягкий штраф
 *     за серый/пёстрый фон под подписью — это уводит текст с блока, плоскости
 *     и стрелок на свободное белое поле. Если canvas недоступен, раскладка всё
 *     равно работает по geometry-only правилам, без возврата к сырым
 *     координатам модели.
 * Алгоритм rule-based без стохастики: одинаковые подписи → пиксель-в-
 * пиксель одинаковая раскладка, в любом стиле генерации.
 */

type Offset = { dx: number; dy: number };

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

// Безопасная зона: текстовый блок центрируется в точке, поэтому держим её
// подальше от краёв, чтобы подпись не резалась рамкой иллюстрации.
const BOUNDS = { xMin: 10, xMax: 90, yMin: 6, yMax: 92 };
const LABEL_GAP_PCT = 2.2;
const MIN_LEADER_DISTANCE_PCT = 8.5;

/** Итог раскладки одной подписи. */
export interface LabelPlacement {
  /** Финальная позиция ТЕКСТА (проценты 0–100). */
  x: number;
  y: number;
  /** Фон под финальной позицией — для contrastStylesFor. */
  sample: BackdropSample | null;
}

type LabelInput = SamplePoint & { arrow_to?: SamplePoint; content?: string };

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
  const naturalWidth = len * 1.08 + 4;
  const width = Math.min(30, Math.max(8, naturalWidth));
  const lines = Math.max(1, Math.ceil(naturalWidth / width));
  return { width, height: 4.8 + (lines - 1) * 3.4 };
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

function isAngleLabel(label: LabelInput): boolean {
  return /θ|theta|угол/.test((label.content ?? "").toLowerCase());
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
      { dx: 12, dy: -9 },
      { dx: -12, dy: -9 },
      { dx: 17, dy: -3 },
      { dx: -17, dy: -3 },
    ];
  }
  if (/нормал|normal|^n$|\bn\b/.test(text)) {
    return [
      { dx: -10, dy: -13 },
      { dx: 10, dy: -13 },
      { dx: 0, dy: -15 },
    ];
  }
  if (/гравитац|gravity|тяжест|weight|\bmg\b/.test(text)) {
    return [
      { dx: 10, dy: -4 },
      { dx: -10, dy: -4 },
      { dx: 12, dy: 7 },
      { dx: -12, dy: 7 },
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

function candidateOffsetsFor(label: LabelInput, anchor: SamplePoint): Offset[] {
  if (isAngleLabel(label)) {
    return semanticOffsets(label);
  }
  return [...semanticOffsets(label), ...radialOffsets(anchor), ...CANDIDATE_OFFSETS];
}

function candidateBackdropPenalty(data: ImageData | null, box: LabelBox): number {
  if (!data) return 0;
  const probes: Array<[number, number]> = [
    [box.x, box.y],
    [box.left + 2, box.y],
    [box.right - 2, box.y],
    [box.x, box.top + 1.5],
    [box.x, box.bottom - 1.5],
  ];
  const toPx = (pct: number, dim: number) =>
    Math.round((Math.min(100, Math.max(0, pct)) / 100) * (dim - 1));
  const samples = probes
    .map(([x, y]) => sampleBackdropAt(data, toPx(x, data.width), toPx(y, data.height)))
    .filter((s): s is BackdropSample => s != null);
  if (samples.length === 0) return 0;

  const luminance = samples.reduce((sum, s) => sum + s.luminance, 0) / samples.length;
  const contrast = Math.max(...samples.map((s) => s.contrast));
  const nonWhitePenalty = clamp01((0.965 - luminance) / 0.22) * 1.35;
  const busyPenalty = clamp01((contrast - 0.035) / 0.16) * 2.6;
  return nonWhitePenalty + busyPenalty;
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

function layoutLabels(
  data: ImageData | null,
  labels: ReadonlyArray<LabelInput>,
): LabelPlacement[] {
  const anchors = labels.map((l) => l.arrow_to ?? { x: l.x, y: l.y });
  const placed: LabelBox[] = [];

  return labels.map((label, i) => {
    const anchor = anchors[i];
    const angleLabel = isAngleLabel(label);
    const metrics = estimatedLabelMetrics(label);
    let bestBox: LabelBox | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    candidateOffsetsFor(label, anchor).forEach((off, ci) => {
      const halfW = metrics.width / 2;
      const xMin = Math.max(BOUNDS.xMin, halfW + 1);
      const xMax = Math.min(BOUNDS.xMax, 99 - halfW);
      const x = Math.min(xMax, Math.max(xMin, anchor.x + off.dx));
      const y = Math.min(BOUNDS.yMax, Math.max(BOUNDS.yMin, anchor.y + off.dy));
      const box = labelBox(x, y, metrics.width, metrics.height);

      // Скоринг: геометрия обязательна; пиксели, если доступны, дают только
      // дополнительный штраф за занятое место под текстом.
      // Коллизии считаем по bbox, а не по центрам: длинные русские подписи
      // вроде «Нормальная сила» и «Сила трения» не должны склеиваться.
      const overlapPenalty = placed.reduce((sum, p) => sum + overlapArea(box, p), 0);
      // Не садимся на ЧУЖОЙ якорь (чтобы подпись А не легла на объект Б).
      const onForeignAnchor = anchors.some(
        (a, ai) =>
          ai !== i &&
          a.x >= box.left - 2 &&
          a.x <= box.right + 2 &&
          a.y >= box.top - 2 &&
          a.y <= box.bottom + 2,
      );
      const onOwnAnchor = anchor.x >= box.left && anchor.x <= box.right && anchor.y >= box.top && anchor.y <= box.bottom;
      const leaderDistance = distance(boxCenter(box), anchor);
      const minLeaderDistance = angleLabel ? 2.5 : MIN_LEADER_DISTANCE_PCT;
      const tooClosePenalty = leaderDistance < minLeaderDistance
        ? (minLeaderDistance - leaderDistance) * 0.45
        : 0;
      const tooFarPenalty = Math.max(0, leaderDistance - (angleLabel ? 8 : 16)) * (angleLabel ? 0.7 : 0.16);
      const leaderThroughForeignAnchor = anchors.some(
        (a, ai) => ai !== i && distancePointToSegment(a, boxCenter(box), anchor) < 4.5,
      );
      const anchorCenterDistance = distance(anchor, { x: 50, y: 50 });
      const labelCenterDistance = distance(boxCenter(box), { x: 50, y: 50 });
      const inwardPenalty = !angleLabel && labelCenterDistance < anchorCenterDistance + 4
        ? (anchorCenterDistance + 4 - labelCenterDistance) * 0.12
        : 0;
      const backdropPenalty = candidateBackdropPenalty(data, box) * (angleLabel ? 0.15 : 1);
      // Клампинг к границе сдвинул кандидата с его офсета — лёгкий штраф
      // (позиция уже не «над объектом», предпочтём не обрезанный вариант).
      const clampPenalty =
        Math.abs(x - (anchor.x + off.dx)) + Math.abs(y - (anchor.y + off.dy)) > 0.5 ? 0.3 : 0;

      const score =
        overlapPenalty * 5 +
        (onForeignAnchor ? 7 : 0) +
        (onOwnAnchor ? (angleLabel ? 0.25 : 5) : 0) +
        (leaderThroughForeignAnchor ? 4 : 0) +
        tooClosePenalty +
        tooFarPenalty +
        inwardPenalty +
        backdropPenalty +
        clampPenalty +
        ci * 0.04; // порядок кандидатов: при прочих равных — над объектом

      if (score < bestScore) {
        bestScore = score;
        bestBox = box;
      }
    });

    const chosen = bestBox ?? labelBox(anchor.x, anchor.y, metrics.width, metrics.height);
    placed.push(chosen);
    // σ/яркость сэмплируются в УЖЕ выбранной позиции — только для ореола и
    // цвета текста, на выбор места они не влияют.
    return { x: chosen.x, y: chosen.y, sample: data ? sampleTextArea(data, chosen.x, chosen.y) : null };
  });
}

/**
 * Раскладка подписей по картинке `src`: детерминированные позиции текста
 * (см. layoutLabels) + фон под каждой для динамического контраста.
 *
 * До декодирования картинки возвращает позиции из данных модели (текст
 * не прыгает с пустого места), после — финальную раскладку. Эффект
 * зависит от `src` и СОДЕРЖИМОГО координат (coordsKey), а не от identity
 * массива labels, который пересоздаётся родителем на каждый рендер.
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
        .map((l) => `${l.x},${l.y},${l.arrow_to ? `${l.arrow_to.x},${l.arrow_to.y}` : ""},${l.content ?? ""}`)
        .join(";"),
    [labels],
  );

  const [placements, setPlacements] = useState<LabelPlacement[]>(() =>
    layoutLabels(null, labels),
  );

  useEffect(() => {
    if (!src || labels.length === 0) {
      setPlacements(layoutLabels(null, labels));
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const imageData = await getImageDataForSrc(src);
        if (cancelled) return;
        setPlacements(layoutLabels(imageData, labels));
      } catch {
        // Пиксели недоступны (сеть/CORS) — всё равно используем
        // детерминированную геометрическую раскладку вокруг arrow_to,
        // а не сырые координаты модели, иначе текст ложится на фигуры.
        if (!cancelled) setPlacements(layoutLabels(null, labels));
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- coordsKey заменяет labels
  }, [src, coordsKey]);

  return placements;
}

// Геометрия «корешка книги»: какие куски учебника попали в программу.
//
// Отдельный модуль, а не дополнение к `curriculum-progress.ts`: там прогресс
// обработки и оформление цитат, здесь — другая тема со своей арифметикой.
//
// Объединяющая идея: оба режима (страницы и разделы) — это упорядоченная ось из
// N ВКЛЮЧИТЕЛЬНЫХ слотов. В режиме страниц слот i — это страница i+1, в режиме
// разделов — i-й раздел по `order_index`. Всё ниже по течению работает со
// слотами и про режим не спрашивает; компонент ветвится ровно в одном месте —
// в подписи («страниц» или «разделов»).
//
// Главная ловушка входных данных: `page_start`/`page_end` на бэкенде —
// `PositiveIntegerField(default=0)`, а НЕ nullable. «Страниц нет» приезжает
// нулём. Поэтому `null`, `undefined` и `0` обязаны считаться одним и тем же:
// иначе у каждого документа без страниц вырастает фантомный отрезок на нулевой
// странице, а ветка «страниц нет — рисуем по разделам» не срабатывает никогда.

export interface RibbonSource {
  section_path?: string | null;
  page_start?: number | null;
  page_end?: number | null;
}

export interface RibbonTopicInput {
  id: string;
  /** Порядковый номер модуля, 0-based. Задаёт тон заливки. */
  moduleIndex: number;
  sources: readonly RibbonSource[];
}

export interface RibbonSectionInput {
  path?: string | null;
  order_index: number;
  /** Границы раздела в книге. Ноль и `null` — «неизвестно» (EPUB). */
  start_page?: number | null;
  end_page?: number | null;
}

export interface RibbonInput {
  /** `Document.page_count`. Ноль и мусор считаются «неизвестно». */
  pageCount?: number | null;
  topics: readonly RibbonTopicInput[];
  /** Нужны только для фолбэка, когда страниц нет ни у одной цитаты (EPUB). */
  sections?: readonly RibbonSectionInput[];
}

export interface RibbonSegment {
  key: string;
  topicId: string;
  moduleIndex: number;
  /** 1-based включительные слоты — то, из чего считаются проценты. */
  startUnit: number;
  endUnit: number;
  startPct: number;
  widthPct: number;
  /** Дорожка 0…2: пересекающиеся отрезки разных тем не должны наезжать. */
  lane: number;
}

export interface RibbonBracket {
  moduleIndex: number;
  startPct: number;
  widthPct: number;
}

export interface RibbonGap {
  startPct: number;
  widthPct: number;
  /** 1-based включительные слоты: из них собирается подпись «Не вошли: …». */
  startUnit: number;
  endUnit: number;
}

export type RibbonScale = "pages" | "sections";

export interface RibbonModel {
  scale: RibbonScale;
  /** Длина оси в слотах. Ноль означает «рисовать нечего». */
  unitCount: number;
  segments: RibbonSegment[];
  brackets: RibbonBracket[];
  gaps: RibbonGap[];
  claimedUnits: number;
  totalUnits: number;
  unsourcedTopicIds: string[];
  /** Ось пришлось растянуть: цитаты выходят за `page_count`. */
  axisExtended: boolean;
  /** Минимальная видимая ширина отрезка в процентах. */
  minWidthPct: number;
  laneCount: number;
}

/** Сколько дорожек максимум. Больше трёх полоса перестаёт читаться. */
export const MAX_LANES = 3;

/** Ниже этого отрезок физически не виден даже на широком экране. */
const MIN_VISIBLE_PCT = 0.95;

interface Span {
  topicId: string;
  moduleIndex: number;
  startUnit: number;
  endUnit: number;
}

const EMPTY: RibbonModel = {
  scale: "pages",
  unitCount: 0,
  segments: [],
  brackets: [],
  gaps: [],
  claimedUnits: 0,
  totalUnits: 0,
  unsourcedTopicIds: [],
  axisExtended: false,
  minWidthPct: 0,
  laneCount: 0,
};

/**
 * Номер страницы или ноль.
 *
 * Ноль здесь — это «страницы нет», а не «страница №0»: см. комментарий о
 * `default=0` в шапке модуля.
 */
function pageNumber(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const rounded = Math.floor(value);
  return rounded > 0 ? rounded : 0;
}

/** Пара страниц одной цитаты в вид «начало ≤ конец», либо null. */
function pageSpan(source: RibbonSource): [number, number] | null {
  const from = pageNumber(source.page_start);
  const to = pageNumber(source.page_end);
  if (from === 0 && to === 0) return null;
  if (from === 0) return [to, to];
  if (to === 0) return [from, from];
  return from <= to ? [from, to] : [to, from];
}

/** Объединение двух отрезков; `null` там, где отрезка нет вовсе. */
function union(
  a: [number, number] | null | undefined,
  b: [number, number] | null | undefined,
): [number, number] | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.max(a[1], b[1])];
}

/**
 * Схлопывание отрезков ОДНОЙ темы.
 *
 * Соседние тоже сливаются (`next.start <= cur.end + 1`): «стр. 12–14» и
 * «стр. 15» — это один кусок книги, и рисовать между ними щель значит соврать.
 * Между разными темами схлопывания нет: пересечение тем — это факт, который
 * полоса обязана показать.
 */
function mergeSpans(spans: [number, number][]): [number, number][] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [sorted[0]];
  for (const [start, end] of sorted.slice(1)) {
    const current = merged[merged.length - 1];
    if (start <= current[1] + 1) {
      current[1] = Math.max(current[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  return merged;
}

/**
 * Слот раздела по `section_path`.
 *
 * Точное совпадение, иначе самый длинный предок: цитата на «1.2.3» при наличии
 * только «1.2» должна попасть в «1.2», а не потеряться.
 */
function sectionSlot(path: string, slots: Map<string, number>): number | null {
  const exact = slots.get(path);
  if (exact !== undefined) return exact;

  let probe = path;
  while (probe.includes(".")) {
    probe = probe.slice(0, probe.lastIndexOf("."));
    const ancestor = slots.get(probe);
    if (ancestor !== undefined) return ancestor;
  }
  return null;
}

/**
 * Границы разделов из оглавления книги: путь → страницы.
 *
 * Совпадение только ТОЧНОЕ, без подъёма к предку (в отличие от `sectionSlot`):
 * цитата на «1.2.3» при наличии в оглавлении только «1.2» не должна забирать
 * себе всю главу.
 */
function sectionPagesFor(
  sections: readonly RibbonSectionInput[],
): Map<string, [number, number]> {
  const byPath = new Map<string, [number, number]>();
  for (const section of sections) {
    const path = (section.path || "").trim();
    if (!path || byPath.has(path)) continue;
    const from = pageNumber(section.start_page);
    if (from === 0) continue;
    const to = pageNumber(section.end_page);
    byPath.set(path, to >= from ? [from, to] : [from, from]);
  }
  return byPath;
}

/**
 * Отрезки по страницам. Пусто — значит, страниц нет ни у одной цитаты.
 *
 * ЦИТАТА РАСТЯГИВАЕТСЯ ДО СВОЕГО РАЗДЕЛА. Ссылка «§17, стр. 25» означает не
 * «в программе одна страница 25», а «в программе §17» — и покрывает его
 * целиком. Без этого между темами оставались швы: §X кончался на 89, §Y
 * начинался с 91, и страница 90 попадала в «не вошли», хотя в книге разделы
 * идут вплотную и она принадлежит одному из них. На шестистах страницах таких
 * швов набиралось шестнадцать из девятнадцати «пропусков» — то есть полоса
 * показывала не пропущенное, а места, куда не ткнулась цитата.
 *
 * Границы берутся объединением: цитата, вышедшая за границы раздела из
 * оглавления, свои страницы сохраняет — оглавление тоже распознаётся с
 * ошибками.
 */
function pageSpansFor(
  topics: readonly RibbonTopicInput[],
  sections: readonly RibbonSectionInput[],
): Map<string, Span[]> {
  const sectionPages = sectionPagesFor(sections);
  const byTopic = new Map<string, Span[]>();
  for (const topic of topics) {
    const raw: [number, number][] = [];
    for (const source of topic.sources ?? []) {
      const cited = pageSpan(source);
      const path = (source.section_path || "").trim();
      const whole = path ? sectionPages.get(path) : undefined;
      const span = union(cited, whole);
      if (span) raw.push(span);
    }
    if (raw.length === 0) continue;
    byTopic.set(
      topic.id,
      mergeSpans(raw).map(([startUnit, endUnit]) => ({
        topicId: topic.id,
        moduleIndex: topic.moduleIndex,
        startUnit,
        endUnit,
      })),
    );
  }
  return byTopic;
}

/** Отрезки по разделам — фолбэк для источников без страниц. */
function sectionSpansFor(
  topics: readonly RibbonTopicInput[],
  sections: readonly RibbonSectionInput[],
): Map<string, Span[]> {
  const ordered = [...sections].sort((a, b) => a.order_index - b.order_index);
  const slots = new Map<string, number>();
  ordered.forEach((section, index) => {
    const path = (section.path || "").trim();
    // Первый выигрывает: дубли путей в книге встречаются, и брать последний
    // значит сдвигать цитату в конец без причины.
    if (path && !slots.has(path)) slots.set(path, index + 1);
  });

  const byTopic = new Map<string, Span[]>();
  for (const topic of topics) {
    const raw: [number, number][] = [];
    for (const source of topic.sources ?? []) {
      const path = (source.section_path || "").trim();
      if (!path) continue;
      const slot = sectionSlot(path, slots);
      if (slot !== null) raw.push([slot, slot]);
    }
    if (raw.length === 0) continue;
    byTopic.set(
      topic.id,
      mergeSpans(raw).map(([startUnit, endUnit]) => ({
        topicId: topic.id,
        moduleIndex: topic.moduleIndex,
        startUnit,
        endUnit,
      })),
    );
  }
  return byTopic;
}

/**
 * Раскладка по дорожкам: жадно, интервал занимает первую свободную.
 *
 * Порядок сортировки — полный (`startUnit`, `endUnit`, `moduleIndex`,
 * `topicId`), поэтому результат детерминирован и не зависит от порядка
 * итерации `Map`.
 */
function assignLanes(spans: Span[]): RibbonSegment[] {
  const sorted = [...spans].sort(
    (a, b) =>
      a.startUnit - b.startUnit ||
      a.endUnit - b.endUnit ||
      a.moduleIndex - b.moduleIndex ||
      (a.topicId < b.topicId ? -1 : a.topicId > b.topicId ? 1 : 0),
  );

  const laneEnds: number[] = [];
  return sorted.map((span) => {
    let lane = laneEnds.findIndex((end) => end < span.startUnit);
    if (lane === -1) {
      if (laneEnds.length < MAX_LANES) {
        lane = laneEnds.length;
        laneEnds.push(span.endUnit);
      } else {
        // Дорожек больше трёх не заводим: кладём в ту, что освободится раньше
        // всех. Наложение здесь честнее, чем полоса высотой в пол-экрана.
        lane = laneEnds.indexOf(Math.min(...laneEnds));
        laneEnds[lane] = Math.max(laneEnds[lane], span.endUnit);
      }
    } else {
      laneEnds[lane] = span.endUnit;
    }
    return {
      key: `${span.topicId}:${span.startUnit}-${span.endUnit}`,
      topicId: span.topicId,
      moduleIndex: span.moduleIndex,
      startUnit: span.startUnit,
      endUnit: span.endUnit,
      startPct: 0,
      widthPct: 0,
      lane,
    };
  });
}

/** Объединение занятых слотов — для «сколько страниц вошло» и для пропусков. */
function unionOf(spans: Span[]): [number, number][] {
  return mergeSpans(spans.map((span) => [span.startUnit, span.endUnit]));
}

export function buildRibbon(input: RibbonInput): RibbonModel {
  const topics = input.topics ?? [];
  if (topics.length === 0) return { ...EMPTY };

  const byPage = pageSpansFor(topics, input.sections ?? []);
  const usePages = byPage.size > 0;
  const byTopic = usePages
    ? byPage
    : sectionSpansFor(topics, input.sections ?? []);

  const spans: Span[] = [];
  const unsourcedTopicIds: string[] = [];
  for (const topic of topics) {
    const own = byTopic.get(topic.id);
    if (!own || own.length === 0) {
      unsourcedTopicIds.push(topic.id);
      continue;
    }
    spans.push(...own);
  }

  const declaredCount = usePages ? pageNumber(input.pageCount) : (input.sections ?? []).length;
  const maxUnit = spans.reduce((max, span) => Math.max(max, span.endUnit), 0);
  // Ось РАСТЁТ, а не обрезает. Обрезать цитату по протухшему `page_count`
  // значит молча выбросить провенанс — ровно то, ради чего эта полоса есть.
  const unitCount = Math.max(declaredCount, maxUnit);

  if (unitCount <= 0) {
    return {
      ...EMPTY,
      scale: usePages ? "pages" : "sections",
      unsourcedTopicIds,
    };
  }

  const toPct = (startUnit: number, endUnit: number) => ({
    startPct: ((startUnit - 1) / unitCount) * 100,
    // Слот — интервал, а не точка: на двухстраничной книге страница 1 обязана
    // занять половину полосы, а не нулевую ширину.
    widthPct: ((endUnit - startUnit + 1) / unitCount) * 100,
  });

  const segments = assignLanes(spans).map((segment) => ({
    ...segment,
    ...toPct(segment.startUnit, segment.endUnit),
  }));

  const union = unionOf(spans);
  const claimedUnits = union.reduce((sum, [start, end]) => sum + (end - start + 1), 0);

  const gap = (startUnit: number, endUnit: number): RibbonGap => ({
    ...toPct(startUnit, endUnit),
    startUnit,
    endUnit,
  });

  const gaps: RibbonGap[] = [];
  let cursor = 1;
  for (const [start, end] of union) {
    if (start > cursor) gaps.push(gap(cursor, start - 1));
    cursor = end + 1;
  }
  if (cursor <= unitCount) gaps.push(gap(cursor, unitCount));

  const byModule = new Map<number, [number, number]>();
  for (const span of spans) {
    const current = byModule.get(span.moduleIndex);
    if (!current) {
      byModule.set(span.moduleIndex, [span.startUnit, span.endUnit]);
    } else {
      current[0] = Math.min(current[0], span.startUnit);
      current[1] = Math.max(current[1], span.endUnit);
    }
  }
  // `Array.from`, а не spread: цель компиляции ниже es2015, и итератор `Map`
  // там не разворачивается.
  const brackets: RibbonBracket[] = Array.from(byModule.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([moduleIndex, [start, end]]) => ({
      moduleIndex,
      ...toPct(start, end),
    }));

  return {
    scale: usePages ? "pages" : "sections",
    unitCount,
    segments,
    brackets,
    gaps,
    claimedUnits,
    totalUnits: unitCount,
    unsourcedTopicIds,
    axisExtended: maxUnit > declaredCount,
    // На книге в 600 страниц один слот — это 0.17%: в него не попасть курсором.
    // Геометрия остаётся честной, зону наведения расширяет компонент.
    minWidthPct: Math.max(100 / unitCount, MIN_VISIBLE_PCT),
    laneCount: segments.reduce((max, segment) => Math.max(max, segment.lane + 1), 0),
  };
}

/**
 * Подпись покрытия: «Страниц в программе: 34 из 212».
 *
 * Двоеточие вместо «34 страницы из 212» — чтобы обойти склонение числительных
 * без отдельного хелпера, а не потому, что так короче.
 */
export function coverageCaption(model: RibbonModel): string {
  const noun = model.scale === "pages" ? "Страниц" : "Разделов";
  return `${noun} в программе: ${model.claimedUnits} из ${model.totalUnits}`;
}

/** Сколько пропусков называем словами. Дальше список длиннее самой полосы. */
const NAMED_GAPS = 4;

/**
 * Подпись пропусков: «Не вошли: стр. 1–24, 210–216 и ещё 3 участка».
 *
 * Полоса показывает, ГДЕ дыры, а строка — какие именно. Это тот же ответ с
 * другой точностью, а не повтор: по картинке нельзя списать номер страницы, а
 * по списку нельзя увидеть, что вся вторая половина книги не разобрана.
 *
 * Пустая строка означает «дыр нет»: подпись «Не вошли: —» сообщала бы о
 * пропусках, которых нет.
 */
export function gapsCaption(model: RibbonModel): string {
  if (!model.gaps.length) return "";

  const named = model.gaps
    .slice(0, NAMED_GAPS)
    .map((gap) =>
      gap.startUnit === gap.endUnit
        ? `${gap.startUnit}`
        : `${gap.startUnit}–${gap.endUnit}`,
    )
    .join(", ");

  const rest = model.gaps.length - NAMED_GAPS;
  const tail = rest > 0 ? ` и ещё ${rest} ${spanWord(rest)}` : "";
  const prefix = model.scale === "pages" ? "Не вошли: стр. " : "Не вошли разделы: ";

  return `${prefix}${named}${tail}`;
}

function spanWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "участков";
  if (ones === 1) return "участок";
  if (ones >= 2 && ones <= 4) return "участка";
  return "участков";
}

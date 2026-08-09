// Пара «сейчас → цель» на упорядоченной шкале уровней.
//
// Инвариант один: цель не ниже текущего уровня. Два независимых выпадающих
// списка позволяли поставить цель ниже — и получить курс, который ничему не
// учит. Держим инвариант ВЫТАЛКИВАНИЕМ, а не блокировкой: маркер, замирающий
// под пальцем, читается как сломанный контрол, а уехавший сосед читается как
// правило.
//
// `current === target` разрешено намеренно: это программа на закрепление, и
// бэкенд её не запрещает. Выдумывать правило, которого там нет, нельзя.

import type { Level } from "@/lib/curriculum-api";

export const LEVEL_ORDER: readonly Level[] = [
  "none",
  "beginner",
  "school_basic",
  "school_confident",
  "advanced",
  "university",
];

export const LEVEL_LABELS: Record<Level, string> = {
  none: "С нуля",
  beginner: "Начальный",
  school_basic: "Школьный базовый",
  school_confident: "Школьный уверенный",
  advanced: "Продвинутый",
  university: "Университетский",
};

/** Короткие подписи под шкалой: полные названия там не помещаются. */
export const LEVEL_SHORT_LABELS: Record<Level, string> = {
  none: "С нуля",
  beginner: "Начальный",
  school_basic: "База",
  school_confident: "Уверенно",
  advanced: "Продвинутый",
  university: "Универ",
};

export interface LevelPair {
  current: Level;
  target: Level;
}

/** Маркер, который сейчас двигает человек. Смещается всегда ДРУГОЙ. */
export type MovedMarker = "current" | "target";

export function levelIndex(level: Level | string | null | undefined): number {
  const index = LEVEL_ORDER.indexOf(level as Level);
  return index === -1 ? 0 : index;
}

export function levelAt(index: number): Level {
  const clamped = Math.min(Math.max(Math.round(index), 0), LEVEL_ORDER.length - 1);
  return LEVEL_ORDER[clamped];
}

export function levelLabel(level: Level): string {
  return LEVEL_LABELS[level] ?? level;
}

/**
 * Приводит пару к валидной, сдвигая НЕ тот маркер, что под пальцем.
 *
 * Тянешь «сейчас» выше цели — уезжает цель. Тянешь цель ниже «сейчас» —
 * уезжает «сейчас».
 */
export function clampLevelPair(pair: LevelPair, moved: MovedMarker): LevelPair {
  const current = levelIndex(pair.current);
  const target = levelIndex(pair.target);
  if (current <= target) {
    return { current: levelAt(current), target: levelAt(target) };
  }
  return moved === "current"
    ? { current: levelAt(current), target: levelAt(current) }
    : { current: levelAt(target), target: levelAt(target) };
}

/** Сколько ступеней проходит курс. Ноль — программа на закрепление. */
export function levelSpan(pair: LevelPair): number {
  return Math.max(0, levelIndex(pair.target) - levelIndex(pair.current));
}

/** Доля 0…1 → ближайшая ступень. Нужна для перетаскивания указателем. */
export function levelFromFraction(fraction: number): Level {
  if (!Number.isFinite(fraction)) return LEVEL_ORDER[0];
  const last = LEVEL_ORDER.length - 1;
  return levelAt(Math.round(Math.min(Math.max(fraction, 0), 1) * last));
}

/** Позиция ступени на дорожке, 0…1. */
export function fractionForLevel(level: Level): number {
  return levelIndex(level) / (LEVEL_ORDER.length - 1);
}

function stepsWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "ступеней";
  if (ones === 1) return "ступень";
  if (ones >= 2 && ones <= 4) return "ступени";
  return "ступеней";
}

/**
 * Что объявляет screen reader при любом изменении.
 *
 * Смысл контрола — ПРОЛЁТ, а не два отдельных значения, и ни один слайдер сам
 * по себе его сказать не может. Поэтому объявляем пару целиком.
 */
export function spanAnnouncement(pair: LevelPair): string {
  const span = levelSpan(pair);
  if (span === 0) {
    return `Курс на закрепление уровня «${levelLabel(pair.current)}»`;
  }
  return `Курс: от «${levelLabel(pair.current)}» до «${levelLabel(
    pair.target,
  )}», ${span} ${stepsWord(span)}`;
}

/** Подпись под шкалой — тот же смысл, но для глаз. */
export function spanCaption(pair: LevelPair): string {
  const span = levelSpan(pair);
  if (span === 0) {
    return "Программа на закрепление: уровень остаётся тем же, растёт уверенность.";
  }
  return `Программа проведёт вас через ${span} ${stepsWord(span)}.`;
}

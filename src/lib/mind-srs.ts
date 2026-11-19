// Оценки повторения и подписи сроков на кнопках.
//
// Срок считает сервер по FSRS (`backend/mind/srs.py`) и присылает его для каждой оценки в
// `reviewIntervals`: здесь только подписи. Своего расчёта на фронтенде нет намеренно, иначе
// на кнопке было бы одно число, а сервер поставил бы другое.

import { plural as pluralWord, t } from "./i18n";
import type { ReviewRating } from "../types/mind";

/** Подписи оценок. Одни и те же на всех экранах повторения. */
// Геттеры: перевод считается при чтении, а не при загрузке модуля.
export const RATING_LABEL: Record<ReviewRating, string> = {
  get AGAIN() {
    return t("Не вспомнил");
  },
  get HARD() {
    return t("С трудом");
  },
  get GOOD() {
    return t("Вспомнил");
  },
  get EASY() {
    return t("Легко");
  },
};

/** Четыре оценки от худшей к лучшей, в этом порядке и стоят кнопки. */
export const REVIEW_RATES: ReadonlyArray<{ rating: ReviewRating; label: string }> = (
  ["AGAIN", "HARD", "GOOD", "EASY"] as const
).map((rating) => ({
  rating,
  get label() {
    return RATING_LABEL[rating];
  },
}));

/** Через сколько дней вернётся тема при этой оценке. `null`, если сервер срок не прислал. */
export function reviewDays(
  topic: { reviewIntervals?: Partial<Record<ReviewRating, number>> | null },
  rating: ReviewRating,
): number | null {
  const days = topic.reviewIntervals?.[rating];
  return typeof days === "number" && days >= 1 ? days : null;
}

/** «день», «дня», «дней»: выбирает форму по числу. */
export function plural(count: number, one: string, few: string, many: string): string {
  return pluralWord(count, one, few, many);
}

/** Когда тема вернётся, как на кнопке: «завтра», «через 5 дней», «через 2 недели». */
export function intervalLabel(days: number): string {
  if (days <= 1) return t("завтра");
  if (days === 7) return t("через неделю");
  if (days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? t("через год") : plural(years, "через {n} год", "через {n} года", "через {n} лет");
  }
  if (days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? t("через месяц") : plural(months, "через {n} месяц", "через {n} месяца", "через {n} месяцев");
  }
  if (days % 7 === 0) {
    const weeks = days / 7;
    return plural(weeks, "через {n} неделю", "через {n} недели", "через {n} недель");
  }
  return plural(days, "через {n} день", "через {n} дня", "через {n} дней");
}

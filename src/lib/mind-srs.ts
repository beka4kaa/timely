// Оценки повторения и подписи сроков на кнопках.
//
// Срок считает сервер по FSRS (`backend/mind/srs.py`) и присылает его для каждой оценки в
// `reviewIntervals`: здесь только подписи. Своего расчёта на фронтенде нет намеренно, иначе
// на кнопке было бы одно число, а сервер поставил бы другое.

import type { ReviewRating } from "../types/mind";

/** Подписи оценок. Одни и те же на всех экранах повторения. */
export const RATING_LABEL: Record<ReviewRating, string> = {
  AGAIN: "Не вспомнил",
  HARD: "С трудом",
  GOOD: "Вспомнил",
  EASY: "Легко",
};

/** Четыре оценки от худшей к лучшей, в этом порядке и стоят кнопки. */
export const REVIEW_RATES: ReadonlyArray<{ rating: ReviewRating; label: string }> = (
  ["AGAIN", "HARD", "GOOD", "EASY"] as const
).map((rating) => ({ rating, label: RATING_LABEL[rating] }));

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
  const hundred = Math.abs(count) % 100;
  const ten = hundred % 10;
  if (hundred > 10 && hundred < 20) return many;
  if (ten === 1) return one;
  if (ten >= 2 && ten <= 4) return few;
  return many;
}

/** Когда тема вернётся, как на кнопке: «завтра», «через 5 дней», «через 2 недели». */
export function intervalLabel(days: number): string {
  if (days <= 1) return "завтра";
  if (days === 7) return "через неделю";
  if (days % 365 === 0) {
    const years = days / 365;
    return years === 1 ? "через год" : `через ${years} ${plural(years, "год", "года", "лет")}`;
  }
  if (days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? "через месяц" : `через ${months} ${plural(months, "месяц", "месяца", "месяцев")}`;
  }
  if (days % 7 === 0) {
    const weeks = days / 7;
    return `через ${weeks} ${plural(weeks, "неделю", "недели", "недель")}`;
  }
  return `через ${days} ${plural(days, "день", "дня", "дней")}`;
}

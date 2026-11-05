// Интервал повторения на кнопках оценки: тот же расчёт, что в `backend/mind/srs.py`.
//
// Сервер остаётся источником правды: дату ставит он, а здесь только подпись на кнопке,
// чтобы ученик видел, когда тема вернётся, до того как нажмёт. Таблица в
// `mind-srs.test.ts` снята с питоновской функции: поменялся расчёт там, поменяй и здесь.

import type { ReviewRating, TopicStatus } from "../types/mind";

const MIN_EASE_FACTOR = 1.3;
const MAX_EASE_FACTOR = 3.0;
const DEFAULT_EASE_FACTOR = 2.5;

export interface ReviewInput {
  rating: ReviewRating;
  status: TopicStatus | string | null;
  intervalDays: number | null;
  easeFactor: number | null;
}

export interface ReviewOutcome {
  intervalDays: number;
  easeFactor: number;
  status: string;
}

/** Порт `mind.srs.next_review`: те же множители, границы и порядок действий. */
export function nextReview({ rating, status, intervalDays, easeFactor }: ReviewInput): ReviewOutcome {
  const interval = intervalDays || 1;
  const ease = easeFactor || DEFAULT_EASE_FACTOR;
  const current = status || "NOT_STARTED";

  if (rating === "AGAIN") {
    return {
      intervalDays: 1,
      easeFactor: Math.max(MIN_EASE_FACTOR, ease - 0.2),
      status: "MEDIUM",
    };
  }

  if (rating === "HARD") {
    return {
      intervalDays: Math.max(1, Math.trunc(interval * 1.2)),
      easeFactor: Math.max(MIN_EASE_FACTOR, ease - 0.15),
      status: current === "NOT_STARTED" ? "MEDIUM" : current,
    };
  }

  if (rating === "EASY") {
    // Интервал считается по текущей лёгкости, и только потом она растёт.
    let next = current;
    if (current === "NOT_STARTED" || current === "MEDIUM") next = "SUCCESS";
    else if (current === "SUCCESS") next = "MASTERED";
    return {
      intervalDays: Math.max(7, Math.trunc(interval * ease * 1.5)),
      easeFactor: Math.min(MAX_EASE_FACTOR, ease + 0.15),
      status: next,
    };
  }

  // GOOD
  if (current === "NOT_STARTED") {
    return { intervalDays: 1, easeFactor: ease, status: "MEDIUM" };
  }
  if (current === "MEDIUM") {
    return {
      intervalDays: Math.max(2, Math.trunc(interval * ease)),
      easeFactor: ease,
      status: interval >= 3 ? "SUCCESS" : "MEDIUM",
    };
  }
  if (current === "SUCCESS") {
    return {
      intervalDays: Math.max(4, Math.trunc(interval * ease)),
      easeFactor: ease,
      status: interval >= 7 ? "MASTERED" : "SUCCESS",
    };
  }
  return {
    intervalDays: Math.max(7, Math.trunc(interval * ease)),
    easeFactor: ease,
    status: current,
  };
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

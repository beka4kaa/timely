// Окна недельного ритма: как показать их ученику.
//
// Без React намеренно, как `schedule-commands.ts`: схлопывание дней — правило,
// а не разметка, и проверять его надо таблицей.
//
// Модель предлагает окно на КАЖДЫЙ день отдельно — иначе его не записать в
// шаблон, — но читать «пн 9:00, вт 9:00, ср 9:00, чт 9:00, пт 9:00» ученику
// незачем.

import { durationLabel } from "../../lib/studyplan-visuals.ts";
import type { ParsedStudyWindow } from "../../lib/studyplan-chat.ts";

const SHORT_DAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

/**
 * «пн–пт, 9:00, 3 ч» вместо пяти одинаковых строк.
 *
 * Схлопываются только ИДУЩИЕ ПОДРЯД дни с одинаковым временем и длительностью.
 * «пн, ср, пт» так и останется перечислением: это и есть разные дни, и
 * написать их диапазоном значило бы соврать про вторник и четверг.
 */
export function groupWindows(windows: readonly ParsedStudyWindow[]): string[] {
  const sorted = [...windows].sort(
    (a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time),
  );

  const lines: string[] = [];
  let run: ParsedStudyWindow[] = [];

  const flush = () => {
    if (run.length === 0) return;
    const first = run[0];
    const last = run[run.length - 1];
    const days =
      run.length === 1
        ? SHORT_DAYS[first.weekday]
        : `${SHORT_DAYS[first.weekday]}–${SHORT_DAYS[last.weekday]}`;
    lines.push(
      `${days}, ${first.start_time}, ${durationLabel(first.duration_minutes)}`,
    );
    run = [];
  };

  for (const window of sorted) {
    const previous = run[run.length - 1];
    const continues =
      previous !== undefined &&
      window.weekday === previous.weekday + 1 &&
      window.start_time === previous.start_time &&
      window.duration_minutes === previous.duration_minutes;
    if (!continues) flush();
    run.push(window);
  }
  flush();

  return lines;
}

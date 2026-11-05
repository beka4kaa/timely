import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHeatWeeks,
  buildHistoryRows,
  buildTodayStats,
  buildWeekBars,
  clockTime,
  dialSubtitle,
  dialTicks,
  heatLevel,
  sessionKey,
  summarizeHeat,
  sumSeconds,
  tickClass,
  withSessionName,
} from "./pomodoro.logic";
import { DAY_GOAL_MIN, dayKey, hm, clockOf, streakLabel } from "./pomodoro";
import type { FocusSessionRow } from "./pomodoro";

// Фиксированная точка отсчёта, чтобы тесты не зависели от текущей даты.
// 30 июля 2026 — четверг.
const TODAY = new Date(2026, 6, 30, 14, 0, 0);

function session(
  overrides: Partial<FocusSessionRow> & { started_at: string },
): FocusSessionRow {
  return {
    id: 1,
    kind: "focus",
    seconds: 3000,
    planned_seconds: 3000,
    preset_focus_min: 50,
    preset_break_min: 10,
    ...overrides,
  };
}

test("hm форматирует часы и минуты", () => {
  assert.equal(hm(0), "0 м");
  assert.equal(hm(40 * 60), "40 м");
  assert.equal(hm(60 * 60), "1 ч 00 м");
  assert.equal(hm(160 * 60), "2 ч 40 м");
});

test("clockOf всегда даёт MM:SS и не уходит в минус", () => {
  assert.equal(clockOf(0), "00:00");
  assert.equal(clockOf(65), "01:05");
  assert.equal(clockOf(50 * 60), "50:00");
  assert.equal(clockOf(-10), "00:00");
});

test("streakLabel склоняет дни по-русски", () => {
  assert.equal(streakLabel(1), "1 день");
  assert.equal(streakLabel(3), "3 дня");
  assert.equal(streakLabel(7), "7 дней");
  assert.equal(streakLabel(11), "11 дней");
  assert.equal(streakLabel(21), "21 день");
  assert.equal(streakLabel(112), "112 дней");
});

test("heatLevel разбивает время на пять ступеней", () => {
  assert.equal(heatLevel(0), 0);
  assert.equal(heatLevel(20 * 60), 1);
  assert.equal(heatLevel(60 * 60), 2);
  assert.equal(heatLevel(100 * 60), 3);
  assert.equal(heatLevel(200 * 60), 4);
});

test("календарь активности — 52 колонки по 7 дней, начиная с понедельника", () => {
  const weeks = buildHeatWeeks({}, TODAY);

  assert.equal(weeks.length, 52);
  weeks.forEach((week) => assert.equal(week.days.length, 7));
  // Первая строка сетки — всегда понедельник (getDay() === 1).
  assert.equal(weeks[0].days[0].date.getDay(), 1);
  assert.equal(weeks[0].days[6].date.getDay(), 0);
});

test("календарь помечает сегодня и не заполняет будущее", () => {
  const weeks = buildHeatWeeks({}, TODAY);
  const cells = weeks.flatMap((week) => week.days);

  const todayCells = cells.filter((cell) => cell.isToday);
  assert.equal(todayCells.length, 1);
  assert.equal(todayCells[0].key, dayKey(TODAY));
  assert.equal(todayCells[0].isFuture, false);

  const future = cells.filter((cell) => cell.isFuture);
  assert.ok(future.length > 0, "после сегодня в сетке должны остаться пустые дни");
  future.forEach((cell) => {
    assert.equal(cell.seconds, 0);
    assert.equal(cell.level, 0);
  });
});

test("календарь раскрашивает дни по данным сводки", () => {
  const daily = {
    [dayKey(TODAY)]: 150 * 60,
    [dayKey(new Date(2026, 6, 29))]: 20 * 60,
  };
  const cells = buildHeatWeeks(daily, TODAY).flatMap((week) => week.days);

  const today = cells.find((cell) => cell.key === dayKey(TODAY));
  assert.equal(today?.level, 4);
  assert.equal(today?.tooltipTitle, "2 ч 30 м учёбы");

  const yesterday = cells.find((cell) => cell.key === dayKey(new Date(2026, 6, 29)));
  assert.equal(yesterday?.level, 1);

  const empty = cells.find((cell) => cell.key === dayKey(new Date(2026, 6, 28)));
  assert.equal(empty?.tooltipTitle, "Без занятий");
});

test("итоги календаря считают активные дни и лучший день", () => {
  const daily = {
    [dayKey(TODAY)]: 60 * 60,
    [dayKey(new Date(2026, 6, 28))]: 180 * 60,
    [dayKey(new Date(2026, 6, 20))]: 30 * 60,
  };
  const stats = summarizeHeat(buildHeatWeeks(daily, TODAY));

  assert.equal(stats.activeDays, 3);
  assert.equal(stats.totalSeconds, (60 + 180 + 30) * 60);
  assert.equal(stats.best?.seconds, 180 * 60);
  assert.equal(stats.best?.label, "28 июля");
});

test("итоги пустого календаря не выдумывают лучший день", () => {
  const stats = summarizeHeat(buildHeatWeeks({}, TODAY));
  assert.equal(stats.activeDays, 0);
  assert.equal(stats.totalSeconds, 0);
  assert.equal(stats.best, null);
});

test("недельные столбики — 7 дней, последний сегодня", () => {
  const daily = { [dayKey(TODAY)]: 120 * 60 };
  const bars = buildWeekBars(daily, TODAY);

  assert.equal(bars.length, 7);
  assert.equal(bars[6].isToday, true);
  assert.equal(bars[6].label, "чт");
  assert.equal(bars[0].isToday, false);
  // Максимум набора — сегодня, значит его столбик полный.
  assert.equal(bars[6].ratio, 1);
  assert.equal(bars[0].ratio, 0);
});

test("столбики нормируются минимум к часу, чтобы короткий день не был во всю высоту", () => {
  const bars = buildWeekBars({ [dayKey(TODAY)]: 30 * 60 }, TODAY);
  assert.equal(bars[6].ratio, 0.5);
});

test("история сортируется от поздних к ранним и отмечает прерванные", () => {
  const rows = buildHistoryRows([
    session({ id: 1, started_at: "2026-07-30T09:05:00Z", seconds: 3000 }),
    session({ id: 2, started_at: "2026-07-30T11:20:00Z", seconds: 1500 }),
    session({
      id: 3,
      kind: "break",
      started_at: "2026-07-30T10:00:00Z",
      seconds: 600,
      planned_seconds: 600,
    }),
  ]);

  assert.deepEqual(
    rows.map((row) => row.id),
    [2, 3, 1],
  );

  const partial = rows.find((row) => row.id === 2);
  assert.equal(partial?.stoppedEarly, true);
  assert.equal(partial?.minutes, 25);
  assert.equal(partial?.startedAt, "2026-07-30T11:20:00Z");

  const full = rows.find((row) => row.id === 1);
  assert.equal(full?.stoppedEarly, false);
  assert.equal(full?.minutes, 50);

  const brk = rows.find((row) => row.id === 3);
  assert.equal(brk?.isFocus, false);
});

test("история пустая, когда сессий нет", () => {
  assert.deepEqual(buildHistoryRows([]), []);
});

test("сегодня: перерывы не идут в время учёбы", () => {
  const stats = buildTodayStats([
    session({ id: 1, started_at: "2026-07-30T09:00:00Z", seconds: 3000 }),
    session({ id: 2, started_at: "2026-07-30T10:00:00Z", seconds: 1800 }),
    session({
      id: 3,
      kind: "break",
      started_at: "2026-07-30T10:50:00Z",
      seconds: 600,
      planned_seconds: 600,
    }),
  ]);

  assert.equal(stats.focusSeconds, 4800);
  assert.equal(stats.focusCount, 2);
  assert.equal(stats.breakCount, 1);
  assert.equal(stats.goalPercent, Math.round((4800 / (DAY_GOAL_MIN * 60)) * 100));
});

test("сегодня: незавершённая фаза учитывается как живое время", () => {
  const stats = buildTodayStats([], 900);
  assert.equal(stats.focusSeconds, 900);
  assert.equal(stats.focusCount, 0);
});

test("сегодня: прогресс цели не превышает 100%", () => {
  const stats = buildTodayStats([], DAY_GOAL_MIN * 60 * 3);
  assert.equal(stats.goalPercent, 100);
});

test("циферблат: чёрточка на минуту, каждая пятая длиннее", () => {
  const ticks = dialTicks(50 * 60);
  assert.equal(ticks.length, 50);
  const length = (tick: (typeof ticks)[number]) => Math.hypot(tick.x2 - tick.x1, tick.y2 - tick.y1);
  assert.ok(length(ticks[0]) > length(ticks[1]));
  assert.ok(Math.abs(length(ticks[0]) - length(ticks[5])) < 0.05);
  // Первая смотрит строго вверх.
  assert.equal(ticks[0].x1, 140);
  assert.equal(ticks[0].y1, 29);
  assert.equal(ticks[0].y2, 4);
});

test("циферблат: толщина зависит от числа минут и не выходит за границы", () => {
  assert.equal(dialTicks(5 * 60)[0].width, 6);
  assert.equal(dialTicks(50 * 60)[0].width, 3.8);
  assert.equal(dialTicks(90 * 60)[0].width, 2.4);
});

test("прошедшие минуты гаснут, идущая отмечена", () => {
  assert.equal(tickClass(0, 0, 3000), "now");
  assert.equal(tickClass(1, 0, 3000), "");
  assert.equal(tickClass(6, 7 * 60, 43 * 60), "gone");
  assert.equal(tickClass(7, 7 * 60, 43 * 60), "now");
  assert.equal(tickClass(8, 7 * 60, 43 * 60), "");
  // На нуле идущей уже нет.
  assert.equal(tickClass(49, 49 * 60 + 59, 0), "");
});

test("подпись под цифрами", () => {
  const now = new Date(2026, 6, 30, 16, 12, 0).getTime();
  const base = { now, planned: 3000 };
  assert.equal(dialSubtitle({ ...base, phase: "focus", running: true, remaining: 43 * 60 }), "до 16:55");
  assert.equal(dialSubtitle({ ...base, phase: "focus", running: false, remaining: 43 * 60 }), "пауза, до 16:55");
  assert.equal(dialSubtitle({ ...base, phase: "focus", running: false, remaining: 3000 }), "50 минут");
  assert.equal(dialSubtitle({ now, planned: 600, phase: "break", running: true, remaining: 300 }), "перерыв, до 16:17");
  assert.equal(dialSubtitle({ now, planned: 600, phase: "break", running: false, remaining: 300 }), "пауза, до 16:17");
  assert.equal(dialSubtitle({ now, planned: 600, phase: "break", running: false, remaining: 600 }), "перерыв 10 минут");
});

test("clockTime дополняет нулями", () => {
  assert.equal(clockTime(new Date(2026, 6, 30, 9, 5)), "09:05");
});

test("имя сессии находится по моменту, а не по записи времени", () => {
  // Клиент отправил с миллисекундами, сервер вернул с микросекундами.
  assert.equal(sessionKey("2026-07-30T09:05:00.123Z"), sessionKey("2026-07-30T09:05:00.123000Z"));
  const names = withSessionName({}, "2026-07-30T09:05:00.123Z", " Физика ");
  assert.equal(names[sessionKey("2026-07-30T09:05:00.123000Z")], "Физика");
});

test("имя сессии: пустое не хранится, первое не затирается, старые забываются", () => {
  assert.deepEqual(withSessionName({}, "2026-07-30T09:05:00Z", "  "), {});
  const first = withSessionName({}, "2026-07-30T09:05:00Z", "Физика");
  assert.equal(withSessionName(first, "2026-07-30T09:05:00Z", "Алгебра"), first);

  let names: Record<string, string> = {};
  for (let minute = 0; minute < 5; minute += 1) {
    names = withSessionName(names, `2026-07-30T09:0${minute}:00Z`, `s${minute}`, 3);
  }
  assert.deepEqual(Object.values(names), ["s2", "s3", "s4"]);
});

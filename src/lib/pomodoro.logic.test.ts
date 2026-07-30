import assert from "node:assert/strict";
import test from "node:test";

import {
  buildChartBars,
  buildHeatWeeks,
  buildHistoryRows,
  buildTodayStats,
  buildWeekBars,
  heatColor,
  heatLevel,
  summarizeHeat,
  sumSeconds,
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
  assert.equal(heatColor(0), "#ece6db");
  assert.equal(heatColor(200 * 60), "#855c22");
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
    assert.equal(cell.color, "transparent");
  });
});

test("календарь раскрашивает дни по данным сводки", () => {
  const daily = {
    [dayKey(TODAY)]: 150 * 60,
    [dayKey(new Date(2026, 6, 29))]: 20 * 60,
  };
  const cells = buildHeatWeeks(daily, TODAY).flatMap((week) => week.days);

  const today = cells.find((cell) => cell.key === dayKey(TODAY));
  assert.equal(today?.color, "#855c22");
  assert.equal(today?.tooltipTitle, "2 ч 30 м учёбы");

  const yesterday = cells.find((cell) => cell.key === dayKey(new Date(2026, 6, 29)));
  assert.equal(yesterday?.color, "#eed9b6");

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

test("диаграмма за 21 день помечает достижение цели", () => {
  const daily = {
    [dayKey(TODAY)]: DAY_GOAL_MIN * 60,
    [dayKey(new Date(2026, 6, 29))]: 30 * 60,
  };
  const bars = buildChartBars(daily, TODAY);

  assert.equal(bars.length, 21);
  assert.equal(bars[20].reachedGoal, true);
  assert.equal(bars[19].reachedGoal, false);
  assert.equal(bars[20].label, "30");
  assert.equal(sumSeconds(bars), (DAY_GOAL_MIN + 30) * 60);
});

test("история сортируется от поздних к ранним и считает деления", () => {
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
  assert.equal(partial?.title, "Фокус-сессия");
  assert.equal(partial?.filledDots, 3); // 1500 из 3000 → половина пяти делений
  assert.match(partial?.meta ?? "", /остановлено раньше/);

  const full = rows.find((row) => row.id === 1);
  assert.equal(full?.filledDots, 5);
  assert.match(full?.meta ?? "", /завершено полностью/);
  assert.equal(full?.duration, "50 м");

  const brk = rows.find((row) => row.id === 3);
  assert.equal(brk?.isFocus, false);
  assert.equal(brk?.title, "Перерыв");
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

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blocksWord,
  buildDayDetail,
  buildHistoryDays,
  dayTitle,
  daysBack,
  durationWords,
  isDayKey,
  ribbonSpan,
} from "./focus-history";
import type { FocusSessionRow } from "./pomodoro";

let id = 0;
function row(kind: "focus" | "break", local: string, minutes: number, planned = minutes): FocusSessionRow {
  id += 1;
  return {
    id,
    kind,
    started_at: new Date(local).toISOString(),
    seconds: minutes * 60,
    planned_seconds: planned * 60,
    preset_focus_min: 50,
    preset_break_min: 10,
  };
}

const sessions = [
  row("focus", "2026-11-19T16:00:00", 50),
  row("break", "2026-11-19T16:50:00", 10),
  row("focus", "2026-11-19T17:00:00", 30, 50),
  row("break", "2026-11-19T17:30:00", 30),
  row("focus", "2026-11-17T09:00:00", 25),
  row("break", "2026-11-16T09:00:00", 10),
];

test("days with study, newest first, with study, rest and block counts", () => {
  assert.deepEqual(buildHistoryDays(sessions), [
    { key: "2026-11-19", focusSeconds: 80 * 60, restSeconds: 40 * 60, blocks: 2 },
    { key: "2026-11-17", focusSeconds: 25 * 60, restSeconds: 0, blocks: 1 },
  ]);
});

test("a day is its blocks and rests in order, numbered blocks only", () => {
  const day = buildDayDetail(sessions, "2026-11-19");
  assert.ok(day);
  assert.equal(day.blocks, 2);
  assert.equal(day.focusSeconds, 80 * 60);
  assert.equal(day.restSeconds, 40 * 60);
  assert.deepEqual(
    day.parts.map((part) => [part.kind, part.number, part.start, part.end, part.stoppedEarly, part.long]),
    [
      ["focus", 1, "16:00", "16:50", false, false],
      ["rest", null, "16:50", "17:00", false, false],
      ["focus", 2, "17:00", "17:30", true, false],
      ["rest", null, "17:30", "18:00", false, true],
    ],
  );
  assert.equal(buildDayDetail(sessions, "2026-11-16"), null);
  assert.equal(buildDayDetail(sessions, "2026-11-18"), null);
});

test("the ribbon places each phase by its share of the day", () => {
  const day = buildDayDetail(sessions, "2026-11-19")!;
  const [first, , second] = day.parts;
  // 16:00–18:00 is two hours: 50 minutes from the start, then 30 minutes from the middle.
  const round = ({ left, width }: { left: number; width: number }) => [Math.round(left), Math.round(width)];
  assert.deepEqual(round(ribbonSpan(first, day.from, day.to)), [0, 42]);
  assert.deepEqual(round(ribbonSpan(second, day.from, day.to)), [50, 25]);
});

test("durations are whole Russian words", () => {
  assert.equal(durationWords(50 * 60), "50 минут");
  assert.equal(durationWords(60 * 60), "1 час");
  assert.equal(durationWords(160 * 60), "2 часа 40 минут");
  assert.equal(durationWords(61 * 60), "1 час 1 минута");
  assert.equal(durationWords(5 * 3600 + 22 * 60), "5 часов 22 минуты");
  assert.equal(durationWords(0), "0 минут");
  assert.equal(blocksWord(1), "1 блок");
  assert.equal(blocksWord(3), "3 блока");
  assert.equal(blocksWord(11), "11 блоков");
});

test("day titles read like speech", () => {
  const today = new Date(2026, 10, 19, 12);
  assert.equal(dayTitle("2026-11-19", today), "Сегодня");
  assert.equal(dayTitle("2026-11-18", today), "Вчера");
  assert.equal(dayTitle("2026-11-17", today), "Вторник, 17 ноября");
  assert.equal(dayTitle("2025-12-31", today), "Среда, 31 декабря 2025");
});

test("only real dates are day keys, and the window reaches back to the day", () => {
  assert.equal(isDayKey("2026-11-19"), true);
  assert.equal(isDayKey("2026-02-30"), false);
  assert.equal(isDayKey("19.11.2026"), false);
  const today = new Date(2026, 10, 19, 12);
  assert.equal(daysBack("2026-11-19", today), 2);
  assert.equal(daysBack("2026-11-09", today), 12);
  assert.equal(daysBack("2020-01-01", today), 400);
});

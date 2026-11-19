import assert from "node:assert/strict";
import { test } from "node:test";

import { sentAt, timeAgo } from "./time-ago.ts";

const now = new Date(2026, 10, 19, 15, 0).getTime();
const before = (ms: number) => now - ms;
const MIN = 60_000;
const HOUR = 60 * MIN;

test("только что, минуты и часы назад", () => {
  assert.equal(timeAgo(before(20_000), now), "только что");
  assert.equal(timeAgo(before(1 * MIN), now), "1 минуту назад");
  assert.equal(timeAgo(before(2 * MIN), now), "2 минуты назад");
  assert.equal(timeAgo(before(5 * MIN), now), "5 минут назад");
  assert.equal(timeAgo(before(21 * MIN), now), "21 минуту назад");
  assert.equal(timeAgo(before(1 * HOUR), now), "1 час назад");
  assert.equal(timeAgo(before(3 * HOUR), now), "3 часа назад");
  assert.equal(timeAgo(before(6 * HOUR), now), "6 часов назад");
  assert.equal(timeAgo(before(23 * HOUR), now), "23 часа назад");
});

test("вчера, дни назад и дата", () => {
  assert.equal(timeAgo(new Date(2026, 10, 18, 9, 0).getTime(), now), "вчера");
  assert.equal(timeAgo(new Date(2026, 10, 16, 12, 0).getTime(), now), "3 дня назад");
  assert.equal(timeAgo(new Date(2026, 10, 14, 12, 0).getTime(), now), "5 дней назад");
  assert.equal(timeAgo(new Date(2026, 10, 9, 12, 0).getTime(), now), "9 ноября");
  assert.equal(timeAgo(new Date(2025, 11, 31, 12, 0).getTime(), now), "31 декабря 2025");
});

test("часы на устройстве чуть спешат: время из будущего — это «только что»", () => {
  assert.equal(timeAgo(now + 30_000, now), "только что");
});

test("точное время во всплывающей подсказке, год — только если не нынешний", () => {
  assert.equal(sentAt(new Date(2026, 10, 19, 14, 5).getTime(), now), "19 ноября, 14:05");
  assert.equal(sentAt(new Date(2025, 0, 3, 9, 7).getTime(), now), "3 января 2025, 9:07");
});

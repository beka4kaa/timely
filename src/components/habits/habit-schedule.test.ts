import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVERY_DAY,
  habitWhen,
  nextDayWord,
  sameSchedule,
  scheduleLabel,
  scheduleOf,
  schedulePatch,
  toggleDay,
  withFrequency,
  type HabitSchedule,
  type HabitWhen,
} from "./habit-schedule";

const days = (...weekdays: number[]): HabitSchedule => ({ frequency: "weekdays", weekdays, intervalDays: 2 });
const every = (intervalDays: number): HabitSchedule => ({ frequency: "interval", weekdays: [], intervalDays });

test("частота называется словами", () => {
  assert.equal(scheduleLabel(EVERY_DAY), "Каждый день");
  assert.equal(scheduleLabel(days(0, 1, 2, 3, 4)), "По будням");
  assert.equal(scheduleLabel(days(5, 6)), "По выходным");
  assert.equal(scheduleLabel(days(2)), "По средам");
  assert.equal(scheduleLabel(days(4, 0, 2)), "Пн, ср, пт");
  assert.equal(scheduleLabel(every(2)), "Через день");
  assert.equal(scheduleLabel(every(3)), "Раз в 3 дня");
  assert.equal(scheduleLabel(every(5)), "Раз в 5 дней");
  assert.equal(scheduleLabel(every(7)), "Раз в неделю");
  assert.equal(scheduleLabel(every(21)), "Раз в 21 день");
});

test("все семь дней это каждый день", () => {
  assert.equal(scheduleLabel(days(0, 1, 2, 3, 4, 5, 6)), "Каждый день");
  assert.equal(schedulePatch(days(0, 1, 2, 3, 4, 5, 6)).frequency, "daily");
});

test("в запись идёт только то, что нужно выбранному варианту", () => {
  assert.deepEqual(schedulePatch({ frequency: "daily", weekdays: [1], intervalDays: 9 }), {
    frequency: "daily",
    weekdays: [],
    interval_days: 2,
  });
  assert.deepEqual(schedulePatch({ frequency: "weekdays", weekdays: [4, 0, 4], intervalDays: 9 }), {
    frequency: "weekdays",
    weekdays: [0, 4],
    interval_days: 2,
  });
  assert.deepEqual(schedulePatch({ frequency: "interval", weekdays: [1], intervalDays: 9 }), {
    frequency: "interval",
    weekdays: [],
    interval_days: 9,
  });
});

test("интервал не выходит за то, что примет сервер", () => {
  assert.equal(schedulePatch(every(1)).interval_days, 2);
  assert.equal(schedulePatch(every(99)).interval_days, 30);
});

test("старая запись без частоты это каждый день", () => {
  assert.deepEqual(scheduleOf({}), EVERY_DAY);
  assert.deepEqual(scheduleOf({ frequency: "interval", interval_days: 4 }), every(4));
});

test("одинаковое считается одинаковым, сколько бы ни лежало в черновике", () => {
  assert.ok(sameSchedule(days(0, 2), days(2, 0)));
  assert.ok(sameSchedule({ ...EVERY_DAY, weekdays: [1, 2] }, EVERY_DAY));
  assert.ok(!sameSchedule(days(0, 2), days(0)));
  assert.ok(!sameSchedule(every(2), every(3)));
  assert.ok(!sameSchedule(every(2), EVERY_DAY));
});

test("открыл дни недели, и там уже есть что подтвердить", () => {
  assert.deepEqual(withFrequency(EVERY_DAY, "weekdays").weekdays, [0, 2, 4]);
  assert.deepEqual(withFrequency(days(1), "weekdays").weekdays, [1], "свой выбор не сбрасывается");
  assert.deepEqual(withFrequency(days(1), "daily").weekdays, [1], "вернулся к дням, а они на месте");
});

test("дни переключаются и идут по порядку, а последний не снимается", () => {
  assert.deepEqual(toggleDay(days(4), 0).weekdays, [0, 4]);
  assert.deepEqual(toggleDay(days(0, 4), 4).weekdays, [0]);
  assert.deepEqual(toggleDay(days(0), 0).weekdays, [0]);
});

test("следующий раз называется словами", () => {
  // 6 ноября 2026 это пятница.
  assert.equal(nextDayWord("2026-11-06", "2026-11-06"), "");
  assert.equal(nextDayWord(null, "2026-11-06"), "");
  assert.equal(nextDayWord("2026-11-07", "2026-11-06"), "завтра");
  assert.equal(nextDayWord("2026-11-08", "2026-11-06"), "послезавтра");
  assert.equal(nextDayWord("2026-11-09", "2026-11-06"), "в понедельник");
  assert.equal(nextDayWord("2026-11-10", "2026-11-06"), "во вторник");
  assert.equal(nextDayWord("2026-11-13", "2026-11-06"), "через 7 дней");
  assert.equal(nextDayWord("2026-12-06", "2026-11-06"), "через 30 дней");
});

const card = (schedule: HabitSchedule, state: Partial<HabitWhen> = {}): HabitWhen => ({
  ...schedule,
  dueToday: true,
  doneToday: false,
  nextDue: "2026-11-06",
  today: "2026-11-06",
  ...state,
});

test("у ежедневной подписи нет", () => {
  assert.equal(habitWhen(card(EVERY_DAY)), "");
});

test("сегодня ждёт: только как часто", () => {
  assert.equal(habitWhen(card(days(0, 4))), "Пн, пт");
  assert.equal(habitWhen(card(every(3))), "Раз в 3 дня");
});

test("сегодня отдых или уже сделано: подсказка, когда снова", () => {
  assert.equal(habitWhen(card(days(0, 2), { dueToday: false, nextDue: "2026-11-09" })), "Пн, ср, снова в понедельник");
  assert.equal(habitWhen(card(every(3), { doneToday: true, nextDue: "2026-11-09" })), "Раз в 3 дня, снова в понедельник");
  assert.equal(habitWhen(card(every(2), { dueToday: false, nextDue: "2026-11-07" })), "Через день, снова завтра");
});

test("один день в неделю подпись уже назвала", () => {
  assert.equal(habitWhen(card(days(0), { dueToday: false, nextDue: "2026-11-09" })), "По понедельникам");
});

test("пока ответ сервера не пришёл, подпись не врёт", () => {
  // Только что отметили: сервер ещё не сказал, когда снова, и старый день это сегодня.
  assert.equal(habitWhen(card(every(3), { doneToday: true })), "Раз в 3 дня");
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadRatio, weekLoad, type LoadEntry } from "./studyplan-load.ts";

const WEEK = [
  "2026-08-10",
  "2026-08-11",
  "2026-08-12",
  "2026-08-13",
  "2026-08-14",
  "2026-08-15",
  "2026-08-16",
];

function entry(overrides: Partial<LoadEntry> = {}): LoadEntry {
  return {
    dateKey: "2026-08-10",
    minutes: 60,
    accent: "#8a5b24",
    ...overrides,
  };
}

test("минуты одного дня складываются", () => {
  const load = weekLoad(WEEK, [
    entry({ minutes: 45 }),
    entry({ minutes: 30 }),
  ]);
  assert.equal(load.days[0].totalMinutes, 75);
  assert.equal(load.totalMinutes, 75);
});

test("занятия одного курса сливаются в один сегмент, разных — в разные", () => {
  const load = weekLoad(WEEK, [
    entry({ minutes: 60, accent: "#8a5b24" }),
    entry({ minutes: 30, accent: "#8a5b24" }),
    entry({ minutes: 45, accent: "#4f6d5a" }),
  ]);
  assert.deepEqual(load.days[0].segments, [
    { accent: "#8a5b24", minutes: 90 },
    { accent: "#4f6d5a", minutes: 45 },
  ]);
});

test("порядок сегментов устойчив при равном объёме", () => {
  // Без второго ключа сортировки два одинаковых по времени курса менялись бы
  // местами между рендерами, и лента мерцала бы.
  const first = weekLoad(WEEK, [
    entry({ accent: "#8a5b24" }),
    entry({ accent: "#4f6d5a" }),
  ]);
  const second = weekLoad(WEEK, [
    entry({ accent: "#4f6d5a" }),
    entry({ accent: "#8a5b24" }),
  ]);
  assert.deepEqual(first.days[0].segments, second.days[0].segments);
});

test("все семь дней остаются на месте, даже пустые", () => {
  const load = weekLoad(WEEK, [entry({ dateKey: "2026-08-13" })]);
  assert.equal(load.days.length, 7);
  assert.deepEqual(
    load.days.map((day) => day.dateKey),
    WEEK,
  );
  assert.equal(load.days[0].totalMinutes, 0);
  assert.deepEqual(load.days[0].segments, []);
});

test("отменённое и перенесённое не держит день занятым", () => {
  const load = weekLoad(WEEK, [
    entry({ minutes: 60, released: true }),
    entry({ minutes: 30 }),
  ]);
  assert.equal(load.days[0].totalMinutes, 30);
});

test("запись вне недели не подмешивается в итог", () => {
  const load = weekLoad(WEEK, [entry({ dateKey: "2026-08-17", minutes: 600 })]);
  assert.equal(load.totalMinutes, 0);
  assert.equal(load.peakDateKey, null);
});

test("пик недели — самый плотный день", () => {
  const load = weekLoad(WEEK, [
    entry({ dateKey: "2026-08-10", minutes: 60 }),
    entry({ dateKey: "2026-08-12", minutes: 180 }),
    entry({ dateKey: "2026-08-14", minutes: 90 }),
  ]);
  assert.equal(load.peakDateKey, "2026-08-12");
  assert.equal(load.peakMinutes, 180);
});

test("при равенстве пиком считается более ранний день", () => {
  const load = weekLoad(WEEK, [
    entry({ dateKey: "2026-08-11", minutes: 120 }),
    entry({ dateKey: "2026-08-13", minutes: 120 }),
  ]);
  assert.equal(load.peakDateKey, "2026-08-11");
});

test("пустая неделя не выдумывает пик", () => {
  const load = weekLoad(WEEK, []);
  assert.equal(load.totalMinutes, 0);
  assert.equal(load.peakDateKey, null);
  assert.equal(load.peakMinutes, 0);
});

test("нулевая и отрицательная длительность не ломают ленту", () => {
  const load = weekLoad(WEEK, [entry({ minutes: 0 }), entry({ minutes: -30 })]);
  assert.equal(load.days[0].totalMinutes, 0);
  assert.deepEqual(load.days[0].segments, []);
});

test("столбик масштабируется по самому плотному дню", () => {
  assert.equal(loadRatio(180, 180), 1);
  assert.equal(loadRatio(90, 180), 0.5);
});

test("короткое занятие видно как занятое, а не как пустой день", () => {
  // Пол в 0.12: без него 15 минут против пятичасового пика дали бы столбик
  // в один пиксель, неотличимый от свободного дня.
  assert.equal(loadRatio(15, 300), 0.12);
});

test("свободный день и неделя без пика дают ноль", () => {
  assert.equal(loadRatio(0, 180), 0);
  assert.equal(loadRatio(60, 0), 0);
});

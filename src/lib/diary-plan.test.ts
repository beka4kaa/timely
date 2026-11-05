import assert from "node:assert/strict";
import { test } from "node:test";

import {
  firstFreeSlot,
  lessonSpans,
  planTitle,
  planWhenLabel,
  plannedEntryFor,
  rhythmWindows,
} from "./diary-plan.ts";

const ZONE = "Asia/Bishkek"; // UTC+6, без перевода часов

function at(date: string, clock: string): Date {
  return new Date(`${date}T${clock}:00+06:00`);
}

function span(date: string, from: string, to: string) {
  return { start: at(date, from).getTime(), end: at(date, to).getTime() };
}

test("без ритма берёт вторую половину ближайшего дня", () => {
  const slot = firstFreeSlot({
    now: at("2026-11-05", "10:00"),
    timeZone: ZONE,
    rhythm: [],
    busy: [],
    deadline: at("2026-11-06", "08:00"),
  });
  assert.equal(slot?.dateKey, "2026-11-05");
  assert.equal(slot?.start.getTime(), at("2026-11-05", "15:00").getTime());
  assert.equal(slot?.end.getTime(), at("2026-11-05", "15:30").getTime());
});

test("обходит занятое и не ставит на прошедшее время", () => {
  const slot = firstFreeSlot({
    now: at("2026-11-05", "16:02"),
    timeZone: ZONE,
    rhythm: [],
    busy: [span("2026-11-05", "16:00", "17:00")],
    deadline: at("2026-11-06", "08:00"),
  });
  assert.equal(slot?.start.getTime(), at("2026-11-05", "17:00").getTime());
});

test("ритм важнее второй половины дня", () => {
  const slot = firstFreeSlot({
    now: at("2026-11-05", "10:00"),
    timeZone: ZONE,
    rhythm: [{ weekday: 3, start: 18 * 60, minutes: 60 }],
    busy: [],
    deadline: at("2026-11-06", "08:00"),
  });
  assert.equal(slot?.start.getTime(), at("2026-11-05", "18:00").getTime());
});

test("ритм занят целиком: запасной вариант вторая половина дня", () => {
  const slot = firstFreeSlot({
    now: at("2026-11-05", "10:00"),
    timeZone: ZONE,
    rhythm: [{ weekday: 3, start: 18 * 60, minutes: 60 }],
    busy: [span("2026-11-05", "18:00", "19:00")],
    deadline: at("2026-11-06", "08:00"),
  });
  assert.equal(slot?.start.getTime(), at("2026-11-05", "15:00").getTime());
});

test("идёт по дням до сдачи", () => {
  const slot = firstFreeSlot({
    now: at("2026-11-05", "22:00"),
    timeZone: ZONE,
    rhythm: [],
    busy: [],
    deadline: at("2026-11-07", "08:00"),
  });
  assert.equal(slot?.dateKey, "2026-11-06");
});

test("после начала урока задание не ставит", () => {
  // Вечером накануне мест нет, а утром второй половины дня ещё не настало.
  assert.equal(
    firstFreeSlot({
      now: at("2026-11-05", "22:00"),
      timeZone: ZONE,
      rhythm: [],
      busy: [],
      deadline: at("2026-11-06", "08:00"),
    }),
    null,
  );
  // Урок после обеда: успеть можно только до него.
  const before = firstFreeSlot({
    now: at("2026-11-05", "14:00"),
    timeZone: ZONE,
    rhythm: [],
    busy: [],
    deadline: at("2026-11-05", "15:20"),
  });
  assert.equal(before, null);
  // Сдавать уже поздно.
  assert.equal(
    firstFreeSlot({
      now: at("2026-11-05", "10:00"),
      timeZone: ZONE,
      rhythm: [],
      busy: [],
      deadline: at("2026-11-03", "08:00"),
    }),
    null,
  );
});

test("уроки становятся занятым временем, кривые строки пропускаются", () => {
  const spans = lessonSpans(
    "2026-11-05",
    [
      { startTime: "08:00", endTime: "08:45" },
      { startTime: "", endTime: "" },
      { startTime: "10:00", endTime: "09:00" },
    ],
    ZONE,
  );
  assert.deepEqual(spans, [span("2026-11-05", "08:00", "08:45")]);
});

test("окна ритма разбираются из шаблона", () => {
  assert.deepEqual(
    rhythmWindows([
      { weekday: 1, start_time: "17:00:00", duration_minutes: 90 },
      { weekday: 2, start_time: "кривое", duration_minutes: 90 },
      { weekday: 2, start_time: "18:00:00", duration_minutes: 0 },
    ]),
    [{ weekday: 1, start: 17 * 60, minutes: 90 }],
  );
});

test("задание узнаёт свой блок по названию и дате", () => {
  const entry = {
    id: "c1",
    title: "Физика: §10",
    start_at: at("2026-11-05", "16:00").toISOString(),
    weekday: null,
  };
  assert.equal(plannedEntryFor([entry], "Физика: §10", "2026-11-06", ZONE), entry);
  assert.equal(plannedEntryFor([entry], "Физика: §11", "2026-11-06", ZONE), null);
  // Тот же текст через месяц — это уже другое задание.
  assert.equal(plannedEntryFor([entry], "Физика: §10", "2026-12-10", ZONE), null);
  // Блок после сдачи к заданию не относится.
  assert.equal(plannedEntryFor([entry], "Физика: §10", "2026-11-04", ZONE), null);
  // Повторяющаяся занятость с таким же именем тоже.
  assert.equal(
    plannedEntryFor([{ ...entry, weekday: 2, start_at: null }], "Физика: §10", "2026-11-06", ZONE),
    null,
  );
});

test("длинное название укладывается в поле", () => {
  const long = "x".repeat(300);
  assert.equal(planTitle(long).length, 200);
  assert.equal(planTitle("коротко"), "коротко");
});

test("подпись времени в плане", () => {
  assert.equal(planWhenLabel(at("2026-11-05", "17:15"), "2026-11-05", ZONE), "сегодня в 17:15");
  assert.equal(planWhenLabel(at("2026-11-06", "16:00"), "2026-11-05", ZONE), "завтра в 16:00");
  assert.equal(planWhenLabel(at("2026-11-07", "16:00"), "2026-11-05", ZONE), "в субботу в 16:00");
});

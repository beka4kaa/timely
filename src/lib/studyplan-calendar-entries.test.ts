import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type CalendarScheduleLike,
  type FixedCommitmentLike,
  buildCourseAccents,
  calendarTimeZone,
  courseAccent,
  expandCommitments,
  selectVisibleSchedules,
} from "./studyplan-calendar-entries.ts";

function schedule(
  id: string,
  coursePlan: string,
  status: CalendarScheduleLike["status"],
  createdAt: string,
): CalendarScheduleLike {
  return {
    id,
    course_plan: coursePlan,
    status,
    version: 1,
    timezone: "UTC",
    created_at: createdAt,
  };
}

function commitment(
  overrides: Partial<FixedCommitmentLike> = {},
): FixedCommitmentLike {
  return {
    id: "school",
    kind: "school",
    title: "Школа",
    weekday: 1,
    start_time: "17:00:00",
    duration_minutes: 60,
    valid_from: null,
    valid_until: null,
    start_at: null,
    end_at: null,
    source: "manual",
    source_text: "",
    ...overrides,
  };
}

test("новейшая версия заменяет предыдущую только внутри своего курса", () => {
  const active = schedule(
    "physics-active",
    "physics",
    "active",
    "2026-08-18T12:00:00Z",
  );
  const olderProposal = schedule(
    "physics-proposed",
    "physics",
    "proposed",
    "2026-08-19T12:00:00Z",
  );
  const newerDraft = schedule(
    "physics-draft",
    "physics",
    "draft",
    "2026-08-20T12:00:00Z",
  );
  const math = schedule("math-active", "math", "active", "2026-08-17T12:00:00Z");

  const visible = selectVisibleSchedules([
    active,
    olderProposal,
    math,
    newerDraft,
  ]);

  assert.deepEqual(
    visible.map((item) => item.id),
    ["math-active", "physics-draft"],
  );
});

test("устаревшее предложение не прячет более новую активную версию", () => {
  const visible = selectVisibleSchedules([
    schedule("old-proposal", "physics", "proposed", "2026-08-17T12:00:00Z"),
    schedule("current-active", "physics", "active", "2026-08-18T12:00:00Z"),
  ]);

  assert.equal(visible[0]?.id, "current-active");
});

test("невыполнимое предложение не прячет рабочее расписание", () => {
  const active = schedule(
    "active",
    "physics",
    "active",
    "2026-08-17T12:00:00Z",
  );
  const impossible = {
    ...schedule(
      "impossible",
      "physics",
      "proposed",
      "2026-08-18T12:00:00Z",
    ),
    feasible: false,
  };

  assert.equal(selectVisibleSchedules([active, impossible])[0]?.id, "active");
  assert.equal(selectVisibleSchedules([impossible])[0]?.id, "impossible");
});

test("зона общего календаря берётся у самой свежей видимой программы", () => {
  const oldSchedule = schedule(
    "old",
    "physics",
    "active",
    "2026-08-17T12:00:00Z",
  );
  oldSchedule.timezone = "Europe/Moscow";
  const newSchedule = schedule(
    "new",
    "math",
    "active",
    "2026-08-18T12:00:00Z",
  );
  newSchedule.timezone = "Asia/Bishkek";

  assert.equal(
    calendarTimeZone([oldSchedule, newSchedule], "UTC"),
    "Asia/Bishkek",
  );
  assert.equal(calendarTimeZone([], "Europe/London"), "Europe/London");
});

test("общий календарь собирает курсы и скрывает завершённые версии", () => {
  const visible = selectVisibleSchedules([
    schedule("physics", "physics", "active", "2026-08-17T10:00:00Z"),
    schedule("math", "math", "confirmed", "2026-08-17T11:00:00Z"),
    schedule("history-old", "history", "archived", "2026-08-17T12:00:00Z"),
    schedule("chemistry-done", "chemistry", "completed", "2026-08-17T13:00:00Z"),
  ]);

  assert.deepEqual(
    visible.map((item) => [item.course_plan, item.id]),
    [
      ["math", "math"],
      ["physics", "physics"],
    ],
  );
});

test("при равной дате версия выбирается тем же status priority, что на backend", () => {
  const createdAt = "2026-08-17T12:00:00Z";
  const visible = selectVisibleSchedules([
    schedule("zzzz-draft", "physics", "draft", createdAt),
    schedule("aaaa-proposal", "physics", "proposed", createdAt),
  ]);

  assert.equal(visible[0]?.id, "aaaa-proposal");
});

test("при равных дате и статусе используется возрастающий UUID tie-break", () => {
  const createdAt = "2026-08-17T12:00:00Z";
  const visible = selectVisibleSchedules([
    schedule("ffffffff-ffff", "physics", "proposed", createdAt),
    schedule("00000000-0000", "physics", "proposed", createdAt),
  ]);

  assert.equal(visible[0]?.id, "00000000-0000");
});

test("повторяющаяся занятость разворачивается в зоне общего календаря", () => {
  const entries = expandCommitments(
    [
      commitment({
        valid_from: "2026-08-18",
        valid_until: "2026-08-25",
      }),
    ],
    ["2026-08-11", "2026-08-18", "2026-08-25", "2026-09-01"],
    "Asia/Bishkek",
  );

  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.start_at]),
    [
      ["commitment:school:2026-08-18", "2026-08-18T11:00:00.000Z"],
      ["commitment:school:2026-08-25", "2026-08-25T11:00:00.000Z"],
    ],
  );
  assert.ok(entries.every((entry) => entry.fixed));
  assert.ok(entries.every((entry) => entry.calendar_entry === "commitment"));
});

test("разовая занятость попадает в локальный день общего календаря, а не UTC-день", () => {
  const oneOff = commitment({
    id: "exam",
    kind: "exam",
    title: "Экзамен",
    weekday: null,
    start_time: null,
    duration_minutes: 0,
    start_at: "2026-08-17T20:30:00Z",
    end_at: "2026-08-17T22:00:00Z",
  });

  const localDay = expandCommitments([oneOff], ["2026-08-18"], "Asia/Bishkek");
  const utcDay = expandCommitments([oneOff], ["2026-08-17"], "Asia/Bishkek");

  assert.equal(localDay.length, 1);
  assert.equal(localDay[0]?.duration_minutes, 90);
  assert.equal(localDay[0]?.start_at, "2026-08-17T20:30:00.000Z");
  assert.equal(utcDay.length, 0);
});

test("разовая занятость, начавшаяся вчера, видна после полуночи", () => {
  const overnight = commitment({
    id: "overnight",
    kind: "family",
    title: "Поездка",
    weekday: null,
    start_time: null,
    duration_minutes: 0,
    // В Бишкеке это 16 августа 23:00 — 17 августа 01:00.
    start_at: "2026-08-16T17:00:00Z",
    end_at: "2026-08-16T19:00:00Z",
  });

  const entries = expandCommitments(
    [overnight],
    ["2026-08-17"],
    "Asia/Bishkek",
  );

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.start_at, "2026-08-16T18:00:00.000Z");
  assert.equal(entries[0]?.duration_minutes, 60);
});

test("акцент курса детерминирован и различает обычные идентификаторы", () => {
  assert.equal(courseAccent("course-alpha"), courseAccent("course-alpha"));
  assert.notEqual(courseAccent("course-alpha"), courseAccent("course-beta"));
  assert.match(courseAccent("course-gamma"), /^#[0-9a-f]{6}$/i);
});

test("цвет отвечает предмету, а не месту в списке", () => {
  // Физика синеватая, а математика тёплая — независимо от того, какая книга
  // загрузилась первой. До этого цвет раздавался по порядку, и одна и та же
  // физика меняла цвет от перестановки программ.
  const first = buildCourseAccents([
    { id: "p", title: "Механика, 10 класс" },
    { id: "m", title: "Алгебра и начала анализа" },
  ]);
  const second = buildCourseAccents([
    { id: "m", title: "Алгебра и начала анализа" },
    { id: "p", title: "Механика, 10 класс" },
  ]);
  assert.equal(first.get("p"), second.get("p"));
  assert.equal(first.get("m"), second.get("m"));
  assert.notEqual(first.get("p"), first.get("m"));
});

test("неопознанные программы всё равно получают разные цвета", () => {
  const accents = buildCourseAccents([
    { id: "a", title: "Книга без предмета" },
    { id: "b", title: "Ещё одна книга" },
    { id: "c", title: "И третья" },
  ]);
  assert.equal(new Set(accents.values()).size, 3);
});

test("англоязычное название тоже опознаётся", () => {
  const accents = buildCourseAccents([
    { id: "ml", title: "_OceanofPDF.com_Hands-On_Machine_Learning" },
    { id: "en", title: "English Grammar in Use" },
  ]);
  assert.notEqual(accents.get("ml"), accents.get("en"));
});

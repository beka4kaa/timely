import assert from "node:assert/strict";
import { test } from "node:test";

import {
  courseFinishLine,
  locateInCourse,
  isCourseDone,
  percentOf,
  pickProgressSchedule,
  programMinutesOf,
  summarizeProgress,
} from "./curriculum-course-progress.ts";

function block(
  status: string,
  minutes: number,
  module: string | null = "m1",
  topic: string | null = "t1",
  activity_type = "theory",
) {
  return { status, duration_minutes: minutes, module, topic, activity_type };
}

test("расписание на часть программы не значит, что пройдена вся программа", () => {
  const blocks = [block("completed", 60), block("completed", 60, "m1", "t2")];
  const progress = summarizeProgress(blocks, 600);
  assert.equal(progress.percent, 20);
  assert.equal(progress.finished, false);
  assert.equal(summarizeProgress(blocks, 120).finished, true);
  // Занятий бывает больше программы: добавленные тоже считаются.
  assert.equal(summarizeProgress(blocks, 60).totalMinutes, 120);
});

test("вся программа считается только у расписания на её часть", () => {
  const plan = { estimated_total_minutes: 600 };
  assert.equal(programMinutesOf({ partial_by_period: true }, plan), 600);
  assert.equal(programMinutesOf({ partial_by_period: false }, plan), 0);
  assert.equal(programMinutesOf({}, plan), 0);
  assert.equal(programMinutesOf({ partial_by_period: true }, null), 0);
});

test("курс пройден, только когда пройдены все темы и не осталось занятий", () => {
  const blocks = [block("completed", 60), block("scheduled", 60, null, null)];
  const modules = [{ id: "m1", minutes: 60, topics: [{ id: "t1" }] }];
  const progress = summarizeProgress(blocks);
  assert.equal(locateInCourse(modules, progress).currentTopicId, null);
  assert.equal(isCourseDone(1, locateInCourse(modules, progress), progress), false);

  const finished = summarizeProgress([block("completed", 60)]);
  assert.equal(isCourseDone(1, locateInCourse(modules, finished), finished), true);
  assert.equal(isCourseDone(0, locateInCourse([], finished), finished), false);
});

test("прогресс считается по минутам пройденных занятий", () => {
  const progress = summarizeProgress([block("completed", 30), block("scheduled", 90, "m1", "t2")]);
  assert.equal(progress.percent, 25);
  assert.equal(progress.finished, false);
  assert.equal(progress.modules.get("m1")?.percent, 25);
  assert.equal(progress.topics.get("t1")?.finished, true);
  assert.equal(progress.topics.get("t2")?.finished, false);
});

test("пропущенное занятие остаётся в плане, отменённое и перенесённое уходят из него", () => {
  const progress = summarizeProgress([
    block("completed", 30),
    block("missed", 30),
    block("cancelled", 600),
    block("rescheduled", 600),
    block("skipped", 600),
  ]);
  assert.equal(progress.percent, 50);
});

test("повторение не двигает прогресс: это не новый кусок программы", () => {
  const progress = summarizeProgress([
    block("completed", 45),
    block("scheduled", 30, "m1", "t1", "review"),
  ]);
  assert.equal(progress.percent, 100);
  assert.equal(progress.finished, true);
});

test("частично пройденное занятие считается за половину и тему не закрывает", () => {
  const progress = summarizeProgress([block("partially_completed", 60)]);
  assert.equal(progress.percent, 50);
  assert.equal(progress.topics.get("t1")?.finished, false);
});

test("без занятий прогресса нет, и это ноль, а не ошибка", () => {
  const progress = summarizeProgress([]);
  assert.equal(progress.percent, 0);
  assert.equal(progress.finished, false);
});

test("сто процентов только за всё, ноль только за ничего", () => {
  assert.equal(percentOf(999, 1000), 99);
  assert.equal(percentOf(1, 1000), 1);
  assert.equal(percentOf(0, 1000), 0);
  assert.equal(percentOf(1000, 1000), 100);
  assert.equal(percentOf(5, 0), 0);
});

const MODULES = [
  { id: "m1", minutes: 60, topics: [{ id: "t1" }, { id: "t2" }] },
  { id: "m2", minutes: 60, topics: [{ id: "t3" }] },
];

test("сейчас это первая непройденная тема по порядку программы", () => {
  const progress = summarizeProgress([block("completed", 30, "m1", "t1"), block("scheduled", 30, "m1", "t2")]);
  const states = locateInCourse(MODULES, progress);
  assert.equal(states.currentTopicId, "t2");
  assert.equal(states.currentModuleId, "m1");
  assert.equal(states.topics.get("t1"), "done");
  assert.equal(states.topics.get("t2"), "cur");
  assert.equal(states.topics.get("t3"), "todo");
  assert.equal(states.modules.get("m1")?.state, "cur");
  assert.equal(states.modules.get("m1")?.percent, 50);
  assert.equal(states.modules.get("m2")?.state, "todo");
});

test("пройденная глава закрыта на сто, следующая становится текущей", () => {
  const progress = summarizeProgress([block("completed", 30, "m1", "t1"), block("completed", 30, "m1", "t2")]);
  const states = locateInCourse(MODULES, progress);
  assert.equal(states.modules.get("m1")?.state, "done");
  assert.equal(states.modules.get("m1")?.percent, 100);
  assert.equal(states.currentModuleId, "m2");
  assert.equal(states.currentTopicId, "t3");
});

test("тема без занятия не даёт главе закрыться раньше времени", () => {
  const progress = summarizeProgress([block("completed", 60, "m1", "t1")]);
  const states = locateInCourse(MODULES, progress);
  assert.equal(states.modules.get("m1")?.state, "cur");
  assert.ok((states.modules.get("m1")?.percent ?? 100) < 100);
});

test("без расписания текущей считается первая тема, и ничего не пройдено", () => {
  const states = locateInCourse(MODULES, null);
  assert.equal(states.currentTopicId, "t1");
  assert.equal(states.modules.get("m1")?.percent, 0);
});

test("весь курс пройден: текущей темы нет", () => {
  const progress = summarizeProgress([
    block("completed", 30, "m1", "t1"),
    block("completed", 30, "m1", "t2"),
    block("completed", 60, "m2", "t3"),
  ]);
  const states = locateInCourse(MODULES, progress);
  assert.equal(states.currentTopicId, null);
  assert.equal(states.currentModuleId, null);
});

function schedule(id: string, status: string, created_at = "2026-08-01T00:00:00Z") {
  return { id, status, course_plan: "p", version: 1, created_at };
}

test("считаем по действующему расписанию, а не по свежему предложению", () => {
  const picked = pickProgressSchedule([
    schedule("new", "proposed", "2026-09-01T00:00:00Z"),
    schedule("cur", "active", "2026-08-01T00:00:00Z"),
  ]);
  assert.equal(picked?.id, "cur");
});

test("среди одинаковых берём новое, архив не считается", () => {
  assert.equal(
    pickProgressSchedule([
      schedule("old", "proposed", "2026-08-01T00:00:00Z"),
      schedule("new", "proposed", "2026-09-01T00:00:00Z"),
    ])?.id,
    "new",
  );
  assert.equal(pickProgressSchedule([schedule("gone", "archived")]), null);
  assert.equal(pickProgressSchedule([]), null);
});

const day = (iso: string) => iso;

test("строка срока: запас, впритык и не успеваешь", () => {
  assert.deepEqual(courseFinishLine("2027-03-14", null, day), { text: "до 2027-03-14", tight: false });
  assert.deepEqual(courseFinishLine("2027-03-14", "2027-06-01", day), { text: "до 2027-03-14", tight: false });
  assert.deepEqual(courseFinishLine("2027-03-14", "2027-03-20", day), { text: "до 2027-03-14, впритык", tight: true });
  assert.deepEqual(courseFinishLine("2027-03-14", "2027-03-01", day), {
    text: "срок 2027-03-01, не успеваешь",
    tight: true,
  });
});

test("строка срока без прогноза: только срок или ничего", () => {
  assert.deepEqual(courseFinishLine(null, "2027-03-01", day), { text: "срок 2027-03-01", tight: false });
  assert.equal(courseFinishLine(null, null, day), null);
});

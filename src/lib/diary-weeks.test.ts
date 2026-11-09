import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiaryLesson, DiaryWeek } from "../types/diary.ts";
import { existingWeek, isWeekUnchanged } from "./diary-weeks.ts";

function weekWith(lesson: Partial<DiaryLesson>): DiaryWeek {
  return {
    id: "w1",
    userId: "u",
    weekStart: "2026-11-09",
    weekEnd: "2026-11-15",
    templateId: null,
    createdAt: "",
    days: [
      {
        id: "d1",
        userId: "u",
        date: "2026-11-09",
        dayOfWeek: "monday",
        weekId: "w1",
        lessons: [{ id: "l1", lessonNumber: 1, ...lesson } as DiaryLesson],
        youtubeLinks: [],
        createdAt: "",
        updatedAt: "",
      },
    ],
  } as DiaryWeek;
}

test("старая строка без поля оценок не роняет чтение недели", () => {
  assert.equal(isWeekUnchanged(weekWith({ homework: "" })), true);
  assert.equal(isWeekUnchanged(weekWith({ homework: "§5" })), false);
  assert.equal(isWeekUnchanged(weekWith({ grades: { retelling: null, exercises: 4, test: null } })), false);
  assert.equal(isWeekUnchanged(weekWith({ grades: { retelling: null, exercises: null, test: null }, notes: " " })), true);
});

test("сбой поиска недели не выглядит как «недели нет»", async () => {
  await assert.rejects(existingWeek(new Response("Bad gateway", { status: 502 })));
  await assert.rejects(existingWeek(new Response("не json")));
  await assert.rejects(existingWeek(new Response('{"results": []}')));
  assert.equal(await existingWeek(new Response("[]")), null);
  assert.deepEqual(await existingWeek(new Response(JSON.stringify([{ id: "w1" }]))), { id: "w1" });
});

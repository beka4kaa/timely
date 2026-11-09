import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiaryLesson, DiaryWeek } from "../types/diary.ts";
import { schoolDays } from "./school-week.ts";
import { subjectColor } from "./subject-color.ts";

function lesson(id: string, start: string, end: string, fields: Partial<DiaryLesson> = {}): DiaryLesson {
  return {
    id,
    lessonNumber: 1,
    startTime: start,
    endTime: end,
    blockType: "lesson",
    blockLabel: "",
    linkedSubjectIds: [],
    subjectId: id,
    subjectName: id,
    subjectEmoji: "",
    subjectColor: "#8b5cf6",
    grades: { retelling: null, exercises: null, test: null },
    homework: "",
    notes: "",
    ...fields,
  } as DiaryLesson;
}

function week(days: Array<[string, DiaryLesson[]]>): DiaryWeek {
  return {
    id: "w",
    userId: "u",
    weekStart: "2026-11-09",
    weekEnd: "2026-11-15",
    templateId: null,
    createdAt: "",
    days: days.map(([date, lessons], index) => ({
      id: `d${index}`,
      userId: "u",
      date,
      dayOfWeek: "monday",
      weekId: "w",
      lessons,
      youtubeLinks: [],
      createdAt: "",
      updatedAt: "",
    })),
  } as DiaryWeek;
}

const WEEK = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

test("школьный день идёт от первого урока до последнего", () => {
  const days = schoolDays(
    week([
      [
        "2026-11-09",
        [
          lesson("Физика", "09:40", "10:20"),
          lesson("Алгебра", "08:00", "08:40"),
          lesson("pause", "08:40", "08:50", { blockType: "break", subjectName: "Перерыв" }),
        ],
      ],
    ]),
    WEEK,
  );

  assert.equal(days.length, 1);
  assert.deepEqual([days[0].dateKey, days[0].startMinutes, days[0].endMinutes], ["2026-11-09", 480, 620]);
  assert.deepEqual(days[0].lessons.map((row) => row.title), ["Алгебра", "Физика"]);
  assert.equal(days[0].lessons[0].dayId, "d0");
});

test("видно, где задано, где сделано и какая оценка", () => {
  const [day] = schoolDays(
    week([
      [
        "2026-11-10",
        [
          lesson("Химия", "08:30", "09:15", { homework: "§8" }),
          lesson("Литература", "09:25", "10:10", { homework: "Стих", homeworkDone: true }),
          lesson("Геометрия", "10:20", "11:05", { grades: { retelling: null, exercises: 5, test: null } }),
        ],
      ],
    ]),
    WEEK,
  );

  assert.deepEqual(
    day.lessons.map((row) => [row.title, row.task, row.grade]),
    [["Химия", "open", null], ["Литература", "done", null], ["Геометрия", "none", 5]],
  );
});

test("дни вне видимых и дни без уроков с временем пропускаются", () => {
  const days = schoolDays(
    week([
      ["2026-11-16", [lesson("Алгебра", "08:00", "08:40")]],
      ["2026-11-11", [lesson("Без времени", "", "")]],
      ["2026-11-12", []],
    ]),
    WEEK,
  );

  assert.deepEqual(days, []);
  assert.deepEqual(schoolDays(null, WEEK), []);
});

test("в дневном виде остаётся только выбранный день", () => {
  const source = week([
    ["2026-11-09", [lesson("Алгебра", "08:00", "08:40")]],
    ["2026-11-10", [lesson("Химия", "08:30", "09:15")]],
  ]);

  assert.deepEqual(schoolDays(source, ["2026-11-10"]).map((row) => row.dateKey), ["2026-11-10"]);
});

test("у предмета без своего цвета цвет по названию, свой цвет остаётся", () => {
  assert.equal(subjectColor("Физика", "#ff0000"), "#ff0000");
  assert.equal(subjectColor("Физика", "#8b5cf6"), subjectColor("Физика", null));
  assert.equal(subjectColor("Физика", "#6366f1"), subjectColor("Физика", ""));
  assert.notEqual(subjectColor("Физика", null), "#8b5cf6");
  assert.notEqual(subjectColor("Физика", null), subjectColor("Химия", null));
});

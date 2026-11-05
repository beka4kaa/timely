import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classesOfDay,
  defaultWeekStart,
  freeClasses,
  gradeField,
  groupWeek,
  localDateKey,
  mondayOf,
  splitTestWords,
  taskCount,
  taskTitle,
  tasksOfDay,
  weekRangeLabel,
} from "./diary-tasks.ts";
import type { DiaryDay, DiaryLesson } from "../types/diary.ts";

function lesson(patch: Partial<DiaryLesson> = {}): DiaryLesson {
  return {
    id: patch.id ?? "l",
    lessonNumber: 1,
    startTime: "08:00",
    endTime: "08:45",
    blockType: "lesson",
    blockLabel: "",
    linkedSubjectIds: [],
    subjectId: "s",
    subjectName: "Физика",
    subjectEmoji: "",
    subjectColor: "",
    grades: { retelling: null, exercises: null, test: null },
    homework: "",
    notes: "",
    ...patch,
  };
}

function day(date: string, lessons: DiaryLesson[]): DiaryDay {
  return {
    id: date,
    userId: "u",
    date,
    dayOfWeek: "monday",
    weekId: "w",
    lessons,
    youtubeLinks: [],
    createdAt: "",
    updatedAt: "",
  };
}

test("дата берётся по часам ученика, а не по UTC", () => {
  // 02:00 в Бишкеке: по UTC это ещё вчера.
  const lateNight = new Date(2026, 10, 2, 2, 0);
  assert.equal(localDateKey(lateNight), "2026-11-02");
});

test("понедельник и неделя, которая открывается первой", () => {
  assert.equal(mondayOf("2026-11-05"), "2026-11-02");
  assert.equal(mondayOf("2026-11-02"), "2026-11-02");
  assert.equal(defaultWeekStart("2026-11-05"), "2026-11-02");
  assert.equal(defaultWeekStart("2026-11-07"), "2026-11-02");
  // В воскресенье задания на завтра уже в следующей неделе.
  assert.equal(defaultWeekStart("2026-11-08"), "2026-11-09");
});

test("подпись недели: один месяц и стык месяцев", () => {
  assert.equal(weekRangeLabel("2026-11-02"), "2–8 ноября");
  assert.equal(weekRangeLabel("2026-11-30"), "30 ноября – 6 декабря");
});

test("заданием считается текст и контрольная, перемена заданием не бывает", () => {
  const items = [
    lesson({ id: "a", homework: "§10", startTime: "09:00" }),
    lesson({ id: "b", homework: "   " }),
    lesson({ id: "c", blockType: "test", blockLabel: "Тест", subjectName: "Тест", startTime: "08:00" }),
    lesson({ id: "d", blockType: "break", subjectName: "Перемена" }),
  ];
  assert.deepEqual(tasksOfDay(day("2026-11-05", items)).map((item) => item.id), ["c", "a"]);
  assert.deepEqual(classesOfDay(day("2026-11-05", items)).map((item) => item.id), ["b", "c", "a"]);
  assert.deepEqual(freeClasses(day("2026-11-05", items)).map((item) => item.id), ["b", "c"]);
});

test("подпись задания", () => {
  assert.equal(taskTitle(lesson({ homework: " §10, вопросы 1–3 " })), "Физика: §10, вопросы 1–3");
  assert.equal(taskTitle(lesson()), "Физика");
});

test("слова про контрольную выделяются, похожие слова нет", () => {
  assert.deepEqual(splitTestWords("СОР, кинематика"), [
    { text: "СОР", test: true },
    { text: ", кинематика", test: false },
  ]);
  assert.deepEqual(splitTestWords("готовиться к контрольной по §6"), [
    { text: "готовиться к ", test: false },
    { text: "контрольной", test: true },
    { text: " по §6", test: false },
  ]);
  assert.deepEqual(splitTestWords("замесить тесто и убрать сор"), [
    { text: "замесить тесто и убрать сор", test: false },
  ]);
  assert.deepEqual(splitTestWords("решить самостоятельно"), [
    { text: "решить самостоятельно", test: false },
  ]);
  assert.deepEqual(splitTestWords(""), []);
});

test("неделя раскладывается на предстоящее и прошедшее", () => {
  const week = {
    days: [
      day("2026-11-03", [lesson({ id: "empty" })]),
      day("2026-11-04", [lesson({ id: "past", homework: "было" })]),
      day("2026-11-05", [
        lesson({ id: "over", homework: "уже началось", startTime: "08:00" }),
        lesson({ id: "live", homework: "ещё успею", startTime: "14:00" }),
      ]),
      day("2026-11-06", [lesson({ id: "tomorrow", homework: "завтра" })]),
      day("2026-11-07", [lesson({ id: "free" })]),
      day("2026-11-08", []),
    ],
  };
  const { upcoming, past } = groupWeek(week, "2026-11-05", 12 * 60);

  assert.deepEqual(upcoming.map((group) => group.title), ["На сегодня", "На завтра", "На субботу"]);
  assert.deepEqual(upcoming[0].tasks.map((item) => item.id), ["live"]);
  assert.equal(upcoming[1].when, "пятница, 6 ноября");
  assert.equal(upcoming[2].when, "7 ноября");
  // День с уроками, но без заданий остаётся: в него можно записать.
  assert.equal(upcoming[2].tasks.length, 0);

  assert.deepEqual(past.map((group) => group.title), ["Среда", "Сегодня"]);
  assert.deepEqual(past[1].tasks.map((item) => item.id), ["over"]);
  assert.equal(taskCount(past), 2);
});

test("вечером сегодняшнее задание уходит в прошедшее", () => {
  const week = { days: [day("2026-11-05", [lesson({ homework: "§1" })])] };
  const { upcoming, past } = groupWeek(week, "2026-11-05", 20 * 60);
  assert.equal(upcoming.length, 0);
  assert.deepEqual(past.map((group) => group.title), ["Сегодня"]);
});

test("утром сегодняшний день открыт для записи, даже если задания ещё нет", () => {
  const week = { days: [day("2026-11-05", [lesson({ startTime: "08:00" })])] };
  const morning = groupWeek(week, "2026-11-05", 7 * 60);
  assert.deepEqual(morning.upcoming.map((group) => group.title), ["На сегодня"]);
  assert.equal(morning.upcoming[0].tasks.length, 0);
  assert.equal(morning.past.length, 0);

  const evening = groupWeek(week, "2026-11-05", 20 * 60);
  assert.equal(evening.upcoming.length, 0);
  assert.equal(evening.past.length, 0);
});

test("поле оценки зависит от типа блока", () => {
  assert.equal(gradeField({ blockType: "lesson" }), "exercises");
  assert.equal(gradeField({ blockType: undefined }), "exercises");
  assert.equal(gradeField({ blockType: "feynman" }), "retelling");
  assert.equal(gradeField({ blockType: "weakness-test" }), "test");
  assert.equal(gradeField({ blockType: "other" }), null);
});

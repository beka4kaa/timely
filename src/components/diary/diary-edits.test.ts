import assert from "node:assert/strict";
import { test } from "node:test";

import type { DiaryLesson, DiaryWeek, TemplateLessonSlot } from "../../types/diary.ts";
import {
  applyLessonEdits,
  LessonChangedError,
  mergeTimetable,
  sameSlots,
  type LessonEdit,
  type TimetableLesson,
} from "./diary-edits.ts";

function lesson(fields: Partial<DiaryLesson>): DiaryLesson {
  return {
    id: "l1",
    lessonNumber: 1,
    startTime: "08:30",
    endTime: "09:15",
    blockType: "lesson",
    blockLabel: "",
    linkedSubjectIds: [],
    subjectId: "s1",
    subjectName: "Физика",
    subjectEmoji: "",
    subjectColor: "",
    grades: { retelling: null, exercises: null, test: null },
    homework: "",
    notes: "",
    ...fields,
  } as DiaryLesson;
}

function week(lessons: DiaryLesson[], dayId = "d1"): DiaryWeek {
  return {
    id: "w1",
    userId: "u",
    weekStart: "2026-11-02",
    weekEnd: "2026-11-08",
    templateId: null,
    createdAt: "",
    days: [
      {
        id: dayId,
        userId: "u",
        date: "2026-11-02",
        dayOfWeek: "monday",
        weekId: "w1",
        lessons,
        youtubeLinks: [],
        createdAt: "",
        updatedAt: "",
      },
    ],
  } as DiaryWeek;
}

const EDIT: LessonEdit = {
  place: {
    day_id: "d1",
    lesson_id: "l1",
    slot: { dayOfWeek: "monday", lessonNumber: 1, startTime: "08:30" },
    subject_id: "s1",
  },
  expect: { homework: "", grades: { exercises: null } },
  write: { homework: "№12", grades: { exercises: 5 } },
};

test("правка пишет домашку и оценку, остальное в уроке не трогает", () => {
  const source = week([lesson({ notes: "Циркуль", grades: { retelling: 4, exercises: null, test: null } })]);

  const changed = applyLessonEdits(source, [EDIT]).days[0].lessons[0];

  assert.equal(changed.homework, "№12");
  assert.equal(changed.notes, "Циркуль");
  assert.deepEqual(changed.grades, { retelling: 4, exercises: 5, test: null });
  assert.equal(source.days[0].lessons[0].homework, "", "исходная неделя не меняется");
});

test("неделю без записей дневник собрал заново: урок находится по месту", () => {
  const changed = applyLessonEdits(week([lesson({ id: "новый" })], "новый день"), [EDIT]);

  assert.equal(changed.days[0].lessons[0].homework, "№12");
});

test("урока больше нет: карточка устарела", () => {
  assert.throws(() => applyLessonEdits(week([]), [EDIT]), LessonChangedError);
});

test("на этом месте теперь другой предмет: чужой урок не трогаем", () => {
  const other = week([lesson({ id: "новый", subjectId: "s2", subjectName: "Химия" })]);

  assert.throws(() => applyLessonEdits(other, [EDIT]), LessonChangedError);
});

test("ученик успел записать своё: не перезаписываем", () => {
  assert.throws(() => applyLessonEdits(week([lesson({ homework: "§7" })]), [EDIT]), LessonChangedError);
  assert.throws(
    () => applyLessonEdits(week([lesson({ grades: { retelling: null, exercises: 3, test: null } })]), [EDIT]),
    LessonChangedError,
  );
});

test("устаревшая правка считается устаревшей и для общей кнопки", () => {
  assert.equal(new LessonChangedError("x").isStale, true);
});

test("отмена той же правкой: отметка возвращается вместе с текстом", () => {
  const undo: LessonEdit = {
    ...EDIT,
    expect: { homework: "", homeworkDone: false },
    write: { homework: "§5", homeworkDone: true },
  };

  const changed = applyLessonEdits(week([lesson({ homework: "" })]), [undo]).days[0].lessons[0];

  assert.equal(changed.homework, "§5");
  assert.equal(changed.homeworkDone, true);
});

test("старая строка без оценок и без отметки не считается изменённой", () => {
  const bare = lesson({});
  delete (bare as Partial<DiaryLesson>).grades;
  delete (bare as Partial<DiaryLesson>).homework;

  const changed = applyLessonEdits(week([bare]), [EDIT]).days[0].lessons[0];

  assert.equal(changed.grades.exercises, 5);
});

test("несколько правок ложатся в одну неделю", () => {
  const second: LessonEdit = {
    place: { day_id: "d1", lesson_id: "l2", slot: { dayOfWeek: "monday", lessonNumber: 2, startTime: "09:30" }, subject_id: "s2" },
    expect: { notes: "" },
    write: { notes: "Циркуль" },
  };
  const source = week([lesson({}), lesson({ id: "l2", lessonNumber: 2, startTime: "09:30", subjectId: "s2" })]);

  const { lessons } = applyLessonEdits(source, [EDIT, second]).days[0];

  assert.equal(lessons[0].homework, "№12");
  assert.equal(lessons[1].notes, "Циркуль");
});

function slot(fields: Partial<TemplateLessonSlot>): TemplateLessonSlot {
  return {
    id: "old",
    dayOfWeek: "monday",
    lessonNumber: 1,
    startTime: "08:00",
    endTime: "08:45",
    subjectId: "s0",
    blockType: "lesson",
    label: "",
    ...fields,
  };
}

const ALGEBRA: TimetableLesson = { weekday: 0, start: "08:30", end: "09:15", subject: "Алгебра" };
const PHYSICS: TimetableLesson = { weekday: 0, start: "09:30", end: "10:15", subject: "Физика" };

function merge(before: TemplateLessonSlot[], lessons: TimetableLesson[], clear: number[] = []) {
  let next = 0;
  return mergeTimetable(before, lessons, clear, (name) => `id:${name}`, () => `new${++next}`);
}

test("новые уроки ложатся с номерами по времени", () => {
  assert.deepEqual(merge([], [PHYSICS, ALGEBRA]), [
    slot({ id: "new2", lessonNumber: 1, startTime: "08:30", endTime: "09:15", subjectId: "id:Алгебра" }),
    slot({ id: "new1", lessonNumber: 2, startTime: "09:30", endTime: "10:15", subjectId: "id:Физика" }),
  ]);
});

test("дни, которых нет в карточке, остаются как были", () => {
  const tuesday = slot({ id: "tue", dayOfWeek: "tuesday", lessonNumber: 4 });

  const merged = merge([slot({}), tuesday], [ALGEBRA]);

  assert.deepEqual(merged.map((row) => row.id).sort(), ["new1", "tue"]);
  assert.equal(merged.find((row) => row.id === "tue")?.lessonNumber, 4);
});

test("уроки и перемены названного дня заменяются, свой блок остаётся и получает новый номер", () => {
  const before = [
    slot({}),
    slot({ id: "pause", lessonNumber: 2, startTime: "08:45", endTime: "09:00", blockType: "break", subjectId: "" }),
    slot({ id: "focus", lessonNumber: 3, startTime: "16:00", endTime: "17:00", blockType: "focus", subjectId: "", label: "Чтение" }),
  ];

  const merged = merge(before, [ALGEBRA, PHYSICS]);

  assert.deepEqual(
    merged.map((row) => [row.id, row.lessonNumber]),
    [["new1", 1], ["new2", 2], ["focus", 3]],
  );
});

test("свой блок на времени нового урока уходит", () => {
  const focus = slot({ id: "focus", startTime: "09:00", endTime: "09:40", blockType: "focus", subjectId: "" });

  assert.deepEqual(merge([focus], [ALGEBRA]).map((row) => row.id), ["new1"]);
});

test("очищенный день теряет уроки и перемены, а свой блок сохраняет", () => {
  const before = [
    slot({ dayOfWeek: "saturday" }),
    slot({ id: "pause", dayOfWeek: "saturday", lessonNumber: 2, blockType: "break", subjectId: "" }),
    slot({ id: "focus", dayOfWeek: "saturday", lessonNumber: 3, startTime: "16:00", endTime: "17:00", blockType: "focus", subjectId: "" }),
    slot({ id: "mon" }),
  ];

  const merged = merge(before, [], [5]);

  assert.deepEqual(merged.map((row) => [row.id, row.lessonNumber]), [["focus", 1], ["mon", 1]]);
});

test("время без нуля считается правильно", () => {
  const before = [slot({ id: "focus", startTime: "8:00", endTime: "8:20", blockType: "focus", subjectId: "" })];

  assert.deepEqual(merge(before, [ALGEBRA]).map((row) => [row.id, row.lessonNumber]), [["focus", 1], ["new1", 2]]);
});

test("старый слот без типа это урок", () => {
  const legacy = slot({});
  delete legacy.blockType;

  assert.deepEqual(merge([legacy], [ALGEBRA]).map((row) => row.id), ["new1"]);
});

test("одинаковые расписания совпадают в любом порядке и с любыми id", () => {
  const first = slot({});
  const second = slot({ id: "x", lessonNumber: 2, startTime: "09:00", endTime: "09:45" });

  assert.equal(sameSlots([first, second], [{ ...second, id: "другой" }, first]), true);
  assert.equal(sameSlots([first], [first, second]), false);
  assert.equal(sameSlots([first], [{ ...first, subjectId: "s9" }]), false);
  assert.equal(sameSlots([], []), true);
  const legacy = slot({});
  delete legacy.blockType;
  delete legacy.label;
  assert.equal(sameSlots([legacy], [first]), true);
});

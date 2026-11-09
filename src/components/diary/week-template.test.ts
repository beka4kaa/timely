import assert from "node:assert/strict";
import { test } from "node:test";

import type { TemplateLessonSlot } from "../../types/diary.ts";
import {
  addLesson,
  clearDay,
  copyDay,
  dayRange,
  firstStart,
  moveToDay,
  removeLesson,
  retime,
  sameWeek,
  setContent,
  shortClock,
  slotsFrom,
  swapLessons,
  weekFrom,
  type WeekDays,
} from "./week-template.ts";

function slot(id: string, day: TemplateLessonSlot["dayOfWeek"], start: string, end: string, subjectId = id, extra: Partial<TemplateLessonSlot> = {}): TemplateLessonSlot {
  return { id, dayOfWeek: day, lessonNumber: 9, startTime: start, endTime: end, subjectId, blockType: "lesson", label: "", ...extra };
}

const WEEK: TemplateLessonSlot[] = [
  slot("m2", "monday", "08:50", "09:30", "rus"),
  slot("m1", "monday", "08:00", "08:40", "alg"),
  slot("m3", "monday", "09:40", "10:20", "phys"),
  slot("t1", "tuesday", "08:30", "09:15", "geo"),
];

const ids = (week: WeekDays, day: keyof WeekDays) => week[day].map((row) => row.id);
const times = (week: WeekDays, day: keyof WeekDays) => week[day].map((row) => `${row.startTime}-${row.endTime}`);

test("уроки дня идут по времени и нумеруются по порядку", () => {
  const week = weekFrom(WEEK);

  assert.deepEqual(ids(week, "monday"), ["m1", "m2", "m3"]);
  assert.deepEqual(week.monday.map((row) => row.lessonNumber), [1, 2, 3]);
  assert.deepEqual(week.sunday, []);
});

test("старый слот без типа и подписи становится уроком", () => {
  const week = weekFrom([{ id: "x", dayOfWeek: "friday", lessonNumber: 1, startTime: "8:00", endTime: "8:45", subjectId: "s" }]);

  assert.equal(week.friday[0].blockType, "lesson");
  assert.equal(week.friday[0].label, "");
});

test("в базу уходят все дни подряд с номерами", () => {
  const slots = slotsFrom(weekFrom(WEEK));

  assert.deepEqual(
    slots.map((row) => [row.id, row.dayOfWeek, row.lessonNumber]),
    [["m1", "monday", 1], ["m2", "monday", 2], ["m3", "monday", 3], ["t1", "tuesday", 1]],
  );
  assert.deepEqual(Object.keys(slots[0]).sort(), ["blockType", "dayOfWeek", "endTime", "id", "label", "lessonNumber", "startTime", "subjectId"]);
});

test("время дня и короткая запись времени", () => {
  const week = weekFrom(WEEK);

  assert.equal(dayRange(week.monday), "8:00–10:20");
  assert.equal(dayRange(week.sunday), "");
  assert.equal(shortClock("08:05"), "8:05");
  assert.equal(shortClock("12:30"), "12:30");
});

test("новый урок встаёт через перемену после последнего, с той же длительностью", () => {
  const { week, id } = addLesson(weekFrom(WEEK), "monday", { subjectId: "", blockType: "lesson", label: "" }, () => "new");

  assert.equal(id, "new");
  assert.deepEqual(times(week, "monday").at(-1), "10:30-11:10");
  assert.equal(week.monday.at(-1)?.lessonNumber, 4);
});

test("первый урок пустого дня начинается тогда же, когда чаще всего начинаются другие дни", () => {
  const base = weekFrom([...WEEK, slot("w1", "wednesday", "08:00", "08:40")]);

  const { week } = addLesson(base, "thursday", { subjectId: "", blockType: "lesson", label: "" }, () => "new");

  assert.deepEqual(times(week, "thursday"), ["08:00-08:45"]);
  assert.equal(firstStart(weekFrom([])), "08:30");
});

test("новый урок не уходит за полночь", () => {
  const late = weekFrom([slot("x", "monday", "23:00", "23:45")]);

  const { week } = addLesson(late, "monday", { subjectId: "", blockType: "lesson", label: "" }, () => "new");

  assert.deepEqual(ids(week, "monday"), ["x"]);
});

test("сдвиг урока двигает следующие, если так выбрано", () => {
  const week = weekFrom(WEEK);

  const shifted = retime(week, { day: "monday", id: "m1" }, "08:00", "08:45", true);
  assert.deepEqual(times(shifted, "monday"), ["08:00-08:45", "08:55-09:35", "09:45-10:25"]);

  const alone = retime(week, { day: "monday", id: "m1" }, "08:00", "08:45", false);
  assert.deepEqual(times(alone, "monday"), ["08:00-08:45", "08:50-09:30", "09:40-10:20"]);
});

test("урок, поставленный раньше предыдущего, встаёт на своё место по времени", () => {
  const moved = retime(weekFrom(WEEK), { day: "monday", id: "m3" }, "07:00", "07:40", false);

  assert.deepEqual(ids(moved, "monday"), ["m3", "m1", "m2"]);
  assert.deepEqual(moved.monday.map((row) => row.lessonNumber), [1, 2, 3]);
});

test("конец раньше начала не записывается", () => {
  const week = weekFrom(WEEK);

  assert.equal(retime(week, { day: "monday", id: "m1" }, "09:00", "08:00", true), week);
  assert.equal(retime(week, { day: "monday", id: "m1" }, "утром", "08:00", true), week);
});

test("обмен местами меняет предметы, а время остаётся у мест", () => {
  const swapped = swapLessons(weekFrom(WEEK), { day: "monday", id: "m1" }, { day: "tuesday", id: "t1" });

  assert.equal(swapped.monday[0].subjectId, "geo");
  assert.equal(swapped.tuesday[0].subjectId, "alg");
  assert.deepEqual(times(swapped, "monday")[0], "08:00-08:40");
  assert.deepEqual(times(swapped, "tuesday")[0], "08:30-09:15");
});

test("обмен переносит и вид блока с подписью", () => {
  const week = weekFrom([slot("a", "monday", "08:00", "08:40"), slot("b", "monday", "08:40", "08:50", "", { blockType: "break", label: "Большая" })]);

  const swapped = swapLessons(week, { day: "monday", id: "a" }, { day: "monday", id: "b" });

  assert.deepEqual([swapped.monday[0].blockType, swapped.monday[0].label], ["break", "Большая"]);
  assert.deepEqual([swapped.monday[1].blockType, swapped.monday[1].subjectId], ["lesson", "a"]);
});

test("урок, брошенный в конец другого дня, переезжает туда со своей длительностью", () => {
  const moved = moveToDay(weekFrom(WEEK), { day: "monday", id: "m3" }, "tuesday");

  assert.deepEqual(ids(moved, "monday"), ["m1", "m2"]);
  assert.deepEqual(ids(moved, "tuesday"), ["t1", "m3"]);
  assert.deepEqual(times(moved, "tuesday")[1], "09:25-10:05");
  assert.equal(moved.tuesday[1].dayOfWeek, "tuesday");
});

test("копия дня заменяет выбранные дни свежими уроками", () => {
  let next = 0;
  const copied = copyDay(weekFrom(WEEK), "monday", ["tuesday", "wednesday"], () => `c${++next}`);

  assert.deepEqual(copied.tuesday.map((row) => row.subjectId), ["alg", "rus", "phys"]);
  assert.deepEqual(copied.wednesday.map((row) => row.dayOfWeek), ["wednesday", "wednesday", "wednesday"]);
  assert.ok(copied.tuesday.every((row) => row.id.startsWith("c")));
  assert.deepEqual(ids(copied, "monday"), ["m1", "m2", "m3"]);
});

test("очистка дня и удаление урока", () => {
  const week = weekFrom(WEEK);

  assert.deepEqual(clearDay(week, "monday").monday, []);
  const removed = removeLesson(week, { day: "monday", id: "m1" });
  assert.deepEqual(ids(removed, "monday"), ["m2", "m3"]);
  assert.deepEqual(removed.monday.map((row) => row.lessonNumber), [1, 2]);
});

test("предмет и вид блока меняются у одного урока", () => {
  const changed = setContent(weekFrom(WEEK), { day: "monday", id: "m2" }, { subjectId: "", blockType: "focus", label: "Чтение" });

  assert.deepEqual([changed.monday[1].blockType, changed.monday[1].label, changed.monday[1].subjectId], ["focus", "Чтение", ""]);
  assert.equal(changed.monday[0].subjectId, "alg");
});

test("одинаковые недели совпадают, любая правка видна", () => {
  const week = weekFrom(WEEK);

  assert.equal(sameWeek(week, weekFrom([...WEEK].reverse())), true);
  assert.equal(sameWeek(week, retime(week, { day: "monday", id: "m1" }, "08:00", "08:45", false)), false);
  assert.equal(sameWeek(week, swapLessons(week, { day: "monday", id: "m1" }, { day: "monday", id: "m2" })), false);
});

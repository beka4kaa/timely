import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts.
import { groupWindows } from "./study-windows.ts";
import type { ParsedStudyWindow } from "../../lib/studyplan-chat.ts";

function window(
  weekday: number,
  start_time = "09:00",
  duration_minutes = 180,
): ParsedStudyWindow {
  return {
    weekday,
    weekday_name: "",
    start_time,
    duration_minutes,
  };
}

test("подряд идущие одинаковые дни схлопываются в диапазон", () => {
  // Модель предлагает окно на каждый день отдельно — иначе его не записать, —
  // но пять одинаковых строк ученику читать незачем.
  assert.deepEqual(groupWindows([0, 1, 2, 3, 4].map((day) => window(day))), [
    "пн–пт, 09:00, 3 ч",
  ]);
});

test("разрыв в днях диапазоном не склеивается", () => {
  // «пн–пт» вместо «пн, ср, пт» соврало бы про вторник и четверг.
  assert.deepEqual(groupWindows([window(0), window(2), window(4)]), [
    "пн, 09:00, 3 ч",
    "ср, 09:00, 3 ч",
    "пт, 09:00, 3 ч",
  ]);
});

test("разное время в соседних днях не схлопывается", () => {
  assert.deepEqual(groupWindows([window(0, "09:00"), window(1, "18:00")]), [
    "пн, 09:00, 3 ч",
    "вт, 18:00, 3 ч",
  ]);
});

test("разная длительность в соседних днях не схлопывается", () => {
  assert.deepEqual(
    groupWindows([window(0, "09:00", 180), window(1, "09:00", 60)]),
    ["пн, 09:00, 3 ч", "вт, 09:00, 1 ч"],
  );
});

test("два окна в одном дне остаются двумя строками", () => {
  assert.deepEqual(groupWindows([window(0, "09:00", 60), window(0, "19:00", 60)]), [
    "пн, 09:00, 1 ч",
    "пн, 19:00, 1 ч",
  ]);
});

test("порядок на входе не важен", () => {
  assert.deepEqual(groupWindows([window(4), window(0), window(2), window(1), window(3)]), [
    "пн–пт, 09:00, 3 ч",
  ]);
});

test("пустой список — пустой вывод", () => {
  assert.deepEqual(groupWindows([]), []);
});

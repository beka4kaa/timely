import assert from "node:assert/strict";
import { test } from "node:test";

import {
  habitColors,
  habitIcon,
  localDay,
  markToday,
  nextHabitColor,
  plural,
  streakWord,
  weekCells,
  type CalDay,
} from "./habit-days";

function calendar(today: string, count: number, doneOffsets: number[] = []): CalDay[] {
  const [year, month, day] = today.split("-").map(Number);
  const out: CalDay[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1, day - offset)).toISOString().slice(0, 10);
    out.push({ date, done: doneOffsets.includes(offset) });
  }
  return out;
}

test("день берётся по местному времени, а не по UTC", () => {
  // 01:30 пятого ноября: в UTC ещё могло быть четвёртое.
  assert.equal(localDay(new Date(2026, 10, 5, 1, 30)), "2026-11-05");
  assert.equal(localDay(new Date(2026, 0, 3, 23, 59)), "2026-01-03");
});

test("русские окончания у серии", () => {
  assert.equal(streakWord(1), "день подряд");
  assert.equal(streakWord(3), "дня подряд");
  assert.equal(streakWord(5), "дней подряд");
  assert.equal(streakWord(11), "дней подряд");
  assert.equal(streakWord(21), "день подряд");
  assert.equal(plural(0, "день", "дня", "дней"), "дней");
});

test("квадратики идут неделями с понедельника и кончаются сегодня", () => {
  // 5 ноября 2026 это четверг.
  const cells = weekCells(calendar("2026-11-05", 154));
  assert.equal(cells.length % 7, 0, "столбцы полные");
  assert.equal(cells.length / 7, 22, "22 недели на карточке");
  assert.equal(new Date(`${cells[0].key}T00:00:00Z`).getUTCDay(), 1, "первый столбец с понедельника");
  const today = cells.filter((cell) => cell.today);
  assert.equal(today.length, 1);
  assert.equal(today[0].key, "2026-11-05");
  // Четверг: после него в столбце пятница, суббота и воскресенье, их ещё не было.
  assert.deepEqual(
    cells.slice(-4).map((cell) => cell.real),
    [true, false, false, false],
  );
});

test("в воскресенье неделя заполнена до конца", () => {
  const cells = weekCells(calendar("2026-11-08", 154));
  assert.equal(cells.length, 154);
  assert.ok(cells[cells.length - 1].today);
  assert.ok(cells.every((cell) => cell.real));
});

test("новая привычка показывает честную пустоту, а отмечен только настоящий день", () => {
  const cells = weekCells(calendar("2026-11-05", 154, [0]));
  assert.equal(cells.filter((cell) => cell.done).length, 1);
  assert.ok(cells.find((cell) => cell.done)?.today);
});

test("пустой календарь не ломает карточку", () => {
  assert.deepEqual(weekCells([]), []);
});

test("короткий календарь не теряет дни", () => {
  const cells = weekCells(calendar("2026-11-05", 3));
  assert.equal(cells.filter((cell) => cell.real).length, 3);
  assert.equal(cells.length % 7, 0);
});

test("отметка за сегодня добавляет один день к серии", () => {
  const before = calendar("2026-11-05", 10, [1, 2, 3]);
  const next = markToday(before, 3, 0, true);
  assert.equal(next.streak, 4);
  assert.ok(next.calendar[next.calendar.length - 1].done);
  assert.ok(!before[before.length - 1].done, "исходный календарь не меняется");
});

test("снятие отметки возвращает серию назад и отменяет только сегодня", () => {
  const before = calendar("2026-11-05", 10, [0, 1, 2, 3]);
  const next = markToday(before, 4, 0, false);
  assert.equal(next.streak, 3);
  assert.equal(next.calendar.filter((day) => day.done).length, 3);
  assert.ok(next.calendar[next.calendar.length - 2].done, "вчерашний день цел");
});

test("серия длиннее окна календаря не обрезается", () => {
  const before = calendar("2026-11-05", 5, [1, 2, 3, 4]);
  assert.equal(markToday(before, 200, 0, true).streak, 201);
});

test("отметка после пропуска сводит серию через щит, как на сервере", () => {
  // Вчера пропуск, раньше три дня подряд. Пока сегодня пусто, цепочки нет.
  const before = calendar("2026-11-05", 10, [2, 3, 4]);
  const next = markToday(before, 0, 2, true);
  assert.equal(next.streak, 4);
});

test("без щитов пропуск рвёт серию", () => {
  const before = calendar("2026-11-05", 10, [2, 3, 4]);
  assert.equal(markToday(before, 0, 0, true).streak, 1);
});

test("значок подбирается по названию, иначе эмодзи", () => {
  assert.equal(habitIcon("Читать 20 минут"), "book");
  assert.equal(habitIcon("Решать 3 задачи"), "sigma");
  assert.equal(habitIcon("Учить 10 слов"), "languages");
  assert.equal(habitIcon("Лечь до 23:00"), "moon");
  assert.equal(habitIcon("Зарядка"), "dumbbell");
  assert.equal(habitIcon("Повторять темы"), "target");
  assert.equal(habitIcon("Гулять с собакой"), null);
});

test("цвет своей палитры знает пару, старый цвет затемняется, мусор не попадает в стили", () => {
  assert.deepEqual(habitColors("#8f7dff", 1), { h1: "#8f7dff", h2: "#4a2bd6" });
  assert.equal(habitColors("#4F46E5", 1).h1, "#4f46e5");
  assert.ok(habitColors("#4f46e5", 1).h2.startsWith("color-mix("));
  assert.match(habitColors("red;}", 3).h1, /^#[0-9a-f]{6}$/);
});

test("новая привычка берёт свободный цвет", () => {
  assert.equal(nextHabitColor([]), "#8f7dff");
  assert.equal(nextHabitColor(["#8F7DFF"]), "#ff7ab8");
  assert.equal(
    nextHabitColor(["#8f7dff", "#ff7ab8", "#45c6ff", "#3fe0a2", "#7f8dff", "#ffa144", "#c6e84f"]),
    "#8f7dff",
  );
});

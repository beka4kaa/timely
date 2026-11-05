import assert from "node:assert/strict";
import { test } from "node:test";

import {
  TONES,
  addDays,
  daysUntil,
  dueLine,
  dueOptions,
  dueStub,
  formatDay,
  habitIdeasFor,
  isOpenGoal,
  isShownGoal,
  mapGoal,
  matchLessons,
  nextStepText,
  ridgeShape,
  scopeOf,
  suggestGoalFor,
  toneOf,
  walkRidge,
} from "./goal-logic";

const TODAY = "2026-11-05";

test("показываем только сами цели, без старых задач, вех и привычек", () => {
  for (const type of ["goal", "global_goal", "financial_goal"]) {
    assert.ok(isShownGoal({ type, status: "active" }), type);
  }
  for (const type of ["task", "milestone", "habit", "subgoal"]) {
    assert.ok(!isShownGoal({ type, status: "active" }), type);
  }
  assert.ok(!isShownGoal({ type: "goal", status: "archived" }));
  assert.ok(isShownGoal({ type: "goal", status: "done" }));
  assert.ok(!isOpenGoal({ type: "goal", status: "done" }));
});

test("у старой цели без цвета он постоянный и из нашего набора", () => {
  const first = toneOf("g_abc123", "");
  assert.equal(toneOf("g_abc123", ""), first);
  assert.ok(TONES.includes(first));
  assert.equal(toneOf("g_abc123", "rose"), "rose");
  assert.ok(TONES.includes(toneOf("g_abc123", "сиреневый")));
  const seen = new Set(Array.from({ length: 40 }, (_, index) => toneOf(`goal-${index}`, "")));
  assert.ok(seen.size > 1, "старые цели не должны быть все одного цвета");
});

test("учёба или общая: сохранённое важнее, у старых определяем по названию", () => {
  assert.equal(scopeOf("Пробежать 5 км", "study"), "study");
  assert.equal(scopeOf("Сдать физику на 9", "general"), "general");
  assert.equal(scopeOf("Сдать физику на 9", ""), "study");
  assert.equal(scopeOf("Пробежать 5 км", ""), "general");
});

test("цель с сервера: новые поля и старые цели", () => {
  const goal = mapGoal({
    id: "a1",
    title: "Сдать физику на 9",
    type: "goal",
    status: "active",
    tone: "teal",
    scope: "study",
    isMain: true,
    progress: 40,
    computed_progress: 40,
    children_count: 0,
    dueDate: "2026-12-03",
    lessons: ["l1"],
  });
  assert.equal(goal.tone, "teal");
  assert.equal(goal.progress, 40);
  assert.equal(goal.isMain, true);
  assert.equal(goal.manual, true);
  assert.equal(goal.due, "2026-12-03");
  assert.deepEqual(goal.lessons, ["l1"]);
});

test("срок старых целей берётся оттуда, где он лежал", () => {
  assert.equal(mapGoal({ id: "a", endDate: "2027-03-05" }).due, "2027-03-05");
  assert.equal(mapGoal({ id: "a", dueDate: "2027-01-01", endDate: "2027-03-05" }).due, "2027-01-01");
  assert.equal(mapGoal({ id: "a", month: "2027-02" }).due, "2027-02-28");
  assert.equal(mapGoal({ id: "a", year: 2027 }).due, "2027-12-31");
  assert.equal(mapGoal({ id: "a" }).due, null);
});

test("прогресс: завершённая на вершине, с подцелями считается сам, деньги по сумме", () => {
  assert.equal(mapGoal({ id: "a", status: "done", progress: 30 }).progress, 100);
  const nested = mapGoal({ id: "a", progress: 10, computed_progress: 55, children_count: 2 });
  assert.equal(nested.progress, 55);
  assert.equal(nested.manual, false);
  const money = mapGoal({ id: "a", type: "financial_goal", targetAmount: "200.00", currentAmount: "50.00" });
  assert.equal(money.progress, 25);
  assert.equal(money.manual, false);
  assert.equal(mapGoal({ id: "a", progress: 500 }).progress, 100);
  assert.equal(mapGoal({ id: "a", progress: "ерунда" }).progress, 0);
});

test("гряда у цели всегда одна и та же", () => {
  assert.deepEqual(ridgeShape("goal-1").points, ridgeShape("goal-1").points);
  assert.notDeepEqual(ridgeShape("goal-1").points, ridgeShape("goal-2").points);
});

test("слайм идёт по тропе от подножия к флагу", () => {
  const shape = ridgeShape("goal-1");
  assert.deepEqual(walkRidge(shape, 0).at, shape.points[0]);
  assert.deepEqual(walkRidge(shape, 100).at, shape.points[shape.points.length - 1]);
  const xs = [0, 25, 50, 75, 100].map((value) => walkRidge(shape, value).at[0]);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, "чем больше прогресс, тем дальше");
  assert.deepEqual(walkRidge(shape, 150).at, walkRidge(shape, 100).at);
  assert.deepEqual(walkRidge(shape, -5).at, walkRidge(shape, 0).at);
});

test("пройденная часть тропы растёт", () => {
  const shape = ridgeShape("goal-1");
  assert.ok(walkRidge(shape, 80).walked.length > walkRidge(shape, 10).walked.length);
});

test("считает дни и даты по календарю", () => {
  assert.equal(addDays(TODAY, 7), "2026-11-12");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(daysUntil("2026-11-06", TODAY), 1);
  assert.equal(daysUntil("2026-11-03", TODAY), -2);
  assert.equal(daysUntil("2027-03-28", "2027-03-27"), 1);
});

test("год у даты только там, где без него непонятно", () => {
  assert.equal(formatDay("2026-11-06", TODAY), "6 ноября");
  assert.equal(formatDay("2027-05-25", TODAY), "25 мая");
  assert.equal(formatDay("2028-07-01", TODAY), "1 июля 2028");
});

test("строка срока на карточке", () => {
  assert.equal(dueLine(null, TODAY), "Без срока");
  assert.equal(dueLine("2026-11-06", TODAY), "до 6 ноября, осталось 1 день");
  assert.equal(dueLine("2027-05-27", TODAY), "до 27 мая, осталось 203 дня");
  assert.equal(dueLine(TODAY, TODAY), "Срок сегодня");
  assert.equal(dueLine("2026-11-03", TODAY), "Срок был 3 ноября");
});

test("корешок главной цели не врёт про прошедший срок", () => {
  assert.deepEqual(dueStub("2026-11-08", TODAY), { count: 3, word: "дня", line: "до 8 ноября" });
  assert.equal(dueStub("2026-11-03", TODAY).count, null);
  assert.equal(dueStub("2026-11-03", TODAY).line, "Срок был 3 ноября");
  assert.equal(dueStub(TODAY, TODAY).line, "Срок сегодня");
  assert.equal(dueStub(null, TODAY).line, "Без срока");
});

test("быстрые сроки считаются от сегодняшнего дня и всегда в будущем", () => {
  const options = dueOptions(TODAY);
  assert.deepEqual(
    options.map((option) => option.date),
    ["2026-11-12", "2026-12-05", "2026-12-28", "2027-06-01"],
  );
  for (const today of ["2026-01-31", "2026-05-30", "2026-06-01", "2026-12-29"]) {
    for (const option of dueOptions(today)) {
      assert.ok(option.date > today, `${option.label} от ${today}: ${option.date}`);
    }
  }
  assert.equal(dueOptions("2026-01-31")[1].date, "2026-02-28", "в феврале нет 31 числа");
});

test("следующий шаг называет день словами", () => {
  const now = new Date(2026, 10, 5, 12, 0);
  assert.equal(
    nextStepText("Законы Ньютона", new Date(2026, 10, 5, 17, 15).toISOString(), now),
    "Законы Ньютона, сегодня в 17:15",
  );
  assert.equal(nextStepText("Тема", new Date(2026, 10, 6, 9, 5).toISOString(), now), "Тема, завтра в 09:05");
  assert.equal(nextStepText("Тема", new Date(2026, 10, 20, 9, 5).toISOString(), now), "Тема, 20 ноября в 09:05");
});

test("привычка находит цель с общей темой, а главная в приоритете", () => {
  const goals = [
    { id: "a", title: "Сдать физику на 9", isMain: false },
    { id: "b", title: "Пробежать 5 км", isMain: false },
    { id: "c", title: "Прочитать 12 книг за год", isMain: false },
    { id: "d", title: "Олимпиада по математике", isMain: true },
  ];
  assert.equal(suggestGoalFor("Решать 3 задачи", goals)?.id, "d");
  assert.equal(suggestGoalFor("Зарядка", goals)?.id, "b");
  assert.equal(suggestGoalFor("Читать 20 минут", goals)?.id, "c");
  assert.equal(suggestGoalFor("Гулять с собакой", goals), null);
  assert.equal(suggestGoalFor("Учить 10 слов", goals), null);
});

test("предмет находится по названию цели", () => {
  const lessons = [{ subject: "Физика 9" }, { subject: "Алгебра" }, { subject: "Русский язык" }];
  assert.deepEqual(matchLessons("Сдать физику на 9", lessons), [{ subject: "Физика 9" }]);
  assert.deepEqual(matchLessons("Итоговые по физике и алгебре", lessons).length, 2);
  assert.deepEqual(matchLessons("Пробежать 5 км", lessons), []);
});

test("завершённая цель помнит, сколько было на самом деле", () => {
  const goal = mapGoal({ id: "a", status: "done", progress: 30 });
  assert.equal(goal.progress, 100);
  assert.equal(goal.savedProgress, 30);
});

test("идеи привычек зависят от цели", () => {
  assert.deepEqual(habitIdeasFor("Сдать физику на 9", "study"), ["Решать 3 задачи", "Повторять формулы"]);
  assert.deepEqual(habitIdeasFor("Сдать историю", "study"), ["Повторять темы"]);
  assert.deepEqual(habitIdeasFor("Пробежать 5 км", "general"), ["Каждый день по шагу"]);
});

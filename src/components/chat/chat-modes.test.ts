import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CHAT_MODES,
  formatDue,
  goalQuestion,
  goalTone,
  hasSteps,
  modeByKey,
  nextMode,
  selectPlanGoals,
  stepsFromAnswer,
  type PlanGoal,
} from "./chat-modes.ts";

const NOW = new Date(2026, 10, 5);

function goal(overrides: Partial<PlanGoal> = {}): PlanGoal {
  return { id: "a", title: "Сдать физику", type: "goal", status: "active", ...overrides };
}

test("незнакомый режим значит обычный", () => {
  assert.equal(modeByKey("plan").key, "plan");
  assert.equal(modeByKey("нет такого").key, "plain");
  assert.equal(modeByKey(null).key, "plain");
});

test("Shift+Tab идёт по кругу", () => {
  const seen = [];
  let key = CHAT_MODES[0].key;
  for (let step = 0; step < CHAT_MODES.length; step += 1) {
    key = nextMode(key).key;
    seen.push(key);
  }
  assert.deepEqual(seen, ["plan", "guide", "ideas", "check", "plain"]);
});

test("в планировании только цели, и только незакрытые", () => {
  const rows = [
    goal({ id: "обычная" }),
    goal({ id: "большая", type: "global_goal" }),
    goal({ id: "деньги", type: "financial_goal" }),
    goal({ id: "подцель", type: "subgoal" }),
    goal({ id: "привычка", type: "habit" }),
    goal({ id: "сделано", status: "done" }),
    goal({ id: "в архиве", status: "archived" }),
  ];

  assert.deepEqual(
    selectPlanGoals(rows).map((row) => row.id),
    ["обычная", "большая", "деньги"],
  );
});

test("главная цель первой, дальше важные и близкие, цель без срока за ними", () => {
  const rows = [
    goal({ id: "без срока", priority: "high" }),
    goal({ id: "неважная", priority: "low", endDate: "2026-11-06" }),
    goal({ id: "позже", priority: "high", endDate: "2027-01-01" }),
    goal({ id: "скоро", priority: "high", endDate: "2026-12-01" }),
    goal({ id: "главная", priority: "low", isMain: true }),
  ];

  assert.deepEqual(
    selectPlanGoals(rows).map((row) => row.id),
    ["главная", "скоро", "позже", "без срока", "неважная"],
  );
});

test("цвет свой, а у старой цели всегда один и тот же", () => {
  const known = ["p-indigo", "p-rose", "p-teal", "p-blue", "p-amber"];
  assert.equal(goalTone({ id: "a", tone: "teal" }), "p-teal");
  const picked = goalTone({ id: "старая цель" });
  assert.ok(known.includes(picked));
  assert.equal(goalTone({ id: "старая цель", tone: null }), picked);
  // Незнакомый цвет не должен попасть в разметку как класс.
  assert.ok(known.includes(goalTone({ id: "a", tone: "evil x" })));
});

test("срок: год пишем, только если он другой", () => {
  assert.equal(formatDue("2026-11-06", NOW), "6 ноября");
  assert.equal(formatDue("2027-09-01", NOW), "1 сентября 2027");
  assert.equal(formatDue(null, NOW), null);
  assert.equal(formatDue("завтра", NOW), null);
});

test("вопрос по цели называет срок, если он есть", () => {
  assert.equal(
    goalQuestion(goal({ endDate: "2026-11-06" }), NOW),
    "Цель: «Сдать физику», срок 6 ноября. Разложи на шаги.",
  );
  assert.equal(goalQuestion(goal(), NOW), "Цель: «Сдать физику». Разложи на шаги.");
});

test("из ответа берутся шаги, а не вступление", () => {
  const answer = [
    "Главное успеть разбор до пятницы.",
    "",
    "1. **Разбор темы**, 30 минут",
    "2. Задачи, 40 минут",
    "3. Проверочный вариант, 45 минут",
    "",
    "Начни сегодня.",
  ].join("\n");

  assert.equal(hasSteps(answer), true);
  assert.equal(
    stepsFromAnswer(answer),
    "1. Разбор темы, 30 минут\n2. Задачи, 40 минут\n3. Проверочный вариант, 45 минут",
  );
});

test("маркированный список тоже шаги", () => {
  assert.equal(stepsFromAnswer("Вот так:\n- Разбор\n- Задачи"), "- Разбор\n- Задачи");
});

test("без списка уходит весь ответ, но не бесконечный", () => {
  assert.equal(hasSteps("Какая цель и какой срок?"), false);
  assert.equal(stepsFromAnswer("**Какая** цель?"), "Какая цель?");
  const long = stepsFromAnswer("а".repeat(2000));
  assert.ok(long.length <= 901);
  assert.ok(long.endsWith("…"));
});

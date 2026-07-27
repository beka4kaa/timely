import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildLessonPlan,
  buildLocalPlanningSummary,
  fallbackPlanningQuestion,
  isLessonPlan,
} from "./lesson-plan";

test("fallback question is goal-aware and has at most three model options", () => {
  const question = fallbackPlanningQuestion("solve", "solve_problem");

  assert.equal(question.id, "solution_focus");
  assert.equal(question.options.length, 3);
  assert.ok(
    question.options.every(
      (option) => !option.label.toLocaleLowerCase("ru").startsWith("друго"),
    ),
  );
});

test("local fallback summary preserves focus and success criteria", () => {
  const summary = buildLocalPlanningSummary({
    topic: "Второй закон Ньютона",
    goal: "solve",
    resultType: "solve_problem",
    level: "school",
    durationMinutes: 35,
    focus: "Построить модель",
  });

  assert.equal(summary.focus, "Построить модель");
  assert.equal(summary.duration_minutes, 35);
  assert.equal(summary.success_criteria.length, 2);
});

test("extended lesson plan survives deterministic frontend fallback", () => {
  const plan = buildLessonPlan({
    topic: "Второй закон Ньютона",
    goal: "solve",
    resultType: "solve_problem",
    level: "school",
    durationMinutes: 35,
    difficulties: ["Построить модель"],
    successCriteria: ["Проверить ответ"],
  });

  assert.equal(plan.resultType, "solve_problem");
  assert.deepEqual(plan.difficulties, ["Построить модель"]);
  assert.deepEqual(plan.successCriteria, ["Проверить ответ"]);
  assert.ok(plan.tasks.length >= 5);
  assert.ok(isLessonPlan(plan));
  assert.equal(isLessonPlan({ topic: "Без задач", tasks: [] }), false);
});

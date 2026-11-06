import assert from "node:assert/strict";
import { test } from "node:test";

import { answerPreview } from "./answer-preview.ts";
import {
  canUndoProposal,
  historyContent,
  proposalDoneText,
  proposalHeading,
  proposalRows,
  proposalSummary,
  type AssistantProposal,
} from "./assistant-proposal.ts";

const HABIT: AssistantProposal = { id: "a", kind: "new_habit", name: "Зарядка", goal_id: null, goal_title: null };
const GOAL: AssistantProposal = {
  id: "b",
  kind: "new_goal",
  title: "Сдать физику на 9",
  scope: "study",
  deadline: "2026-12-20",
  habits: ["Решать задачи"],
};

test("карточка говорит, что именно изменится", () => {
  assert.equal(proposalHeading(HABIT), "Добавлю привычку:");
  assert.deepEqual(proposalRows(HABIT), [{ name: "Зарядка", note: "каждый день" }]);
  assert.deepEqual(proposalRows({ ...HABIT, goal_title: "Форма" } as AssistantProposal), [
    { name: "Зарядка", note: "к цели «Форма»" },
  ]);
  assert.deepEqual(proposalRows(GOAL), [
    { name: "Сдать физику на 9", note: "к 20 декабря" },
    { name: "Решать задачи", note: "привычка" },
  ]);
  assert.deepEqual(
    proposalRows({ id: "c", kind: "goal_progress", goal_id: "g", title: "Цель", before: 20, progress: 45 }),
    [{ name: "Цель", note: "20% → 45%" }],
  );
});

test("новая привычка показывает, как часто", () => {
  const weekly = { ...HABIT, frequency: "weekdays", weekdays: [0, 2], interval_days: 2 } as AssistantProposal;
  assert.deepEqual(proposalRows(weekly), [{ name: "Зарядка", note: "пн, ср" }]);
  assert.deepEqual(proposalRows({ ...weekly, goal_title: "Форма" } as AssistantProposal), [
    { name: "Зарядка", note: "пн, ср, к цели «Форма»" },
  ]);
  assert.match(proposalSummary(weekly), /пн, ср/);
});

test("смена частоты показывает, что было и что станет, и её можно вернуть", () => {
  const change: AssistantProposal = {
    id: "s",
    kind: "habit_schedule",
    habit_id: 1,
    name: "Зарядка",
    frequency: "interval",
    weekdays: [],
    interval_days: 2,
    before: { frequency: "daily", weekdays: [], interval_days: 2 },
  };
  assert.equal(proposalHeading(change), "Поменяю, как часто:");
  assert.deepEqual(proposalRows(change), [{ name: "Зарядка", note: "каждый день → через день" }]);
  assert.equal(proposalDoneText(change), "«Зарядка» теперь через день.");
  assert.equal(canUndoProposal(change), true);
  assert.match(proposalSummary(change), /через день/);
});

test("отметка и снятие отметки называются по-разному", () => {
  const mark: AssistantProposal = { id: "d", kind: "mark_habit", habit_id: 1, name: "Зарядка", done: true };
  const unmark: AssistantProposal = { ...mark, done: false } as AssistantProposal;
  assert.notEqual(proposalHeading(mark), proposalHeading(unmark));
  assert.notEqual(proposalDoneText(mark), proposalDoneText(unmark));
});

test("вернуть нельзя только новый ритм: прежние окна уже удалены", () => {
  assert.equal(canUndoProposal(HABIT), true);
  assert.equal(
    canUndoProposal({ id: "e", kind: "study_windows", windows: [], replace: true, current: [], template_id: "t" }),
    false,
  );
});

test("память разговора знает, что предлагалось и что решил ученик", () => {
  assert.equal(historyContent({ content: "Привет" }), "Привет");
  const waiting = historyContent({ content: "Предлагаю.", proposals: [HABIT] });
  assert.match(waiting, /новая привычка «Зарядка»/);
  assert.match(waiting, /ждёт решения/);
  const applied = historyContent({ content: "Предлагаю.", proposals: [{ ...HABIT, state: "applied" }] });
  assert.match(applied, /ученик применил/);
  const refused = historyContent({ content: "Предлагаю.", proposals: [{ ...HABIT, state: "dismissed" }] });
  assert.match(refused, /отказался/);
});

test("у расписания своя короткая подпись", () => {
  assert.equal(
    proposalSummary({ id: "f", kind: "commitments", items: [{ title: "Репетитор", kind: "tutor" }] }),
    "занятое время: Репетитор",
  );
});

test("в плашке начало ответа без разметки", () => {
  assert.equal(answerPreview("**Производная** это $f'(x)$ и [ссылка](http://x)"), "Производная это f'(x) и ссылка");
  assert.equal(answerPreview("```py\nprint(1)\n```\nГотово"), "Готово");
  const long = answerPreview("слово ".repeat(100), 60);
  assert.ok(long.length <= 61);
  assert.ok(long.endsWith("…"));
  assert.ok(!long.includes("  "));
});

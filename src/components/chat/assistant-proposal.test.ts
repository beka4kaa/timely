import assert from "node:assert/strict";
import { test } from "node:test";

import { answerPreview } from "./answer-preview.ts";
import {
  batchRows,
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

const STUDY_PLAN: AssistantProposal = {
  id: "s",
  kind: "study_plan",
  subject: "Русский язык",
  goal_id: null,
  is_new: true,
  path: "new_sessions",
  weekdays: [0, 1, 2, 3, 4],
  start_time: "16:00",
  end_time: "17:00",
  minutes: 60,
  from_date: "2026-11-09",
  to_date: "2026-11-13",
  timezone: "Asia/Almaty",
  sessions: 5,
  left_topics: 0,
  approves_plan: false,
};

test("карточка предмета говорит, что появится и когда", () => {
  assert.equal(proposalHeading(STUDY_PLAN), "Настрою предмет:");
  assert.deepEqual(proposalRows(STUDY_PLAN), [
    { name: "Русский язык", note: "новый предмет" },
    { name: "Занятия", note: "по будням, 16:00–17:00, 9–13 ноября, 5 занятий" },
  ]);
  assert.equal(canUndoProposal(STUDY_PLAN), true);
  assert.equal(proposalDoneText(STUDY_PLAN), "«Русский язык»: 5 занятий в календаре.");
  assert.equal(proposalSummary(STUDY_PLAN), "новый предмет «Русский язык», по будням, 16:00–17:00, 9–13 ноября, 5 занятий");
});

test("в общей карточке понятно, что именно появится", () => {
  assert.deepEqual(batchRows(STUDY_PLAN), proposalRows(STUDY_PLAN));
  assert.deepEqual(batchRows(HABIT), [{ name: "Привычка «Зарядка»", note: "каждый день" }]);
  assert.deepEqual(batchRows(GOAL), [
    { name: "Цель «Сдать физику на 9»", note: "срок 20 декабря" },
    { name: "Решать задачи", note: "привычка" },
  ]);
  assert.deepEqual(batchRows({ id: "m", kind: "mark_habit", habit_id: 1, name: "Зарядка", done: true }), [
    { name: "Зарядка", note: "отмечу за сегодня" },
  ]);
  assert.deepEqual(batchRows({ id: "t", kind: "new_topics", topics: [{ title: "Закон Ома", subject: "Физика" }] }), [
    { name: "Закон Ома", note: "в повторение, Физика" },
  ]);
});

test("предмет без занятий это одна строка", () => {
  const alone = { ...STUDY_PLAN, path: "subject_only", weekdays: [], start_time: null, end_time: null, from_date: null, to_date: null, sessions: 0 } as AssistantProposal;
  assert.deepEqual(proposalRows(alone), [{ name: "Русский язык", note: "новый предмет" }]);
  assert.equal(proposalDoneText(alone), "Предмет «Русский язык» добавлен.");
  assert.equal(proposalSummary(alone), "новый предмет «Русский язык»");
});

test("книга говорит про остальные темы и про подтверждение программы", () => {
  const book = { ...STUDY_PLAN, path: "book_topics", is_new: false, left_topics: 25, approves_plan: true } as AssistantProposal;
  assert.deepEqual(proposalRows(book), [
    { name: "Русский язык", note: "" },
    { name: "Занятия", note: "по будням, 16:00–17:00, 9–13 ноября, 5 занятий" },
    { name: "Остальные темы", note: "ещё 25 можно поставить потом" },
    { name: "Программа", note: "подтвержу" },
  ]);
});

test("добавленные занятия и разовое занятие называются своими словами", () => {
  const extra = {
    ...STUDY_PLAN,
    path: "extra_sessions",
    is_new: false,
    weekdays: [3],
    from_date: "2026-11-19",
    to_date: "2026-11-19",
    sessions: 1,
  } as AssistantProposal;
  assert.equal(proposalHeading(extra), "Добавлю занятия:");
  assert.deepEqual(proposalRows(extra), [
    { name: "Русский язык", note: "к тому, что уже есть" },
    { name: "Занятия", note: "16:00–17:00, 19 ноября, 1 занятие" },
  ]);
});

test("период через границу месяца и редкие дни", () => {
  const span = { ...STUDY_PLAN, weekdays: [0, 2], from_date: "2026-11-30", to_date: "2026-12-04", sessions: 2 } as AssistantProposal;
  assert.equal(proposalRows(span)[1].note, "пн, ср, 16:00–17:00, 30 ноября – 4 декабря, 2 занятия");
});

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

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

const CANCEL: AssistantProposal = {
  id: "c",
  kind: "block_changes",
  action: "cancel",
  block_ids: ["b1"],
  titles: ["Механика, занятие 3"],
};
const REMOVAL: AssistantProposal = {
  id: "r",
  kind: "commitment_removal",
  items: [
    { id: "k", title: "Репетитор", kind: "tutor", weekday: 2, weekday_name: "среда", start_time: "18:00", duration_minutes: 60 },
    { id: "m", title: "Экзамен", kind: "exam", start_at: "2026-11-20T04:00:00Z", end_at: "2026-11-20T06:00:00Z" },
  ],
};

test("занятия: что с ними будет", () => {
  assert.equal(proposalHeading(CANCEL), "Отменю занятия:");
  assert.deepEqual(proposalRows(CANCEL), [{ name: "Механика, занятие 3", note: "" }]);
  assert.equal(canUndoProposal(CANCEL), true);
  assert.equal(proposalDoneText(CANCEL), "Занятия отменены.");
  assert.deepEqual(batchRows(CANCEL), [{ name: "Механика, занятие 3", note: "отменю занятия" }]);
  assert.equal(proposalSummary(CANCEL), "отменить занятия: Механика, занятие 3");
  for (const [action, heading, done] of [
    ["restore", "Верну занятия:", "Занятия возвращены."],
    ["pin", "Закреплю занятия:", "Занятия закреплены."],
    ["unpin", "Сниму закрепление:", "Закрепление снято."],
  ]) {
    const proposal = { ...CANCEL, action } as AssistantProposal;
    assert.equal(proposalHeading(proposal), heading);
    assert.equal(proposalDoneText(proposal), done);
  }
});

test("занятое время: что уберу", () => {
  assert.equal(proposalHeading(REMOVAL), "Уберу занятое время:");
  assert.deepEqual(proposalRows(REMOVAL), [
    { name: "Репетитор", note: "среда, 18:00" },
    { name: "Экзамен", note: "разово" },
  ]);
  assert.equal(canUndoProposal(REMOVAL), true);
  assert.equal(proposalDoneText(REMOVAL), "Занятое время убрано.");
  assert.equal(proposalSummary(REMOVAL), "убрать занятое время: Репетитор, Экзамен");
});

const GOAL_DEADLINE: AssistantProposal = {
  id: "g",
  kind: "goal_change",
  goal_id: "g1",
  title: "Сдать физику",
  fields: { dueDate: "2027-01-01" },
  before: { dueDate: "2026-12-20" },
  previous_main_id: null,
};
const RENAME_HABIT: AssistantProposal = {
  id: "h",
  kind: "habit_change",
  habit_id: 1,
  name: "Зарядка",
  fields: { name: "Растяжка" },
  before: { name: "Зарядка" },
  goal_title: null,
  delete: false,
};
const DELETE_HABIT = { ...RENAME_HABIT, fields: {}, before: {}, delete: true } as AssistantProposal;

test("цель: что поменяется", () => {
  assert.equal(proposalHeading(GOAL_DEADLINE), "Поменяю цель:");
  assert.deepEqual(proposalRows(GOAL_DEADLINE), [{ name: "Сдать физику", note: "срок 20 декабря → 1 января" }]);
  assert.equal(canUndoProposal(GOAL_DEADLINE), true);
  assert.equal(proposalDoneText(GOAL_DEADLINE), "Цель «Сдать физику» обновлена.");
  const note = (fields: object, before: object = {}) =>
    proposalRows({ ...GOAL_DEADLINE, fields, before } as AssistantProposal)[0].note;
  assert.equal(note({ title: "Новая" }, { title: "Сдать физику" }), "название «Новая»");
  assert.equal(note({ dueDate: null }, { dueDate: "2026-12-20" }), "срок убрать");
  assert.equal(note({ dueDate: "2026-12-20" }, { dueDate: null }), "срок 20 декабря");
  assert.equal(note({ isMain: true }, { isMain: false }), "сделаю главной");
  assert.equal(note({ isMain: false }, { isMain: true }), "больше не главная");
  assert.equal(note({ status: "done" }), "закрою");
  assert.equal(note({ status: "archived" }), "уберу в архив, вернуть можно");
  assert.equal(note({ title: "Новая", status: "done" }), "название «Новая», закрою");
});

test("привычка: что поменяется и что вернуть нельзя", () => {
  assert.equal(proposalHeading(RENAME_HABIT), "Поменяю привычку:");
  assert.deepEqual(proposalRows(RENAME_HABIT), [{ name: "Зарядка", note: "название «Растяжка»" }]);
  assert.equal(canUndoProposal(RENAME_HABIT), true);
  assert.equal(proposalDoneText(RENAME_HABIT), "Привычка «Растяжка» обновлена.");

  assert.equal(proposalHeading(DELETE_HABIT), "Удалю привычку:");
  assert.deepEqual(proposalRows(DELETE_HABIT), [{ name: "Зарядка", note: "отметки удалятся, вернуть нельзя" }]);
  assert.equal(canUndoProposal(DELETE_HABIT), false);
  assert.equal(proposalDoneText(DELETE_HABIT), "Привычка «Зарядка» удалена.");
  assert.equal(proposalSummary(DELETE_HABIT), "удалить привычку «Зарядка»");

  const toGoal = { ...RENAME_HABIT, fields: { goal: "g1" }, before: { goal: null }, goal_title: "Форма" } as AssistantProposal;
  assert.deepEqual(proposalRows(toGoal), [{ name: "Зарядка", note: "к цели «Форма»" }]);
  const noGoal = { ...RENAME_HABIT, fields: { goal: null }, before: { goal: "g1" } } as AssistantProposal;
  assert.deepEqual(proposalRows(noGoal), [{ name: "Зарядка", note: "без цели" }]);
});

const DELETE_SUBJECT: AssistantProposal = {
  id: "s",
  kind: "subject_change",
  goal_ids: ["g"],
  subject_ids: ["s"],
  name: "Биология",
  new_name: null,
  delete: true,
  blocks: 6,
  topics: 3,
  books: 0,
  chats: 0,
};
const TOPIC_RENAME: AssistantProposal = {
  id: "t",
  kind: "topic_change",
  topic_id: "t1",
  name: "Клетка",
  subject: "Биология",
  fields: { name: "Строение клетки" },
  before: { name: "Клетка" },
  new_subject: null,
  reviewed: false,
  delete: false,
};

test("предмет: что удалится и что поменяется", () => {
  assert.equal(proposalHeading(DELETE_SUBJECT), "Удалю предмет:");
  assert.deepEqual(proposalRows(DELETE_SUBJECT), [
    { name: "Биология", note: "удалю 6 занятий и 3 темы на повторение, вернуть нельзя" },
  ]);
  assert.equal(canUndoProposal(DELETE_SUBJECT), false);
  assert.equal(proposalDoneText(DELETE_SUBJECT), "Предмет «Биология» удалён.");
  const withBooks = { ...DELETE_SUBJECT, books: 1, chats: 2 } as AssistantProposal;
  assert.equal(
    proposalRows(withBooks)[0].note,
    "удалю 6 занятий, 3 темы на повторение, 1 книгу и 2 разговора, вернуть нельзя",
  );
  const bare = { ...DELETE_SUBJECT, blocks: 0, topics: 0 } as AssistantProposal;
  assert.equal(proposalRows(bare)[0].note, "вернуть нельзя");

  const rename = { ...DELETE_SUBJECT, delete: false, new_name: "Биология 10" } as AssistantProposal;
  assert.equal(proposalHeading(rename), "Поменяю предмет:");
  assert.deepEqual(proposalRows(rename), [{ name: "Биология", note: "название «Биология 10»" }]);
  assert.equal(canUndoProposal(rename), true);
  assert.equal(proposalDoneText(rename), "Предмет теперь называется «Биология 10».");
});

test("тема: что поменяется и что вернуть нельзя", () => {
  assert.equal(proposalHeading(TOPIC_RENAME), "Поменяю тему:");
  assert.deepEqual(proposalRows(TOPIC_RENAME), [{ name: "Клетка", note: "название «Строение клетки»" }]);
  assert.equal(canUndoProposal(TOPIC_RENAME), true);
  assert.equal(proposalDoneText(TOPIC_RENAME), "Тема обновлена.");

  const moved = { ...TOPIC_RENAME, fields: { subjectId: "h" }, before: { subjectId: "b" }, new_subject: "Химия" } as AssistantProposal;
  assert.equal(proposalRows(moved)[0].note, "в предмет «Химия»");
  const reviewed = { ...TOPIC_RENAME, fields: {}, before: {}, reviewed: true } as AssistantProposal;
  assert.equal(proposalRows(reviewed)[0].note, "отмечу, что повторил");
  assert.equal(canUndoProposal(reviewed), true);
  const deleted = { ...TOPIC_RENAME, fields: {}, before: {}, delete: true } as AssistantProposal;
  assert.equal(proposalHeading(deleted), "Удалю тему:");
  assert.equal(proposalRows(deleted)[0].note, "вернуть нельзя");
  assert.equal(canUndoProposal(deleted), false);
  assert.equal(proposalDoneText(deleted), "Тема «Клетка» удалена.");
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

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseDeadline, recordTarget, understandLocally } from "./understand.ts";

test("вопрос остаётся вопросом, даже если в нём есть «хочу» или «цель»", () => {
  assert.equal(understandLocally("Что такое цель?").kind, "question");
  assert.equal(understandLocally("как сдать физику").kind, "question");
  assert.equal(understandLocally("Хочу понять производную").kind, "question");
  assert.equal(understandLocally("Перенеси физику на завтра").kind, "question");
});

test("запись находит своё место по смыслу", () => {
  assert.equal(understandLocally("Хочу сдать физику на 9 к декабрю").kind, "goal");
  assert.equal(understandLocally("Буду читать 20 минут каждый день").kind, "habit");
  const topics = understandLocally("Сегодня изучил закон Ома и метод интервалов");
  assert.equal(topics.kind, "topics");
  assert.equal(topics.kind === "topics" ? topics.topics.length : 0, 2);
});

test("у каждой темы свой предмет, чужой ей не приписывается", () => {
  const mixed = understandLocally("Сегодня изучил закон Ома и метод интервалов");
  assert.deepEqual(
    mixed.kind === "topics" ? mixed.topics.map((topic) => topic.subject) : [],
    ["Физика", "Алгебра"],
  );
  const unknown = understandLocally("Сегодня изучил закон Ома и правило ударения");
  assert.deepEqual(
    unknown.kind === "topics" ? unknown.topics.map((topic) => topic.subject) : [],
    ["Физика", ""],
  );
  const named = understandLocally("Сегодня по физике разобрал импульс и работу");
  assert.deepEqual(named.kind === "topics" ? named.topics : [], [
    { title: "Импульс", subject: "Физика" },
    { title: "Работу", subject: "Физика" },
  ]);
});

test("страница подсказывает, если по словам непонятно", () => {
  assert.equal(understandLocally("Победа на олимпиаде").kind, "question");
  assert.equal(understandLocally("Победа на олимпиаде", "goal").kind, "goal");
  assert.equal(understandLocally("Закон Ома", "topics").kind, "topics");
});

test("срок из текста: прошедший месяц значит следующий год", () => {
  const now = new Date(2026, 10, 5);
  assert.equal(parseDeadline("к декабрю", now), "2026-12-01");
  assert.equal(parseDeadline("до 20 мая", now), "2027-05-20");
  assert.equal(parseDeadline("когда-нибудь", now), null);
});

test("запись несут на её страницу, вопрос никуда не несут", () => {
  assert.equal(recordTarget("question", "что это"), null);
  assert.equal(recordTarget("goal", "сдать физику")?.href, "/dashboard/goals?new=%D1%81%D0%B4%D0%B0%D1%82%D1%8C%20%D1%84%D0%B8%D0%B7%D0%B8%D0%BA%D1%83");
  assert.equal(recordTarget("habit", "x")?.path, "/dashboard/habits");
  assert.equal(recordTarget("topics", "x")?.href, "/dashboard/weaknesses?learned=x");
});

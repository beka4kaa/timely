import assert from "node:assert/strict";
import { test } from "node:test";

import { dayBucket, groupChatsByDay } from "./chat-groups";

const NOW = new Date(2026, 7, 11, 14, 30); // 11 августа 2026, вторник

function row(date: Date, id = date.toISOString()) {
  return { id, updated_at: date.toISOString() };
}

test("сегодняшний разговор попадает в «Сегодня»", () => {
  assert.equal(dayBucket(new Date(2026, 7, 11, 0, 5).toISOString(), NOW), "today");
  assert.equal(dayBucket(new Date(2026, 7, 11, 23, 59).toISOString(), NOW), "today");
});

test("граница «вчера» — календарная, а не «24 часа назад»", () => {
  // Полчаса назад по календарю — уже вчера, если сейчас 00:15. Проверяем
  // обратное: вечер вчерашнего дня ближе по времени, чем утро сегодняшнего,
  // но группы у них разные.
  const midnight = new Date(2026, 7, 11, 0, 15);
  assert.equal(dayBucket(new Date(2026, 7, 10, 23, 50).toISOString(), midnight), "yesterday");
  assert.equal(dayBucket(new Date(2026, 7, 11, 0, 1).toISOString(), midnight), "today");
});

test("шесть дней назад — ещё неделя, семь — уже «Ранее»", () => {
  assert.equal(dayBucket(new Date(2026, 7, 5).toISOString(), NOW), "week");
  assert.equal(dayBucket(new Date(2026, 7, 4).toISOString(), NOW), "earlier");
});

test("дата из будущего показывается как сегодняшняя", () => {
  // Часы устройства могут отставать от сервера; группы «Завтра» быть не должно.
  assert.equal(dayBucket(new Date(2026, 7, 13).toISOString(), NOW), "today");
});

test("испорченная дата не роняет список", () => {
  assert.equal(dayBucket("не дата", NOW), "earlier");
});

test("пустой список даёт пустой результат", () => {
  assert.deepEqual(groupChatsByDay([], NOW), []);
});

test("группы идут в постоянном порядке, пустых нет", () => {
  const groups = groupChatsByDay(
    [
      row(new Date(2026, 6, 1)), // ранее
      row(new Date(2026, 7, 11, 9)), // сегодня
      row(new Date(2026, 7, 8)), // на этой неделе
    ],
    NOW,
  );

  assert.deepEqual(
    groups.map((group) => group.label),
    ["Сегодня", "На этой неделе", "Ранее"],
  );
});

test("внутри группы свежие сверху", () => {
  const early = row(new Date(2026, 7, 11, 8), "утро");
  const late = row(new Date(2026, 7, 11, 20), "вечер");

  const [today] = groupChatsByDay([early, late], NOW);

  assert.deepEqual(
    today.rows.map((item) => item.id),
    ["вечер", "утро"],
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import { REVIEW_RATES, intervalLabel, plural, reviewDays } from "./mind-srs";

// Срок повторения считает сервер (FSRS, `backend/mind/srs.py`): на кнопке показываем
// его же число из `reviewIntervals`, а не свой расчёт.

test("четыре оценки от худшей к лучшей, подписи как на всех экранах", () => {
  assert.deepEqual(
    REVIEW_RATES.map((row) => [row.rating, row.label]),
    [
      ["AGAIN", "Не вспомнил"],
      ["HARD", "С трудом"],
      ["GOOD", "Вспомнил"],
      ["EASY", "Легко"],
    ],
  );
});

test("срок на кнопке берётся у сервера", () => {
  const topic = { reviewIntervals: { AGAIN: 1, HARD: 3, GOOD: 9, EASY: 21 } };
  assert.equal(reviewDays(topic, "GOOD"), 9);
  assert.equal(reviewDays(topic, "AGAIN"), 1);
  // Старый ответ без сроков: подписи нет, а не выдуманное число.
  assert.equal(reviewDays({}, "GOOD"), null);
  assert.equal(reviewDays({ reviewIntervals: null }, "EASY"), null);
  assert.equal(reviewDays({ reviewIntervals: { GOOD: 0 } }, "GOOD"), null);
});

test("подпись интервала читается по-русски", () => {
  assert.equal(intervalLabel(1), "завтра");
  assert.equal(intervalLabel(2), "через 2 дня");
  assert.equal(intervalLabel(5), "через 5 дней");
  assert.equal(intervalLabel(7), "через неделю");
  assert.equal(intervalLabel(11), "через 11 дней");
  assert.equal(intervalLabel(14), "через 2 недели");
  assert.equal(intervalLabel(21), "через 3 недели");
  assert.equal(intervalLabel(30), "через месяц");
  assert.equal(intervalLabel(60), "через 2 месяца");
  assert.equal(intervalLabel(365), "через год");
});

test("plural выбирает форму по числу", () => {
  assert.equal(plural(1, "тема", "темы", "тем"), "тема");
  assert.equal(plural(3, "тема", "темы", "тем"), "темы");
  assert.equal(plural(5, "тема", "темы", "тем"), "тем");
  assert.equal(plural(11, "тема", "темы", "тем"), "тем");
  assert.equal(plural(21, "тема", "темы", "тем"), "тема");
});

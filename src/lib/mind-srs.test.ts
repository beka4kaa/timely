import assert from "node:assert/strict";
import test from "node:test";

import { intervalLabel, nextReview, plural } from "./mind-srs";
import type { ReviewRating } from "../types/mind";

// Снято с `backend/mind/srs.py`: rating, status, interval, ease -> interval, ease, status.
// Расходиться с сервером нельзя: на кнопке написано то, что он потом и поставит.
const FROM_PYTHON: Array<[ReviewRating, string, number | null, number | null, number, number, string]> = [
  ["AGAIN", "NOT_STARTED", null, null, 1, 2.3, "MEDIUM"],
  ["HARD", "NOT_STARTED", null, null, 1, 2.35, "MEDIUM"],
  ["GOOD", "NOT_STARTED", null, null, 1, 2.5, "MEDIUM"],
  ["EASY", "NOT_STARTED", null, null, 7, 2.65, "SUCCESS"],
  ["AGAIN", "NOT_STARTED", 1, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "NOT_STARTED", 1, 2.5, 1, 2.35, "MEDIUM"],
  ["GOOD", "NOT_STARTED", 1, 2.5, 1, 2.5, "MEDIUM"],
  ["EASY", "NOT_STARTED", 1, 2.5, 7, 2.65, "SUCCESS"],
  ["AGAIN", "NOT_STARTED", 2, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "NOT_STARTED", 2, 2.5, 2, 2.35, "MEDIUM"],
  ["GOOD", "NOT_STARTED", 2, 2.5, 1, 2.5, "MEDIUM"],
  ["EASY", "NOT_STARTED", 2, 2.5, 7, 2.65, "SUCCESS"],
  ["AGAIN", "NOT_STARTED", 3, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "NOT_STARTED", 3, 2.5, 3, 2.35, "MEDIUM"],
  ["GOOD", "NOT_STARTED", 3, 2.5, 1, 2.5, "MEDIUM"],
  ["EASY", "NOT_STARTED", 3, 2.5, 11, 2.65, "SUCCESS"],
  ["AGAIN", "NOT_STARTED", 4, 1.3, 1, 1.3, "MEDIUM"],
  ["HARD", "NOT_STARTED", 4, 1.3, 4, 1.3, "MEDIUM"],
  ["GOOD", "NOT_STARTED", 4, 1.3, 1, 1.3, "MEDIUM"],
  ["EASY", "NOT_STARTED", 4, 1.3, 7, 1.45, "SUCCESS"],
  ["AGAIN", "NOT_STARTED", 7, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "NOT_STARTED", 7, 2.5, 8, 2.35, "MEDIUM"],
  ["GOOD", "NOT_STARTED", 7, 2.5, 1, 2.5, "MEDIUM"],
  ["EASY", "NOT_STARTED", 7, 2.5, 26, 2.65, "SUCCESS"],
  ["AGAIN", "NOT_STARTED", 8, 2.35, 1, 2.15, "MEDIUM"],
  ["HARD", "NOT_STARTED", 8, 2.35, 9, 2.2, "MEDIUM"],
  ["GOOD", "NOT_STARTED", 8, 2.35, 1, 2.35, "MEDIUM"],
  ["EASY", "NOT_STARTED", 8, 2.35, 28, 2.5, "SUCCESS"],
  ["AGAIN", "NOT_STARTED", 16, 2.8, 1, 2.6, "MEDIUM"],
  ["HARD", "NOT_STARTED", 16, 2.8, 19, 2.65, "MEDIUM"],
  ["GOOD", "NOT_STARTED", 16, 2.8, 1, 2.8, "MEDIUM"],
  ["EASY", "NOT_STARTED", 16, 2.8, 67, 2.95, "SUCCESS"],
  ["AGAIN", "NOT_STARTED", 40, 3.0, 1, 2.8, "MEDIUM"],
  ["HARD", "NOT_STARTED", 40, 3.0, 48, 2.85, "MEDIUM"],
  ["GOOD", "NOT_STARTED", 40, 3.0, 1, 3.0, "MEDIUM"],
  ["EASY", "NOT_STARTED", 40, 3.0, 180, 3.0, "SUCCESS"],
  ["AGAIN", "MEDIUM", null, null, 1, 2.3, "MEDIUM"],
  ["HARD", "MEDIUM", null, null, 1, 2.35, "MEDIUM"],
  ["GOOD", "MEDIUM", null, null, 2, 2.5, "MEDIUM"],
  ["EASY", "MEDIUM", null, null, 7, 2.65, "SUCCESS"],
  ["AGAIN", "MEDIUM", 1, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "MEDIUM", 1, 2.5, 1, 2.35, "MEDIUM"],
  ["GOOD", "MEDIUM", 1, 2.5, 2, 2.5, "MEDIUM"],
  ["EASY", "MEDIUM", 1, 2.5, 7, 2.65, "SUCCESS"],
  ["AGAIN", "MEDIUM", 2, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "MEDIUM", 2, 2.5, 2, 2.35, "MEDIUM"],
  ["GOOD", "MEDIUM", 2, 2.5, 5, 2.5, "MEDIUM"],
  ["EASY", "MEDIUM", 2, 2.5, 7, 2.65, "SUCCESS"],
  ["AGAIN", "MEDIUM", 3, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "MEDIUM", 3, 2.5, 3, 2.35, "MEDIUM"],
  ["GOOD", "MEDIUM", 3, 2.5, 7, 2.5, "SUCCESS"],
  ["EASY", "MEDIUM", 3, 2.5, 11, 2.65, "SUCCESS"],
  ["AGAIN", "MEDIUM", 4, 1.3, 1, 1.3, "MEDIUM"],
  ["HARD", "MEDIUM", 4, 1.3, 4, 1.3, "MEDIUM"],
  ["GOOD", "MEDIUM", 4, 1.3, 5, 1.3, "SUCCESS"],
  ["EASY", "MEDIUM", 4, 1.3, 7, 1.45, "SUCCESS"],
  ["AGAIN", "MEDIUM", 7, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "MEDIUM", 7, 2.5, 8, 2.35, "MEDIUM"],
  ["GOOD", "MEDIUM", 7, 2.5, 17, 2.5, "SUCCESS"],
  ["EASY", "MEDIUM", 7, 2.5, 26, 2.65, "SUCCESS"],
  ["AGAIN", "MEDIUM", 8, 2.35, 1, 2.15, "MEDIUM"],
  ["HARD", "MEDIUM", 8, 2.35, 9, 2.2, "MEDIUM"],
  ["GOOD", "MEDIUM", 8, 2.35, 18, 2.35, "SUCCESS"],
  ["EASY", "MEDIUM", 8, 2.35, 28, 2.5, "SUCCESS"],
  ["AGAIN", "MEDIUM", 16, 2.8, 1, 2.6, "MEDIUM"],
  ["HARD", "MEDIUM", 16, 2.8, 19, 2.65, "MEDIUM"],
  ["GOOD", "MEDIUM", 16, 2.8, 44, 2.8, "SUCCESS"],
  ["EASY", "MEDIUM", 16, 2.8, 67, 2.95, "SUCCESS"],
  ["AGAIN", "MEDIUM", 40, 3.0, 1, 2.8, "MEDIUM"],
  ["HARD", "MEDIUM", 40, 3.0, 48, 2.85, "MEDIUM"],
  ["GOOD", "MEDIUM", 40, 3.0, 120, 3.0, "SUCCESS"],
  ["EASY", "MEDIUM", 40, 3.0, 180, 3.0, "SUCCESS"],
  ["AGAIN", "SUCCESS", null, null, 1, 2.3, "MEDIUM"],
  ["HARD", "SUCCESS", null, null, 1, 2.35, "SUCCESS"],
  ["GOOD", "SUCCESS", null, null, 4, 2.5, "SUCCESS"],
  ["EASY", "SUCCESS", null, null, 7, 2.65, "MASTERED"],
  ["AGAIN", "SUCCESS", 1, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "SUCCESS", 1, 2.5, 1, 2.35, "SUCCESS"],
  ["GOOD", "SUCCESS", 1, 2.5, 4, 2.5, "SUCCESS"],
  ["EASY", "SUCCESS", 1, 2.5, 7, 2.65, "MASTERED"],
  ["AGAIN", "SUCCESS", 2, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "SUCCESS", 2, 2.5, 2, 2.35, "SUCCESS"],
  ["GOOD", "SUCCESS", 2, 2.5, 5, 2.5, "SUCCESS"],
  ["EASY", "SUCCESS", 2, 2.5, 7, 2.65, "MASTERED"],
  ["AGAIN", "SUCCESS", 3, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "SUCCESS", 3, 2.5, 3, 2.35, "SUCCESS"],
  ["GOOD", "SUCCESS", 3, 2.5, 7, 2.5, "SUCCESS"],
  ["EASY", "SUCCESS", 3, 2.5, 11, 2.65, "MASTERED"],
  ["AGAIN", "SUCCESS", 4, 1.3, 1, 1.3, "MEDIUM"],
  ["HARD", "SUCCESS", 4, 1.3, 4, 1.3, "SUCCESS"],
  ["GOOD", "SUCCESS", 4, 1.3, 5, 1.3, "SUCCESS"],
  ["EASY", "SUCCESS", 4, 1.3, 7, 1.45, "MASTERED"],
  ["AGAIN", "SUCCESS", 7, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "SUCCESS", 7, 2.5, 8, 2.35, "SUCCESS"],
  ["GOOD", "SUCCESS", 7, 2.5, 17, 2.5, "MASTERED"],
  ["EASY", "SUCCESS", 7, 2.5, 26, 2.65, "MASTERED"],
  ["AGAIN", "SUCCESS", 8, 2.35, 1, 2.15, "MEDIUM"],
  ["HARD", "SUCCESS", 8, 2.35, 9, 2.2, "SUCCESS"],
  ["GOOD", "SUCCESS", 8, 2.35, 18, 2.35, "MASTERED"],
  ["EASY", "SUCCESS", 8, 2.35, 28, 2.5, "MASTERED"],
  ["AGAIN", "SUCCESS", 16, 2.8, 1, 2.6, "MEDIUM"],
  ["HARD", "SUCCESS", 16, 2.8, 19, 2.65, "SUCCESS"],
  ["GOOD", "SUCCESS", 16, 2.8, 44, 2.8, "MASTERED"],
  ["EASY", "SUCCESS", 16, 2.8, 67, 2.95, "MASTERED"],
  ["AGAIN", "SUCCESS", 40, 3.0, 1, 2.8, "MEDIUM"],
  ["HARD", "SUCCESS", 40, 3.0, 48, 2.85, "SUCCESS"],
  ["GOOD", "SUCCESS", 40, 3.0, 120, 3.0, "MASTERED"],
  ["EASY", "SUCCESS", 40, 3.0, 180, 3.0, "MASTERED"],
  ["AGAIN", "MASTERED", null, null, 1, 2.3, "MEDIUM"],
  ["HARD", "MASTERED", null, null, 1, 2.35, "MASTERED"],
  ["GOOD", "MASTERED", null, null, 7, 2.5, "MASTERED"],
  ["EASY", "MASTERED", null, null, 7, 2.65, "MASTERED"],
  ["AGAIN", "MASTERED", 1, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "MASTERED", 1, 2.5, 1, 2.35, "MASTERED"],
  ["GOOD", "MASTERED", 1, 2.5, 7, 2.5, "MASTERED"],
  ["EASY", "MASTERED", 1, 2.5, 7, 2.65, "MASTERED"],
  ["AGAIN", "MASTERED", 2, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "MASTERED", 2, 2.5, 2, 2.35, "MASTERED"],
  ["GOOD", "MASTERED", 2, 2.5, 7, 2.5, "MASTERED"],
  ["EASY", "MASTERED", 2, 2.5, 7, 2.65, "MASTERED"],
  ["AGAIN", "MASTERED", 3, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "MASTERED", 3, 2.5, 3, 2.35, "MASTERED"],
  ["GOOD", "MASTERED", 3, 2.5, 7, 2.5, "MASTERED"],
  ["EASY", "MASTERED", 3, 2.5, 11, 2.65, "MASTERED"],
  ["AGAIN", "MASTERED", 4, 1.3, 1, 1.3, "MEDIUM"],
  ["HARD", "MASTERED", 4, 1.3, 4, 1.3, "MASTERED"],
  ["GOOD", "MASTERED", 4, 1.3, 7, 1.3, "MASTERED"],
  ["EASY", "MASTERED", 4, 1.3, 7, 1.45, "MASTERED"],
  ["AGAIN", "MASTERED", 7, 2.5, 1, 2.3, "MEDIUM"],
  ["HARD", "MASTERED", 7, 2.5, 8, 2.35, "MASTERED"],
  ["GOOD", "MASTERED", 7, 2.5, 17, 2.5, "MASTERED"],
  ["EASY", "MASTERED", 7, 2.5, 26, 2.65, "MASTERED"],
  ["AGAIN", "MASTERED", 8, 2.35, 1, 2.15, "MEDIUM"],
  ["HARD", "MASTERED", 8, 2.35, 9, 2.2, "MASTERED"],
  ["GOOD", "MASTERED", 8, 2.35, 18, 2.35, "MASTERED"],
  ["EASY", "MASTERED", 8, 2.35, 28, 2.5, "MASTERED"],
  ["AGAIN", "MASTERED", 16, 2.8, 1, 2.6, "MEDIUM"],
  ["HARD", "MASTERED", 16, 2.8, 19, 2.65, "MASTERED"],
  ["GOOD", "MASTERED", 16, 2.8, 44, 2.8, "MASTERED"],
  ["EASY", "MASTERED", 16, 2.8, 67, 2.95, "MASTERED"],
  ["AGAIN", "MASTERED", 40, 3.0, 1, 2.8, "MEDIUM"],
  ["HARD", "MASTERED", 40, 3.0, 48, 2.85, "MASTERED"],
  ["GOOD", "MASTERED", 40, 3.0, 120, 3.0, "MASTERED"],
  ["EASY", "MASTERED", 40, 3.0, 180, 3.0, "MASTERED"],
];

test("интервал считается так же, как на сервере", () => {
  for (const [rating, status, intervalDays, easeFactor, days, ease, next] of FROM_PYTHON) {
    const outcome = nextReview({ rating, status, intervalDays, easeFactor });
    const where = `${rating} ${status} ${intervalDays} ${easeFactor}`;
    assert.equal(outcome.intervalDays, days, where);
    assert.equal(Number(outcome.easeFactor.toFixed(6)), ease, where);
    assert.equal(outcome.status, next, where);
  }
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

import assert from "node:assert/strict";
import { test } from "node:test";

import { isScheduleRailRoute } from "./schedule-rail-routes";

test("на «Плане» панель работает помощником по расписанию", () => {
  assert.equal(isScheduleRailRoute("/dashboard/plan"), true);
});

test("вложенные страницы плана тоже считаются планом", () => {
  assert.equal(isScheduleRailRoute("/dashboard/plan/"), true);
  assert.equal(isScheduleRailRoute("/dashboard/plan/week"), true);
});

test("похожий по началу адрес планом НЕ считается", () => {
  // Сравнение по префиксу без разделителя поймало бы и «/dashboard/planner»,
  // и «/dashboard/plans»: помощник встал бы на чужую страницу.
  assert.equal(isScheduleRailRoute("/dashboard/planner"), false);
  assert.equal(isScheduleRailRoute("/dashboard/plans"), false);
});

test("на остальных страницах панель остаётся чатом по книге", () => {
  assert.equal(isScheduleRailRoute("/dashboard/curriculum"), false);
  assert.equal(isScheduleRailRoute("/dashboard/diary"), false);
  assert.equal(isScheduleRailRoute("/dashboard"), false);
  assert.equal(isScheduleRailRoute(""), false);
});

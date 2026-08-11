import assert from "node:assert/strict";
import { test } from "node:test";

import { isRailFreeRoute } from "./rail-free-routes";

test("на «Тьюторе» панели вопросов нет", () => {
  // Чат внутри чата: та же переписка была бы на экране дважды.
  assert.equal(isRailFreeRoute("/dashboard/chat"), true);
});

test("на доске панели вопросов нет", () => {
  // У доски свой AI-тьютор справа, и панель ложилась поверх него.
  assert.equal(isRailFreeRoute("/dashboard/whiteboard"), true);
  assert.equal(isRailFreeRoute("/dashboard/board"), true);
});

test("вложенные страницы наследуют запрет", () => {
  assert.equal(isRailFreeRoute("/dashboard/chat/whatever"), true);
});

test("на остальных страницах панель есть", () => {
  for (const route of [
    "/dashboard",
    "/dashboard/diary",
    "/dashboard/curriculum",
    "/dashboard/subjects",
  ]) {
    assert.equal(isRailFreeRoute(route), false, route);
  }
});

test("похожий адрес не считается запрещённым", () => {
  // Префикс совпадает, страница другая.
  assert.equal(isRailFreeRoute("/dashboard/chatter"), false);
  assert.equal(isRailFreeRoute(""), false);
});

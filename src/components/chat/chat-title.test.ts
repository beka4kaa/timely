import assert from "node:assert/strict";
import { test } from "node:test";

import { NEW_CHAT_TITLE, chatTitle } from "./chat-title";

test("у чата есть название: показываем его", () => {
  assert.equal(chatTitle("Квадратные уравнения"), "Квадратные уравнения");
});

test("без названия, с пробелами или без чата: то же слово, что в списке чатов", () => {
  for (const title of [undefined, null, "", "   "]) assert.equal(chatTitle(title), NEW_CHAT_TITLE);
  assert.equal(NEW_CHAT_TITLE, "Новый чат");
});

test("лишние пробелы по краям не показываем", () => {
  assert.equal(chatTitle("  Физика  "), "Физика");
});

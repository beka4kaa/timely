import assert from "node:assert/strict";
import { test } from "node:test";

import { askErrorText, STOPPED_ERROR } from "./ask-stages.ts";

const GENERAL = "Тьютор сейчас не отвечает. Попробуй ещё раз через минуту.";

test("текст о лимите показывается как есть: в нём время обновления", () => {
  const text = "Лимит запросов закончился. Он обновится 9 ноября в 03:00.";
  assert.equal(askErrorText(text), text);
});

test("общая фраза сервера остаётся общей", () => {
  assert.equal(askErrorText(GENERAL), GENERAL);
});

test("техническая ошибка ученику не показывается", () => {
  assert.equal(askErrorText("404 No endpoints found for z-ai/glm-5.3"), GENERAL);
});

test("обрыв связи объясняется отдельно", () => {
  assert.equal(askErrorText("Failed to fetch"), "Нет связи с сервером. Проверь интернет и попробуй ещё раз.");
});

test("остановка учеником не считается сбоем", () => {
  assert.equal(askErrorText(STOPPED_ERROR), "Остановлено");
});

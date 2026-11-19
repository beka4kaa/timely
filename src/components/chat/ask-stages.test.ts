import assert from "node:assert/strict";
import { test } from "node:test";

import { setLocaleForTests } from "../../lib/i18n";

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

test("чужая английская ошибка про лимит провайдера не показывается как есть", () => {
  assert.equal(askErrorText("Rate limit exceeded"), GENERAL);
});

test("по-английски: ошибки сервера разбираются по русскому тексту, а показываются по-английски", () => {
  setLocaleForTests("en");
  try {
    assert.equal(askErrorText("Предмет не найден."), "This book is gone. Pick another one and ask again.");
    assert.equal(askErrorText("Лимит AI-токенов исчерпан. Дождитесь обновления лимита."), "AI limit reached. Wait for it to reset.");
    // Свой текст о лимите уже на языке интерфейса: в нём время обновления.
    const own = "Request limit reached. It will reset tomorrow at 03:00.";
    assert.equal(askErrorText(own), own);
    assert.equal(askErrorText("Rate limit exceeded"), "The tutor isn’t answering right now. Try again in a minute.");
  } finally {
    setLocaleForTests("ru");
  }
});

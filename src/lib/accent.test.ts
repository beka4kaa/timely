import assert from "node:assert/strict";
import { test } from "node:test";

import { ACCENTS, DEFAULT_ACCENT, accentBootScript, accentOf } from "./accent.ts";

test("по умолчанию синий, и он первый в списке", () => {
  assert.equal(DEFAULT_ACCENT, "blue");
  assert.equal(ACCENTS[0].key, "blue");
  assert.equal(new Set(ACCENTS.map((accent) => accent.key)).size, ACCENTS.length);
});

test("незнакомое значение становится синим", () => {
  assert.equal(accentOf("violet"), "violet");
  assert.equal(accentOf("mono"), "mono");
  assert.equal(accentOf("red; color: x"), "blue");
  assert.equal(accentOf(null), "blue");
});

function boot(stored: string | null, throws = false): string | null {
  const attrs = new Map<string, string>();
  const document = { documentElement: { setAttribute: (name: string, value: string) => attrs.set(name, value) } };
  const localStorage = {
    getItem: () => {
      if (throws) throw new Error("закрыто");
      return stored;
    },
  };
  new Function("document", "localStorage", accentBootScript())(document, localStorage);
  return attrs.get("data-accent") ?? null;
}

test("до первой отрисовки ставит выбранный цвет, синий не трогает", () => {
  assert.equal(boot("violet"), "violet");
  assert.equal(boot("blue"), null);
  assert.equal(boot(null), null);
  assert.equal(boot("<script>"), null);
  assert.equal(boot("green", true), null); // хранилище закрыто: остаётся синий
});

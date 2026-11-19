import assert from "node:assert/strict";
import { test } from "node:test";

import { speakableText } from "./speakable.ts";

test("разметка не читается вслух: заголовки, жирный, курсив, код и ссылки становятся текстом", () => {
  assert.equal(
    speakableText("## Импульс\n\n**Импульс** — это _количество_ движения, см. `p` и [учебник](https://example.com)."),
    "Импульс.\nИмпульс — это количество движения, см. p и учебник.",
  );
});

test("пункты списка читаются по одному", () => {
  assert.equal(speakableText("- первый\n- второй\n1. третий"), "первый.\nвторой.\nтретий.");
});

test("формулы читаются словами", () => {
  assert.equal(speakableText("$p = mv$"), "p = mv");
  assert.equal(speakableText("$$\\frac{a}{b}$$"), "a делить на b");
  assert.equal(speakableText("$x^2 + y^{10}$"), "x в степени 2 + y в степени 10");
  assert.equal(speakableText("$\\sqrt{x} \\cdot 2 \\times 3$"), "корень из x умножить на 2 умножить на 3");
});

test("блок кода не зачитывается построчно", () => {
  assert.equal(speakableText("Смотри:\n```js\nconst a = 1;\n```"), "Смотри:\nПример кода пропускаю.");
});

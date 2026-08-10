import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import { boardStages } from "./board-stages.ts";
import { ThinkingNote, type ThinkingStage } from "./thinking-note.tsx";

function html(props: Parameters<typeof ThinkingNote>[0]): string {
  return renderToStaticMarkup(createElement(ThinkingNote, props));
}

const STAGES: ThinkingStage[] = [
  { key: "retrieving", label: "Ищу в книге", done: true },
  { key: "found", label: "Нашёл 8 фрагментов", done: true },
  { key: "answering", label: "Отвечаю", done: false },
];

test("этапы показываются без всякого рассуждения", () => {
  // Случай панели: DeepSeek V4 Flash идёт без reasoning, и блок обязан жить
  // на одних этапах.
  const out = html({ stages: STAGES, streaming: true });
  assert.match(out, /Ищу в книге/);
  assert.match(out, /Нашёл 8 фрагментов/);
  assert.match(out, /Отвечаю/);
});

test("рассуждение свёрнуто, а не бежит по экрану", () => {
  // §5.8: показываем объяснимый статус, а не внутренний ход мыслей.
  const out = html({
    stages: STAGES,
    reasoning: "Пользователь спрашивает про импульс, в книге есть §5.2",
    streaming: true,
  });
  assert.match(out, /ход рассуждений/);
  assert.doesNotMatch(out, /Пользователь спрашивает/);
});

test("после ответа остаётся одна строка со сводкой", () => {
  const out = html({
    stages: [],
    streaming: false,
    durationMs: 3200,
    summary: "8 фрагментов",
  });
  assert.match(out, /Думал 3 секунды/);
  assert.match(out, /8 фрагментов/);
});

test("склонение секунд", () => {
  const one = html({ stages: [], streaming: false, durationMs: 1000 });
  const two = html({ stages: [], streaming: false, durationMs: 2400 });
  const five = html({ stages: [], streaming: false, durationMs: 5000 });
  assert.match(one, /Думал 1 секунду/);
  assert.match(two, /Думал 2 секунды/);
  assert.match(five, /Думал 5 секунд/);
});

test("без работы и без сводки блок не рисуется вовсе", () => {
  assert.equal(html({ stages: [], streaming: false }), "");
});

test("свёрнутая строка без рассуждения не кликается", () => {
  // Раскрывать нечего — кнопка не должна притворяться, что может.
  const out = html({ stages: [], streaming: false, durationMs: 2000 });
  assert.match(out, /disabled/);
});

test("этапы доски переводятся в строку заметки", () => {
  assert.deepEqual(boardStages("drawing"), [
    { key: "drawing", label: "Строю схему", done: false },
  ]);
});

test("неизвестная стадия доски не ломает заметку", () => {
  assert.equal(boardStages("что-то новое")[0].label, "Думаю");
  assert.equal(boardStages(null)[0].label, "Разбираю вопрос");
});

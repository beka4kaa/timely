import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import { MarkdownMessage } from "./markdown-message.tsx";

function html(content: string): string {
  return renderToStaticMarkup(createElement(MarkdownMessage, { content }));
}

test("жирный становится тегом, а не звёздочками", () => {
  // Ровно то, что видел ученик: `**«Hands-On Machine Learning»**` в тексте.
  const out = html("Мы занимаемся по книге **«Hands-On Machine Learning»**.");
  assert.match(out, /<strong[^>]*>«Hands-On Machine Learning»<\/strong>/);
  assert.doesNotMatch(out, /\*\*/);
});

test("списки и заголовки рендерятся", () => {
  const out = html("## Импульс\n\n- масса\n- скорость");
  assert.match(out, /<h4[^>]*>Импульс<\/h4>/);
  assert.equal(out.match(/<li/g)?.length, 2);
});

test("нумерованный список сохраняет тип", () => {
  assert.match(html("1. раз\n2. два"), /<ol/);
});

test("таблица прокручивается в своём контейнере", () => {
  // Панель узкая: без обёртки широкая таблица растянула бы всю ленту.
  const out = html("| a | b |\n| - | - |\n| 1 | 2 |");
  assert.match(out, /overflow-x-auto/);
  assert.match(out, /<table/);
});

test("инлайн-код и блок кода различаются", () => {
  assert.match(html("вот `p = mv` формула"), /<code class="rounded/);
  assert.match(html("```\np = mv\n```"), /<pre/);
});

test("формула рендерится через KaTeX", () => {
  // Книги по физике и ML полны формул; без этого ученик читает доллары.
  const out = html("Импульс: $p = mv$");
  assert.match(out, /katex/);
  assert.doesNotMatch(out, /\$p = mv\$/);
});

test("блочная формула тоже рендерится", () => {
  assert.match(html("$$\nE = mc^2\n$$"), /katex/);
});

test("одиночный перенос строки не склеивает строки", () => {
  // Регресс, который дал бы голый markdown вместо `whitespace-pre-wrap`:
  // модель часто разделяет строки одним переносом, и без remark-breaks они
  // слились бы в один абзац.
  assert.match(html("первая строка\nвторая строка"), /<br/);
});

test("HTML из ответа модели остаётся текстом", () => {
  // Главная проверка безопасности: `rehype-raw` не подключён и не должен быть.
  const out = html('<script>alert("xss")</script>');
  assert.doesNotMatch(out, /<script/);
  assert.match(out, /alert/);
});

test("картинка из ответа не превращается в запрос наружу", () => {
  // `<img>` с внешним адресом — это утечка факта прочтения и вектор трекинга.
  const out = html('<img src="https://evil.example/pixel.png">');
  assert.doesNotMatch(out, /<img/);
});

test("ссылка открывается безопасно", () => {
  const out = html("[книга](https://example.com)");
  assert.match(out, /rel="noopener noreferrer"/);
});

test("на странице шкала крупнее, чем в панели", () => {
  // Одна и та же разметка читается в 280 px и в колонке на пол-экрана: шкала
  // панели на странице выглядела бы мелким шрифтом договора.
  const rail = html("## Импульс");
  const page = renderToStaticMarkup(
    createElement(MarkdownMessage, { content: "## Импульс", variant: "page" }),
  );
  assert.match(rail, /text-\[13\.5px\]/);
  assert.match(page, /text-\[17px\]/);
});

test("пустой текст не роняет рендер", () => {
  assert.doesNotThrow(() => html(""));
});

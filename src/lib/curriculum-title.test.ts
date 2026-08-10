import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import { cleanDocumentTitle } from "./curriculum-title.ts";

test("настоящее имя файла из каталога становится читаемым", () => {
  assert.equal(
    cleanDocumentTitle("1741867504__-mehanika_-10-klass_-mjakishev-g_-ja_-2022"),
    "Mehanika 10 klass mjakishev g ja 2022",
  );
});

test("расширение отбрасывается", () => {
  assert.equal(cleanDocumentTitle("mehanika.pdf"), "Mehanika");
  assert.equal(cleanDocumentTitle("Сборник задач.epub"), "Сборник задач");
});

test("год внутри имени не путается с меткой времени", () => {
  // Метка времени срезается только В НАЧАЛЕ и только длинная: «2022» в конце
  // — часть названия, и терять её нельзя.
  assert.equal(cleanDocumentTitle("fizika 2022"), "Fizika 2022");
});

test("короткое число в начале остаётся частью названия", () => {
  assert.equal(cleanDocumentTitle("10 klass fizika"), "10 klass fizika");
});

test("кириллица не трогается", () => {
  assert.equal(
    cleanDocumentTitle("Мякишев_-_Механика_10_класс"),
    "Мякишев Механика 10 класс",
  );
});

test("имя из одной метки времени возвращается как есть", () => {
  // Пустая строка в каталоге хуже нечитаемой: по нечитаемой хотя бы видно, что
  // книги разные.
  assert.equal(cleanDocumentTitle("1741867504"), "1741867504");
});

test("пустой ввод остаётся пустым", () => {
  assert.equal(cleanDocumentTitle(""), "");
  assert.equal(cleanDocumentTitle("   "), "");
});

test("первая буква поднимается, остальные не трогаются", () => {
  // «klass» не превращается в «Klass»: это не заголовочный регистр, а всего
  // лишь начало строки.
  assert.equal(cleanDocumentTitle("mehanika 10 klass"), "Mehanika 10 klass");
});

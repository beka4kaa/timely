import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import { bookLabel, citationSpot } from "./book-label.ts";

test("метка файлообменника и подчёркивания уходят", () => {
  // Ровно то имя, что повторялось восемь раз в цитатах на скриншоте.
  assert.equal(
    bookLabel(
      "_OceanofPDF.com_Hands-On_Machine_Learning_with_Scikit-Learn_and_PyTorch_-_Aurelien_Geron",
    ),
    "Hands-On Machine Learning with Scikit-Learn and PyTorch - Aurelien Geron",
  );
});

test("числовой идентификатор загрузки убирается", () => {
  assert.equal(
    bookLabel("1741867504__-mehanika_-10-klass_-mjakishev-g_-ja_-2022"),
    "mehanika -10-klass -mjakishev-g -ja -2022",
  );
});

test("расширение файла убирается", () => {
  assert.equal(bookLabel("Механика.pdf"), "Механика");
  assert.equal(bookLabel("Механика.epub"), "Механика");
});

test("нормальное название не портится", () => {
  assert.equal(bookLabel("Механика, 10 класс"), "Механика, 10 класс");
  assert.equal(
    bookLabel("Hands-On Machine Learning"),
    "Hands-On Machine Learning",
  );
});

test("пустое название остаётся пустым", () => {
  assert.equal(bookLabel(""), "");
  assert.equal(bookLabel("   "), "");
});

test("название из одной служебной метки возвращается как есть", () => {
  // Показать пустоту хуже, чем показать некрасивое название.
  assert.equal(bookLabel("_OceanofPDF.com_"), "_OceanofPDF.com_");
});

test("место в книге собирается из раздела и страниц", () => {
  assert.equal(
    citationSpot({ section_path: "§ 5.2", page_start: 292, page_end: 292 }),
    "§ 5.2, стр. 292",
  );
  assert.equal(
    citationSpot({ section_path: "§ 5.2", page_start: 292, page_end: 295 }),
    "§ 5.2, стр. 292–295",
  );
});

test("у книги без страниц место — только раздел", () => {
  // EPUB: страниц нет, и «стр. 0» вела бы в никуда.
  assert.equal(
    citationSpot({ section_path: "§ 5.2", page_start: 0, page_end: 0 }),
    "§ 5.2",
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSpines, type SpreadCitation } from "./citation-spread";

function citation(
  page: number,
  pageEnd = page,
  id = "book",
  title = "Механика",
): SpreadCitation {
  return {
    document_id: id,
    document_title: title,
    page_start: page,
    page_end: pageEnd,
  };
}

test("одна страница ставит одну засечку в своём месте корешка", () => {
  const [spine] = buildSpines([{ citations: [citation(50)] }], { book: 100 });

  assert.equal(spine.marks.length, 1);
  assert.equal(spine.marks[0].page, 50);
  // Пятидесятая из ста — середина книги.
  assert.equal(spine.marks[0].at, 0.495);
  assert.equal(spine.citations, 1);
});

test("диапазон занимает на корешке свою ширину", () => {
  const [spine] = buildSpines([{ citations: [citation(1, 10)] }], { book: 100 });

  assert.equal(spine.marks[0].span, 0.1);
  assert.equal(spine.marks[0].at, 0.05);
});

test("соседние страницы слипаются в одну засечку", () => {
  // Восемь ссылок на 292–294 — это одно место в книге, а не восемь.
  const [spine] = buildSpines(
    [{ citations: [citation(292), citation(293), citation(294), citation(292)] }],
    { book: 500 },
  );

  assert.equal(spine.marks.length, 1);
  assert.deepEqual(
    [spine.marks[0].page, spine.marks[0].pageEnd],
    [292, 294],
  );
  assert.equal(spine.citations, 4);
});

test("далёкие страницы остаются разными засечками", () => {
  const [spine] = buildSpines(
    [{ citations: [citation(12), citation(300)] }],
    { book: 500 },
  );

  assert.deepEqual(
    spine.marks.map((mark) => mark.page),
    [12, 300],
  );
});

test("засечка помнит все реплики, где страница цитировалась", () => {
  const [spine] = buildSpines(
    [
      { citations: [citation(100)] },
      { citations: [] },
      { citations: [citation(101)] },
    ],
    { book: 400 },
  );

  assert.deepEqual(spine.marks[0].turns, [0, 2]);
});

test("страница больше объёма книги не выезжает за корешок", () => {
  // Книгу могли перезалить в другом издании: страниц в базе меньше, чем в
  // цитате. Засечка обязана остаться на корешке.
  const [spine] = buildSpines([{ citations: [citation(700)] }], { book: 500 });

  assert.ok(spine.marks[0].at <= 1);
  assert.equal(spine.scale, 700);
});

test("книга без известного объёма не делится на ноль", () => {
  // У EPUB `page_count` нулевой. Масштабом становится самая дальняя цитата.
  const [spine] = buildSpines([{ citations: [citation(30), citation(60)] }], {});

  assert.equal(spine.pageCount, 0);
  assert.equal(spine.scale, 60);
  for (const mark of spine.marks) {
    assert.ok(Number.isFinite(mark.at));
    assert.ok(mark.at >= 0 && mark.at <= 1);
  }
});

test("цитата без страниц считается, но засечки не получает", () => {
  const [spine] = buildSpines([{ citations: [citation(0)] }], { book: 100 });

  assert.equal(spine.citations, 1);
  assert.deepEqual(spine.marks, []);
});

test("книги идут в порядке первого появления", () => {
  const spines = buildSpines(
    [
      { citations: [citation(10, 10, "физика", "Механика")] },
      { citations: [citation(20, 20, "алгебра", "Алгебра")] },
      { citations: [citation(11, 11, "физика", "Механика")] },
    ],
    { физика: 300, алгебра: 200 },
  );

  assert.deepEqual(
    spines.map((spine) => spine.documentId),
    ["физика", "алгебра"],
  );
});

test("разговор без цитат не даёт ни одного корешка", () => {
  assert.deepEqual(buildSpines([{ citations: [] }, {}], { book: 100 }), []);
});

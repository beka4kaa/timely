import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import {
  MAX_LANES,
  type RibbonInput,
  type RibbonTopicInput,
  buildRibbon,
  coverageCaption,
  gapsCaption,
} from "./curriculum-ribbon.ts";

function topic(
  id: string,
  moduleIndex: number,
  sources: RibbonTopicInput["sources"],
): RibbonTopicInput {
  return { id, moduleIndex, sources };
}

function pages(from: number, to = from) {
  return { section_path: null, page_start: from, page_end: to };
}

// ─────────────────────── Ловушка `default=0` ─────────────────────────────────

test("ноль, null и undefined в страницах значат одно и то же", () => {
  const variants: RibbonInput[] = [
    { pageCount: 10, topics: [topic("t1", 0, [{ page_start: 0, page_end: 0 }])] },
    { pageCount: 10, topics: [topic("t1", 0, [{ page_start: null, page_end: null }])] },
    { pageCount: 10, topics: [topic("t1", 0, [{}])] },
  ];
  for (const input of variants) {
    const model = buildRibbon(input);
    assert.equal(model.segments.length, 0, "нулевая страница не создаёт отрезок");
    assert.deepEqual(model.unsourcedTopicIds, ["t1"]);
  }
});

test("нулевая страница не порождает фантомный отрезок в начале полосы", () => {
  const model = buildRibbon({
    pageCount: 100,
    topics: [topic("t1", 0, [pages(0, 0), pages(40, 42)])],
  });
  assert.equal(model.segments.length, 1);
  assert.equal(model.segments[0].startUnit, 40);
});

// ──────────────────────── Геометрия слотов ───────────────────────────────────

test("одна страница из двух занимает половину полосы, а не нулевую ширину", () => {
  const model = buildRibbon({ pageCount: 2, topics: [topic("t1", 0, [pages(1)])] });
  assert.equal(model.segments.length, 1);
  assert.equal(model.segments[0].startPct, 0);
  assert.equal(model.segments[0].widthPct, 50);
});

test("вторая страница из двух начинается с середины", () => {
  const model = buildRibbon({ pageCount: 2, topics: [topic("t1", 0, [pages(2)])] });
  assert.equal(model.segments[0].startPct, 50);
  assert.equal(model.segments[0].widthPct, 50);
});

test("отрезок включителен с обоих концов", () => {
  const model = buildRibbon({ pageCount: 10, topics: [topic("t1", 0, [pages(1, 10)])] });
  assert.equal(model.segments[0].widthPct, 100);
  assert.equal(model.claimedUnits, 10);
  assert.deepEqual(model.gaps, []);
});

test("перевёрнутый диапазон страниц разворачивается, а не теряется", () => {
  const model = buildRibbon({ pageCount: 20, topics: [topic("t1", 0, [pages(9, 4)])] });
  assert.equal(model.segments[0].startUnit, 4);
  assert.equal(model.segments[0].endUnit, 9);
});

test("одна заданная граница из двух даёт отрезок в одну страницу", () => {
  const model = buildRibbon({
    pageCount: 20,
    topics: [topic("t1", 0, [{ page_start: 0, page_end: 7 }])],
  });
  assert.equal(model.segments[0].startUnit, 7);
  assert.equal(model.segments[0].endUnit, 7);
});

// ───────────────────────────── Слияние ───────────────────────────────────────

test("два источника на одной странице сливаются в один отрезок", () => {
  const model = buildRibbon({
    pageCount: 50,
    topics: [topic("t1", 0, [pages(12), pages(12)])],
  });
  assert.equal(model.segments.length, 1);
});

test("соседние страницы одной темы сливаются", () => {
  const model = buildRibbon({
    pageCount: 50,
    topics: [topic("t1", 0, [pages(12, 14), pages(15, 16)])],
  });
  assert.equal(model.segments.length, 1);
  assert.equal(model.segments[0].endUnit, 16);
});

test("разрыв в две страницы не сливается", () => {
  const model = buildRibbon({
    pageCount: 50,
    topics: [topic("t1", 0, [pages(12), pages(15)])],
  });
  assert.equal(model.segments.length, 2);
});

test("две темы на одних и тех же страницах НЕ сливаются", () => {
  const model = buildRibbon({
    pageCount: 50,
    topics: [topic("t1", 0, [pages(10, 12)]), topic("t2", 0, [pages(10, 12)])],
  });
  assert.equal(model.segments.length, 2);
  assert.notEqual(model.segments[0].lane, model.segments[1].lane, "должны разъехаться");
  assert.equal(model.claimedUnits, 3, "покрытие считается по объединению");
});

// ──────────────────────────── Длина оси ──────────────────────────────────────

test("цитата за пределами page_count растит ось и поднимает флаг", () => {
  const model = buildRibbon({ pageCount: 10, topics: [topic("t1", 0, [pages(30, 32)])] });
  assert.equal(model.unitCount, 32);
  assert.equal(model.axisExtended, true);
  assert.equal(model.segments[0].endUnit, 32, "цитата не обрезана");
});

test("page_count = 0 при живых цитатах даёт ось по цитатам", () => {
  const model = buildRibbon({ pageCount: 0, topics: [topic("t1", 0, [pages(4, 6)])] });
  assert.equal(model.scale, "pages");
  assert.equal(model.unitCount, 6);
  assert.equal(model.claimedUnits, 3);
});

test("page_count больше цитат ось не растит", () => {
  const model = buildRibbon({ pageCount: 212, topics: [topic("t1", 0, [pages(30, 40)])] });
  assert.equal(model.unitCount, 212);
  assert.equal(model.axisExtended, false);
});

// ─────────────────────────── Пропуски ────────────────────────────────────────

test("непокрытые страницы попадают в gaps по краям и внутри", () => {
  const model = buildRibbon({
    pageCount: 10,
    topics: [topic("t1", 0, [pages(3, 4)]), topic("t2", 0, [pages(7, 8)])],
  });
  assert.equal(model.gaps.length, 3);
  assert.equal(model.claimedUnits, 4);
  assert.equal(model.totalUnits, 10);
});

// ─────────────────────────── Дорожки ─────────────────────────────────────────

test("непересекающиеся отрезки ложатся на одну дорожку", () => {
  const model = buildRibbon({
    pageCount: 100,
    topics: [topic("t1", 0, [pages(1, 5)]), topic("t2", 0, [pages(10, 15)])],
  });
  assert.deepEqual(
    model.segments.map((s) => s.lane),
    [0, 0],
  );
  assert.equal(model.laneCount, 1);
});

test("дорожек не больше трёх даже при пяти наложениях", () => {
  const model = buildRibbon({
    pageCount: 100,
    topics: ["a", "b", "c", "d", "e"].map((id) => topic(id, 0, [pages(1, 40)])),
  });
  assert.ok(model.laneCount <= MAX_LANES);
  assert.equal(model.segments.length, 5);
});

// ─────────────────────── Темы без источников ─────────────────────────────────

test("тема без источников не даёт отрезков и попадает в список", () => {
  const model = buildRibbon({
    pageCount: 20,
    topics: [topic("t1", 0, [pages(2, 3)]), topic("t2", 1, [])],
  });
  assert.deepEqual(model.unsourcedTopicIds, ["t2"]);
  assert.equal(model.segments.length, 1);
});

test("когда источников нет ни у кого и разделов нет — рисовать нечего", () => {
  const model = buildRibbon({ pageCount: 100, topics: [topic("t1", 0, [])] });
  assert.equal(model.unitCount, 0);
  assert.equal(model.segments.length, 0);
  assert.deepEqual(model.unsourcedTopicIds, ["t1"]);
});

// ───────────────────── Фолбэк на разделы (EPUB) ──────────────────────────────

test("без страниц ось строится по разделам", () => {
  const model = buildRibbon({
    pageCount: 0,
    topics: [
      topic("t1", 0, [{ section_path: "1.1" }]),
      topic("t2", 0, [{ section_path: "2" }]),
    ],
    sections: [
      { path: "1", order_index: 0 },
      { path: "1.1", order_index: 1 },
      { path: "2", order_index: 2 },
    ],
  });
  assert.equal(model.scale, "sections");
  assert.equal(model.unitCount, 3);
  assert.equal(model.claimedUnits, 2);
});

test("цитата на несуществующем подразделе уходит к ближайшему предку", () => {
  const model = buildRibbon({
    pageCount: 0,
    topics: [topic("t1", 0, [{ section_path: "1.2.3" }])],
    sections: [
      { path: "1", order_index: 0 },
      { path: "1.2", order_index: 1 },
    ],
  });
  assert.equal(model.segments.length, 1);
  assert.equal(model.segments[0].startUnit, 2, "слот раздела «1.2»");
});

test("страницы выигрывают у разделов, когда есть и то и другое", () => {
  const model = buildRibbon({
    pageCount: 40,
    topics: [topic("t1", 0, [{ section_path: "1.1", page_start: 5, page_end: 6 }])],
    sections: [{ path: "1.1", order_index: 0 }],
  });
  assert.equal(model.scale, "pages");
  assert.equal(model.unitCount, 40);
});

// ───────────────────── Устойчивость и подписи ────────────────────────────────

test("нигде не возникает NaN", () => {
  const model = buildRibbon({
    pageCount: Number.NaN,
    topics: [topic("t1", 0, [{ page_start: Number.NaN, page_end: 12 }])],
  });
  for (const segment of model.segments) {
    assert.ok(Number.isFinite(segment.startPct));
    assert.ok(Number.isFinite(segment.widthPct));
  }
  assert.ok(Number.isFinite(model.minWidthPct));
});

test("минимальная ширина не даёт отрезку стать невидимым", () => {
  const model = buildRibbon({ pageCount: 600, topics: [topic("t1", 0, [pages(300)])] });
  assert.ok(model.segments[0].widthPct < 1);
  assert.ok(model.minWidthPct >= 0.95);
});

test("две сборки на одном входе дают идентичный результат", () => {
  const input: RibbonInput = {
    pageCount: 212,
    topics: [
      topic("t3", 2, [pages(80, 92)]),
      topic("t1", 0, [pages(10, 20), pages(21, 24)]),
      topic("t2", 1, [pages(18, 30)]),
    ],
  };
  assert.deepEqual(buildRibbon(input), buildRibbon(input));
});

test("подпись покрытия обходится без процентов и без склонений", () => {
  const model = buildRibbon({
    pageCount: 212,
    topics: [topic("t1", 0, [pages(10, 43)])],
  });
  assert.equal(coverageCaption(model), "Страниц в программе: 34 из 212");
});

// ──────────────────── Пропуски: то, ради чего полоса и есть ──────────────────

test("пропуск помнит свои страницы, а не только проценты", () => {
  // По картинке номер страницы не списать — его называет подпись.
  const model = buildRibbon({
    pageCount: 100,
    topics: [topic("t1", 0, [pages(21, 80)])],
  });

  assert.deepEqual(
    model.gaps.map((gap) => [gap.startUnit, gap.endUnit]),
    [
      [1, 20],
      [81, 100],
    ],
  );
});

test("подпись пропусков называет участки словами", () => {
  const model = buildRibbon({
    pageCount: 100,
    topics: [topic("t1", 0, [pages(21, 80)])],
  });

  assert.equal(gapsCaption(model), "Не вошли: стр. 1–20, 81–100");
});

test("пропуск в одну страницу пишется одним числом", () => {
  const model = buildRibbon({
    pageCount: 10,
    topics: [topic("t1", 0, [pages(1, 4)]), topic("t2", 0, [pages(6, 10)])],
  });

  assert.equal(gapsCaption(model), "Не вошли: стр. 5");
});

test("длинный список пропусков сворачивается со склонением", () => {
  // Иначе подпись выходит длиннее самой полосы.
  const model = buildRibbon({
    pageCount: 20,
    topics: [
      topic("t1", 0, [pages(2), pages(4), pages(6), pages(8), pages(10)]),
    ],
  });

  assert.equal(
    gapsCaption(model),
    "Не вошли: стр. 1, 3, 5, 7 и ещё 2 участка",
  );
});

test("книга без пропусков не сообщает о пропусках", () => {
  const model = buildRibbon({
    pageCount: 10,
    topics: [topic("t1", 0, [pages(1, 10)])],
  });

  assert.deepEqual(model.gaps, []);
  assert.equal(gapsCaption(model), "");
});

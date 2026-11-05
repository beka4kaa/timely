import assert from "node:assert/strict";
import { test } from "node:test";

import { axisWarp, buildCoursePath, placeAxisLabels } from "./curriculum-path";

const TODAY = new Date("2026-08-11T00:00:00.000Z");

function unit(id: string, minutes: number, numberLabel?: string) {
  return { id, title: `Глава ${id}`, minutes, numberLabel };
}

/** Курс на четыре недели: ровно столько, чтобы линейка шла неделями. */
function fourWeeks(extra: Record<string, unknown> = {}) {
  return buildCoursePath({
    modules: [unit("a", 60), unit("b", 180)],
    today: TODAY,
    expectedFinish: "2026-09-08",
    ...extra,
  });
}

test("ширина главы — её часы, а не порядковый номер", () => {
  const path = fourWeeks();
  assert.ok(path);
  // Час против трёх: четверть оси против трёх четвертей.
  assert.equal(Math.round(path.blocks[0].widthPct), 25);
  assert.equal(Math.round(path.blocks[1].widthPct), 75);
  assert.equal(path.totalMinutes, 240);
});

test("без глав и с нулевым временем рисовать нечего", () => {
  assert.equal(buildCoursePath({ modules: [], today: TODAY }), null);
  assert.equal(
    buildCoursePath({ modules: [unit("a", 0)], today: TODAY }),
    null,
  );
});

test("одна глава занимает ось целиком", () => {
  const path = buildCoursePath({
    modules: [unit("a", 90)],
    today: TODAY,
    expectedFinish: "2026-09-08",
  });
  assert.ok(path);
  assert.equal(path.blocks.length, 1);
  assert.equal(Math.round(path.blocks[0].widthPct), 100);
});

test("без ожидаемой даты остаются пропорции, но не календарь", () => {
  const path = buildCoursePath({ modules: [unit("a", 60), unit("b", 60)], today: TODAY });
  assert.ok(path);
  assert.equal(path.dated, false);
  assert.equal(path.weeks, null);
  assert.deepEqual(path.ticks, []);
  assert.equal(path.blocks[0].startDate, null);
  assert.equal(Math.round(path.blocks[1].widthPct), 50);
});

test("дата в прошлом календаря не даёт", () => {
  // Иначе ось получила бы отрицательную длину и всё уехало бы за край.
  const path = fourWeeks({ expectedFinish: "2026-01-01" });
  assert.ok(path);
  assert.equal(path.dated, false);
});

// ─────────────────────────── Срок ────────────────────────────

test("срок раньше финиша даёт перелёт, и глава на нём разрезается", () => {
  const path = fourWeeks({ deadline: "2026-08-25" });
  assert.ok(path);

  assert.ok(path.deadline);
  assert.equal(path.coursePct, 100, "ось кончается финишем, срок внутри");
  assert.ok(path.overshootPct > 0);
  assert.equal(path.slackPct, 0);

  const cut = path.blocks.filter((block) => block.moduleId === "b");
  assert.equal(cut.length, 2, "глава, которую режет срок, даёт два куска");
  assert.equal(cut[0].beyondDeadline, false);
  assert.equal(cut[1].beyondDeadline, true);
  assert.notEqual(cut[0].key, cut[1].key);
});

test("срок позже финиша даёт запас, а не перелёт", () => {
  const path = fourWeeks({ deadline: "2026-10-01" });
  assert.ok(path);

  assert.equal(path.overshootPct, 0);
  assert.ok(path.slackPct > 0);
  assert.ok(path.coursePct < 100, "за финишем на оси остаётся место до срока");
  assert.equal(
    path.blocks.every((block) => !block.beyondDeadline),
    true,
  );
});

test("без срока нет ни отметки, ни перелёта", () => {
  const path = fourWeeks();
  assert.ok(path);
  assert.equal(path.deadline, null);
  assert.equal(path.overshootPct, 0);
  assert.equal(path.slackPct, 0);
});

// ─────────────────────────── Линейка ────────────────────────────

test("короткий курс размечается неделями", () => {
  const path = fourWeeks();
  assert.ok(path);
  assert.equal(path.ticks[0].label, "нед. 1");
  assert.equal(path.ticks[0].atPct, 0);
});

test("длинный курс размечается месяцами", () => {
  const path = fourWeeks({ expectedFinish: "2027-02-12" });
  assert.ok(path);
  assert.equal(path.ticks[0].label, "сен");
  assert.ok(path.ticks.every((tick) => tick.label.length === 3));
});

test("подписей на линейке не больше восьми", () => {
  const path = fourWeeks({ expectedFinish: "2031-08-11" });
  assert.ok(path);
  assert.ok(path.ticks.length <= 8, `${path.ticks.length} подписей`);
});

// ─────────────────────────── Вехи ────────────────────────────

test("веха стоит на конце своей главы", () => {
  const path = fourWeeks({
    milestones: [{ id: "m1", title: "Первая модель", moduleId: "a" }],
  });
  assert.ok(path);
  assert.equal(path.milestones.length, 1);
  assert.equal(Math.round(path.milestones[0].atPct), 25);
});

test("веха без главы и веха чужой главы не рисуются", () => {
  const path = fourWeeks({
    milestones: [
      { id: "m1", title: "Ничья", moduleId: null },
      { id: "m2", title: "Чужая", moduleId: "нет такой главы" },
    ],
  });
  assert.ok(path);
  assert.deepEqual(path.milestones, []);
});

test("веха разрезанной главы стоит на её настоящем конце", () => {
  const path = fourWeeks({
    deadline: "2026-08-25",
    milestones: [{ id: "m1", title: "Итог", moduleId: "b" }],
  });
  assert.ok(path);
  assert.equal(Math.round(path.milestones[0].atPct), 100);
});

test("подпись вехи берёт номер главы из книги", () => {
  const path = buildCoursePath({
    modules: [unit("a", 60, "Глава 5")],
    today: TODAY,
    expectedFinish: "2026-09-08",
    milestones: [{ id: "m1", title: "Первая модель", moduleId: "a" }],
  });
  assert.ok(path);
  assert.equal(path.milestones[0].moduleLabel, "Глава 5");
});

// ─────────────────────────── Даты блоков ────────────────────────────

test("границы блока приходят датами, а не только процентами", () => {
  const path = fourWeeks();
  assert.ok(path);
  assert.equal(path.blocks[0].startDate, "2026-08-11");
  assert.equal(path.blocks[1].endDate, "2026-09-08");
  assert.equal(path.weeks, 4);
});

test("начатый курс начинается с первого занятия, а сегодня стоит на оси", () => {
  const path = buildCoursePath({
    modules: [unit("a", 60), unit("b", 60)],
    today: TODAY,
    startedAt: "2026-07-28",
    expectedFinish: "2026-08-25",
  });
  assert.ok(path);
  // Две недели из четырёх уже прошло: глава шириной в половину, сегодня посередине.
  assert.equal(Math.round(path.blocks[0].widthPct), 50);
  assert.equal(Math.round(path.today?.atPct ?? -1), 50);
  assert.equal(path.today?.date, "2026-08-11");
});

test("курс ещё не начат: ось начинается сегодня, даже если расписание впереди", () => {
  const path = buildCoursePath({
    modules: [unit("a", 60)],
    today: TODAY,
    startedAt: "2026-09-01",
    expectedFinish: "2026-09-08",
  });
  assert.ok(path);
  assert.equal(path.today?.atPct, 0);
});

test("просроченный курс: ось дотягивается до сегодня, и за финишем остаётся пустое место", () => {
  const path = buildCoursePath({
    modules: [unit("a", 60)],
    today: TODAY,
    startedAt: "2026-07-01",
    expectedFinish: "2026-08-01",
  });
  assert.ok(path);
  assert.equal(path.dated, true);
  assert.equal(path.today?.atPct, 100);
  assert.ok(path.coursePct < 100);
});

test("без календаря отметки сегодня нет", () => {
  const path = buildCoursePath({ modules: [unit("a", 60)], today: TODAY });
  assert.ok(path);
  assert.equal(path.today, null);
});

test("подписи над осью: сегодня слева от точки, веха справа", () => {
  const labels = placeAxisLabels(
    [
      { key: "end", kind: "end", atPct: 100, text: "14 марта" },
      { key: "today", kind: "today", atPct: 26, text: "сегодня" },
      { key: "m", kind: "mile", atPct: 28, text: "СОР, 6 ноября" },
    ],
    900,
  );
  assert.deepEqual(
    labels.map((label) => [label.key, label.align]),
    [
      ["end", "end"],
      ["today", "end"],
      ["m", "start"],
    ],
  );
});

test("сегодня у левого края не вылезает за ось", () => {
  const [today] = placeAxisLabels([{ key: "today", kind: "today", atPct: 0, text: "сегодня" }], 330);
  assert.equal(today.align, "start");
});

test("подпись, которая наехала бы на важную, не печатается", () => {
  const labels = placeAxisLabels(
    [
      { key: "end", kind: "end", atPct: 100, text: "14 марта" },
      { key: "over", kind: "over", atPct: 98, text: "срок 10 марта" },
      { key: "m", kind: "mile", atPct: 99, text: "Контрольная" },
    ],
    330,
  );
  assert.deepEqual(labels.map((label) => label.key), ["end"]);
});

test("короткий запас рисуется как есть, длинный ужимается, а концы оси на месте", () => {
  const small = axisWarp(80, 30);
  assert.equal(small(40), 40);
  assert.equal(small(100), 100);

  const wide = axisWarp(25, 30);
  assert.equal(wide(0), 0);
  assert.equal(wide(25), 70);
  assert.equal(wide(12.5), 35);
  assert.equal(wide(100), 100);
  assert.ok(wide(60) > wide(25) && wide(60) < wide(100));
});

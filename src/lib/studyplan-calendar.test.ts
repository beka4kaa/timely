import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import {
  HOUR_HEIGHT,
  MIN_BLOCK_MINUTES,
  type CalendarBlock,
  currentTimeOffset,
  dropTarget,
  formatMinutes,
  hourMarks,
  layoutWeek,
  resizeTarget,
  shiftDateKey,
  snapMinutes,
  toInstant,
  visibleRange,
  weekDays,
  weekdayOf,
  zonedDateKey,
  zonedMinutes,
} from "./studyplan-calendar.ts";

const MOSCOW = "Europe/Moscow";
const NEW_YORK = "America/New_York";

function block(
  id: string,
  startAt: string,
  durationMinutes: number,
  extra: Partial<CalendarBlock> = {},
): CalendarBlock {
  return {
    id,
    title: `Блок ${id}`,
    start_at: startAt,
    end_at: new Date(
      new Date(startAt).getTime() + durationMinutes * 60_000,
    ).toISOString(),
    duration_minutes: durationMinutes,
    activity_type: "theory",
    status: "scheduled",
    fixed: false,
    detail_level: "detailed",
    source: "scheduler",
    topic: "t1",
    review_step: null,
    ...extra,
  };
}

// ───────────────────────────── Зоны ──────────────────────────────────────────

test("дата и минуты считаются в зоне расписания, а не браузера", () => {
  // 2026-08-17T14:00Z — это 17:00 в Москве.
  const instant = "2026-08-17T14:00:00Z";
  assert.equal(zonedDateKey(instant, MOSCOW), "2026-08-17");
  assert.equal(zonedMinutes(instant, MOSCOW), 17 * 60);
  assert.equal(zonedMinutes(instant, "UTC"), 14 * 60);
});

test("поздний вечер в одной зоне уже следующий день в другой", () => {
  const instant = "2026-08-17T22:30:00Z";
  assert.equal(zonedDateKey(instant, "UTC"), "2026-08-17");
  assert.equal(zonedDateKey(instant, MOSCOW), "2026-08-18");
});

test("полночь остаётся началом суток, а не их концом", () => {
  const instant = toInstant("2026-08-17", 0, MOSCOW);
  assert.equal(zonedMinutes(instant, MOSCOW), 0);
  assert.equal(zonedDateKey(instant, MOSCOW), "2026-08-17");
});

test("обратное преобразование возвращает то же стенное время", () => {
  for (const minutes of [0, 9 * 60 + 35, 17 * 60, 23 * 60 + 55]) {
    const instant = toInstant("2026-08-17", minutes, MOSCOW);
    assert.equal(zonedMinutes(instant, MOSCOW), minutes);
  }
});

test("стенное время переживает переход на летнее время", () => {
  // 8 марта 2026 в Нью-Йорке часы прыгают с 02:00 на 03:00.
  const before = toInstant("2026-03-07", 17 * 60, NEW_YORK);
  const after = toInstant("2026-03-09", 17 * 60, NEW_YORK);

  assert.equal(zonedMinutes(before, NEW_YORK), 17 * 60);
  assert.equal(zonedMinutes(after, NEW_YORK), 17 * 60);
  // А в UTC они обязаны РАЗЛИЧАТЬСЯ: иначе стенные часы поехали бы.
  assert.notEqual(before.getUTCHours(), after.getUTCHours());
});

test("несуществующее время перевода не роняет пересчёт", () => {
  const instant = toInstant("2026-03-08", 2 * 60 + 30, NEW_YORK);
  assert.ok(!Number.isNaN(instant.getTime()));
  // 02:30 не существует, поэтому стенные часы обязаны показать другое время.
  assert.notEqual(zonedMinutes(instant, NEW_YORK), 2 * 60 + 30);
});

// ─────────────────────────── Даты и недели ───────────────────────────────────

test("понедельник — нулевой день недели", () => {
  assert.equal(weekdayOf("2026-08-17"), 0);
  assert.equal(weekdayOf("2026-08-23"), 6);
});

test("неделя всегда начинается с понедельника", () => {
  const fromWednesday = weekDays("2026-08-19");
  assert.equal(fromWednesday.length, 7);
  assert.equal(fromWednesday[0], "2026-08-17");
  assert.equal(fromWednesday[6], "2026-08-23");
  assert.deepEqual(weekDays("2026-08-23"), fromWednesday);
});

test("сдвиг даты переживает границу месяца и года", () => {
  assert.equal(shiftDateKey("2026-08-31", 1), "2026-09-01");
  assert.equal(shiftDateKey("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftDateKey("2028-02-28", 1), "2028-02-29");
});

// ──────────────────────────────── Шкала ──────────────────────────────────────

test("пустая неделя показывает рабочий день, а не сутки целиком", () => {
  assert.deepEqual(visibleRange([], "UTC"), {
    startMinutes: 7 * 60,
    endMinutes: 22 * 60,
  });
});

test("рабочий день виден целиком, даже когда занятия только вечером", () => {
  // Раньше шкала сжималась до самих занятий, и утро исчезало с экрана: два
  // блока в пять вечера превращали неделю в узкую полоску без начала дня.
  const range = visibleRange(
    [block("a", "2026-08-17T17:00:00Z", 45), block("b", "2026-08-18T19:00:00Z", 60)],
    "UTC",
  );
  assert.equal(range.startMinutes, 7 * 60);
  assert.equal(range.endMinutes, 22 * 60);
});

test("занятия за пределами рабочего дня раздвигают шкалу", () => {
  const early = visibleRange([block("a", "2026-08-17T05:30:00Z", 30)], "UTC");
  assert.equal(early.startMinutes, 4 * 60);
  assert.equal(early.endMinutes, 22 * 60);

  const late = visibleRange([block("b", "2026-08-17T22:30:00Z", 60)], "UTC");
  assert.equal(late.startMinutes, 7 * 60);
  assert.equal(late.endMinutes, 24 * 60);
});

test("шкала не выходит за пределы суток", () => {
  const range = visibleRange([block("a", "2026-08-17T23:30:00Z", 30)], "UTC");
  assert.ok(range.startMinutes >= 0);
  assert.ok(range.endMinutes <= 24 * 60);
});

test("часовые метки попадают ровно на часы", () => {
  const marks = hourMarks({ startMinutes: 16 * 60, endMinutes: 19 * 60 });
  assert.deepEqual(marks, [16 * 60, 17 * 60, 18 * 60, 19 * 60]);
});

test("время печатается двузначным", () => {
  assert.equal(formatMinutes(9 * 60 + 5), "09:05");
  assert.equal(formatMinutes(17 * 60), "17:00");
  assert.equal(formatMinutes(0), "00:00");
});

// ─────────────────────────────── Раскладка ───────────────────────────────────

const WEEK = weekDays("2026-08-17");

test("блоки раскладываются по своим дням", () => {
  const columns = layoutWeek(
    [block("a", "2026-08-17T17:00:00Z", 45), block("b", "2026-08-19T17:00:00Z", 45)],
    { timeZone: "UTC", days: WEEK, range: visibleRange([], "UTC") },
  );
  assert.equal(columns.length, 7);
  assert.equal(columns[0].blocks.length, 1);
  assert.equal(columns[1].blocks.length, 0);
  assert.equal(columns[2].blocks.length, 1);
});

test("высота блока пропорциональна его длительности", () => {
  const range = { startMinutes: 16 * 60, endMinutes: 20 * 60 };
  const [monday] = layoutWeek([block("a", "2026-08-17T17:00:00Z", 60)], {
    timeZone: "UTC",
    days: WEEK,
    range,
  });
  assert.equal(monday.blocks[0].height, HOUR_HEIGHT);
  assert.equal(monday.blocks[0].top, HOUR_HEIGHT);
});

test("короткий блок не схлопывается в невидимую полоску", () => {
  const range = { startMinutes: 16 * 60, endMinutes: 20 * 60 };
  const [monday] = layoutWeek([block("a", "2026-08-17T17:00:00Z", 5)], {
    timeZone: "UTC",
    days: WEEK,
    range,
  });
  assert.equal(monday.blocks[0].height, (MIN_BLOCK_MINUTES / 60) * HOUR_HEIGHT);
});

test("непересекающиеся блоки занимают всю ширину", () => {
  const [monday] = layoutWeek(
    [block("a", "2026-08-17T17:00:00Z", 45), block("b", "2026-08-17T18:00:00Z", 45)],
    { timeZone: "UTC", days: WEEK, range: visibleRange([], "UTC") },
  );
  assert.deepEqual(
    monday.blocks.map((item) => [item.lane, item.lanes]),
    [
      [0, 1],
      [0, 1],
    ],
  );
});

test("пересекающиеся блоки расходятся по дорожкам", () => {
  const [monday] = layoutWeek(
    [block("a", "2026-08-17T17:00:00Z", 60), block("b", "2026-08-17T17:30:00Z", 60)],
    { timeZone: "UTC", days: WEEK, range: visibleRange([], "UTC") },
  );
  assert.equal(monday.blocks.length, 2);
  assert.deepEqual(monday.blocks.map((item) => item.lane).sort(), [0, 1]);
  assert.ok(monday.blocks.every((item) => item.lanes === 2));
});

test("раскладка не зависит от порядка входных блоков", () => {
  const first = block("a", "2026-08-17T18:00:00Z", 45);
  const second = block("b", "2026-08-17T17:00:00Z", 45);
  const options = { timeZone: "UTC", days: WEEK, range: visibleRange([], "UTC") };

  const forward = layoutWeek([first, second], options)[0].blocks.map((i) => i.block.id);
  const backward = layoutWeek([second, first], options)[0].blocks.map((i) => i.block.id);
  assert.deepEqual(forward, backward);
  assert.deepEqual(forward, ["b", "a"]);
});

test("блоки вне показанной недели отбрасываются", () => {
  const columns = layoutWeek([block("a", "2026-09-01T17:00:00Z", 45)], {
    timeZone: "UTC",
    days: WEEK,
    range: visibleRange([], "UTC"),
  });
  assert.equal(columns.reduce((sum, day) => sum + day.blocks.length, 0), 0);
});

// ──────────────────────────── Метка «сейчас» ─────────────────────────────────

test("метка показывается только в текущем дне и внутри шкалы", () => {
  const options = {
    timeZone: "UTC",
    days: WEEK,
    range: { startMinutes: 16 * 60, endMinutes: 20 * 60 },
  };
  const inside = currentTimeOffset(new Date("2026-08-17T17:00:00Z"), options);
  assert.deepEqual(inside, { dateKey: "2026-08-17", offset: HOUR_HEIGHT });

  assert.equal(currentTimeOffset(new Date("2026-08-17T06:00:00Z"), options), null);
  assert.equal(currentTimeOffset(new Date("2026-09-01T17:00:00Z"), options), null);
});

// ─────────────────────── Перетаскивание и растягивание ───────────────────────

test("перетаскивание притягивается к шагу сетки", () => {
  assert.equal(snapMinutes(17 * 60 + 3), 17 * 60 + 5);
  assert.equal(snapMinutes(17 * 60 + 1), 17 * 60);
});

test("перетаскивание даёт момент времени в зоне расписания", () => {
  const range = { startMinutes: 16 * 60, endMinutes: 20 * 60 };
  const target = dropTarget({
    dateKey: "2026-08-18",
    offset: HOUR_HEIGHT,
    range,
    timeZone: MOSCOW,
    durationMinutes: 45,
  });
  assert.equal(target.startMinutes, 17 * 60);
  assert.equal(zonedMinutes(target.startAt, MOSCOW), 17 * 60);
  assert.equal(zonedDateKey(target.startAt, MOSCOW), "2026-08-18");
});

test("блок не выталкивается за пределы суток", () => {
  const range = { startMinutes: 0, endMinutes: 24 * 60 };
  const target = dropTarget({
    dateKey: "2026-08-18",
    offset: (23.9 * 60 * HOUR_HEIGHT) / 60,
    range,
    timeZone: "UTC",
    durationMinutes: 60,
  });
  assert.ok(target.startMinutes + 60 <= 24 * 60);
});

test("растягивание не делает занятие короче минимального", () => {
  const range = { startMinutes: 16 * 60, endMinutes: 20 * 60 };
  const minutes = resizeTarget({
    startMinutes: 17 * 60,
    offsetBottom: minutesToOffsetForTest(17 * 60 + 3, range.startMinutes),
    range,
  });
  assert.equal(minutes, MIN_BLOCK_MINUTES);
});

test("растягивание округляет длительность к шагу сетки", () => {
  const range = { startMinutes: 16 * 60, endMinutes: 20 * 60 };
  const minutes = resizeTarget({
    startMinutes: 17 * 60,
    offsetBottom: minutesToOffsetForTest(17 * 60 + 47, range.startMinutes),
    range,
  });
  assert.equal(minutes, 45);
});

function minutesToOffsetForTest(minutes: number, rangeStart: number): number {
  return ((minutes - rangeStart) / 60) * HOUR_HEIGHT;
}

import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts.
import {
  activityLabel,
  blockAppearance,
  blockTone,
  dayLabel,
  durationLabel,
  weekLabel,
  weekdayShort,
} from "./studyplan-visuals.ts";

const MECHANICS = "#8a5b24";
const ALGEBRA = "#4f6d5a";

function block(
  overrides: Partial<Parameters<typeof blockAppearance>[0]> = {},
  options: Partial<Parameters<typeof blockAppearance>[1]> = {},
) {
  return blockAppearance(
    {
      activity_type: "theory",
      status: "scheduled",
      fixed: false,
      review_step: null,
      ...overrides,
    },
    { accent: MECHANICS, ...options },
  );
}

/** Доля примеси акцента из `color-mix(in srgb, <accent> N%, <бумага>)`. */
function mixPercent(color: string): number {
  return Number(color.match(/ (\d+)%/)?.[1] ?? 0);
}

test("тип занятия получает человеческую подпись", () => {
  assert.equal(activityLabel("independent_practice"), "Практика");
  assert.equal(activityLabel("assessment"), "Проверка");
});

test("незнакомый тип печатается как есть, а не пропадает", () => {
  assert.equal(activityLabel("telepathy"), "telepathy");
});

test("тяжёлое занятие плотнее лёгкого", () => {
  const light = blockTone(MECHANICS, "theory");
  const heavy = blockTone(MECHANICS, "assessment");
  assert.ok(mixPercent(heavy.background) > mixPercent(light.background));
});

test("цвет кодирует курс: разные предметы различимы", () => {
  // Прежняя палитра была принципиально одноцветной, и вся неделя выходила
  // одинаково бежевой — по цвету нельзя было отличить физику от алгебры.
  const mechanics = blockTone(MECHANICS, "theory");
  const algebra = blockTone(ALGEBRA, "theory");
  assert.notEqual(mechanics.background, algebra.background);
  assert.ok(mechanics.background.includes(MECHANICS));
  assert.ok(algebra.background.includes(ALGEBRA));
});

test("заливка остаётся бледной: неделя не превращается в витраж", () => {
  for (const type of ["theory", "assessment", "review", "project"]) {
    const mix = mixPercent(blockTone(MECHANICS, type).background);
    assert.ok(mix >= 15 && mix <= 30, `${type}: ${mix}%`);
  }
});

test("занятое время не берёт цвет курса", () => {
  // Школа и репетитор — не учебная нагрузка ученика, а чужое время.
  const school = block({ fixed: true }, { occupied: true });
  assert.ok(!school.background.includes(MECHANICS));
  assert.equal(school.hatched, true);
  assert.equal(block().hatched, false);
});

test("состояние и тип кодируются разными средствами", () => {
  const scheduled = block({ activity_type: "assessment", status: "scheduled" });
  const completed = block({ activity_type: "assessment", status: "completed" });
  // Заливка одна и та же — различает не она, а приглушённость.
  assert.equal(scheduled.background, completed.background);
  assert.equal(scheduled.faded, false);
  assert.equal(completed.faded, true);
});

test("повторение рисуется пунктиром и не выдаёт себя за новую тему", () => {
  assert.equal(block({ activity_type: "review" }).dashed, true);
  assert.equal(block({ activity_type: "theory", review_step: 0 }).dashed, true);
  assert.equal(block({ activity_type: "theory" }).dashed, false);
});

test("закреплённое занятие отличимо, но не теряет свой предмет", () => {
  const fixed = block({ activity_type: "theory", fixed: true });
  const loose = block({ activity_type: "theory", fixed: false });
  assert.equal(fixed.pinned, true);
  assert.equal(loose.pinned, false);
  // Раньше закрепление подменяло акцент серым, и блок переставал отвечать на
  // вопрос «это какой предмет». Цвет курса теперь остаётся.
  assert.equal(fixed.accent, loose.accent);
});

test("пропуск и текущее занятие получают рамку, обычное — нет", () => {
  assert.equal(block({ status: "scheduled" }).ring, null);
  assert.ok(block({ status: "missed" }).ring);
  assert.ok(block({ status: "in_progress" }).ring);
});

test("зачёркнуто только отменённое: пропуск ещё можно нагнать", () => {
  assert.equal(block({ status: "cancelled" }).struck, true);
  assert.equal(block({ status: "missed" }).struck, false);
});

test("состояние по умолчанию не подписывается", () => {
  assert.equal(block({ status: "scheduled" }).statusLabel, null);
  assert.equal(block({ status: "missed" }).statusLabel, "Пропущено");
});

test("длительность печатается по-человечески", () => {
  assert.equal(durationLabel(45), "45 мин");
  assert.equal(durationLabel(60), "1 ч");
  assert.equal(durationLabel(90), "1 ч 30 мин");
  assert.equal(durationLabel(0), "0 мин");
});

test("дни недели начинаются с понедельника", () => {
  assert.equal(weekdayShort(0), "Пн");
  assert.equal(weekdayShort(6), "Вс");
});

test("дата дня печатается в родительном падеже", () => {
  assert.equal(dayLabel("2026-08-18"), "18 августа");
  assert.equal(dayLabel("2026-01-01"), "1 января");
});

test("неделя внутри месяца печатается одним диапазоном", () => {
  const days = [
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
    "2026-08-23",
  ];
  assert.equal(weekLabel(days), "17–23 августа");
});

test("неделя через месяц печатается двумя датами", () => {
  const days = [
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
  ];
  assert.equal(weekLabel(days), "31 августа — 6 сентября");
});

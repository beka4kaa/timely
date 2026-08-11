import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts.
import {
  activityLabel,
  activityTone,
  blockAppearance,
  dayLabel,
  durationLabel,
  weekLabel,
  weekdayShort,
} from "./studyplan-visuals.ts";

function block(overrides: Partial<Parameters<typeof blockAppearance>[0]> = {}) {
  return blockAppearance({
    activity_type: "theory",
    status: "scheduled",
    fixed: false,
    review_step: null,
    ...overrides,
  });
}

test("тип занятия получает человеческую подпись", () => {
  assert.equal(activityLabel("independent_practice"), "Практика");
  assert.equal(activityLabel("assessment"), "Проверка");
});

test("незнакомый тип печатается как есть, а не пропадает", () => {
  assert.equal(activityLabel("telepathy"), "telepathy");
});

test("тяжёлое занятие темнее лёгкого", () => {
  const light = activityTone("theory");
  const heavy = activityTone("assessment");
  const lightness = (color: string) => Number(color.match(/(\d+)%\)$/)?.[1] ?? 0);
  assert.ok(lightness(heavy.background) < lightness(light.background));
});

test("палитра одноцветная: тон не меняет оттенок", () => {
  for (const type of ["theory", "assessment", "review", "project"]) {
    assert.match(activityTone(type).background, /^hsl\(32 /);
  }
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

test("закреплённый блок держит свой акцент независимо от типа", () => {
  const fixed = block({ activity_type: "theory", fixed: true });
  const loose = block({ activity_type: "theory", fixed: false });
  assert.notEqual(fixed.accent, loose.accent);
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

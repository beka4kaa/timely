import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts: без него нативный разбор в node не
// находит модуль и тест молча не запускается.
import {
  RAIL_MIN_PX,
  clampRailWidth,
  defaultRailWidth,
  railBounds,
  railShareLabel,
  restoreRailWidth,
} from "./rail-width.ts";

test("узкая панель подтягивается до минимума", () => {
  assert.equal(clampRailWidth(100, 1600), RAIL_MIN_PX);
});

test("широкая панель обрезается половиной экрана", () => {
  assert.equal(clampRailWidth(1400, 1600), 800);
});

test("по умолчанию компактная панель, а не доля экрана", () => {
  // Раньше это была четверть экрана, и на широком мониторе панель забирала
  // 400+ px, начиная спорить с календарём за главную роль.
  assert.equal(defaultRailWidth(1600), 320);
  assert.equal(defaultRailWidth(2560), 320);
});

test("на узком окне дефолт всё равно зажимается половиной", () => {
  assert.equal(defaultRailWidth(600), 300);
});

test("сохранённое с монитора значение зажимается на ноутбуке", () => {
  // Иначе от страницы осталась бы полоса: 900 из 1280 — это больше половины.
  assert.equal(restoreRailWidth("900", 1280), 640);
});

test("сохранённое значение в границах берётся как есть", () => {
  assert.equal(restoreRailWidth("420", 1600), 420);
});

test("испорченное сохранённое значение даёт умолчание", () => {
  assert.equal(restoreRailWidth("не число", 1600), 320);
  assert.equal(restoreRailWidth(null, 1600), 320);
  assert.equal(restoreRailWidth("-50", 1600), 320);
});

test("на узком окне минимум уступает половине", () => {
  // Отдать панели 280 px из 500 значило бы оставить странице меньше, чем ей.
  const { min, max } = railBounds(500);
  assert.equal(max, 250);
  assert.equal(min, 250);
  assert.equal(clampRailWidth(280, 500), 250);
});

test("нечисло не роняет расчёт", () => {
  assert.equal(clampRailWidth(Number.NaN, 1600), 320);
});

test("подпись показывает долю экрана", () => {
  assert.equal(railShareLabel(400, 1600), "25 %");
  assert.equal(railShareLabel(533, 1600), "33 %");
});

test("подпись без экрана пуста", () => {
  assert.equal(railShareLabel(400, 0), "");
});

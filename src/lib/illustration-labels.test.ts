import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/components/board/chat-session-restore.logic.test.ts.
import {
  MAX_LEADER_DISTANCE_PCT,
  layoutIllustrationLabels,
  shouldShowLeaderLine,
} from "./illustration-contrast.ts";

/**
 * Раскладка подписей: до этих тестов модуль был покрыт нулём, хотя именно он
 * решает, где окажется текст. Проверяем ГЕОМЕТРИЧЕСКИЙ инвариант (data = null,
 * без ImageData) — он действует всегда, независимо от картинки.
 *
 * Регрессия, ради которой они написаны: подпись улетала к противоположному
 * краю кадра, потому что выбор был лексикографическим (любой чистый фон
 * побеждал близкое место), а штрафа за пересечение кадра на фронте не было.
 */

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

test("выноска никогда не тянется через весь кадр", () => {
  // Якорь у левого края: раньше «чистое» место у правого края побеждало и
  // давало линию через всю картинку.
  const [placement] = layoutIllustrationLabels(null, [
    { x: 50, y: 50, content: "Груз", arrow_to: { x: 18, y: 62 } },
  ]);

  assert.ok(
    dist(placement, { x: 18, y: 62 }) <= MAX_LEADER_DISTANCE_PCT,
    `подпись уехала на ${dist(placement, { x: 18, y: 62 }).toFixed(1)}% от якоря`,
  );
});

test("подпись не уходит на противоположную половину кадра", () => {
  const anchor = { x: 20, y: 50 };
  const [placement] = layoutIllustrationLabels(null, [
    { x: 20, y: 40, content: "Блок", arrow_to: anchor },
  ]);

  // Якорь слева от середины — центр подписи не должен оказаться справа.
  assert.ok(
    placement.x < 50,
    `подпись пересекла середину кадра: x=${placement.x}`,
  );
});

test("валидная позиция бэкенда сохраняется", () => {
  // label_layout.py уже нашёл тихую зону и прислал x/y. Фронтенд обязан её
  // уважать, а не искать своё место с нуля.
  const anchor = { x: 60, y: 55 };
  const backend = { x: 60, y: 42 };
  const [placement] = layoutIllustrationLabels(null, [
    { ...backend, content: "Блок", arrow_to: anchor },
  ]);

  assert.ok(
    dist(placement, backend) < 6,
    `позиция бэкенда проигнорирована: получили ${placement.x},${placement.y}`,
  );
});

test("подписи не накрывают друг друга", () => {
  const placements = layoutIllustrationLabels(null, [
    { x: 40, y: 30, content: "mg", arrow_to: { x: 42, y: 46 } },
    { x: 46, y: 30, content: "T", arrow_to: { x: 48, y: 44 } },
    { x: 52, y: 30, content: "Груз", arrow_to: { x: 50, y: 62 } },
  ]);

  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      const overlapX = Math.abs(a.x - b.x) < (a.width + b.width) / 2;
      const overlapY = Math.abs(a.y - b.y) < (a.height + b.height) / 2;
      assert.ok(!(overlapX && overlapY), `подписи ${i} и ${j} пересекаются`);
    }
  }
});

test("каждая подпись остаётся внутри кадра", () => {
  const placements = layoutIllustrationLabels(null, [
    { x: 50, y: 50, content: "Нормальная реакция N", arrow_to: { x: 8, y: 8 } },
    { x: 50, y: 50, content: "Сила тяжести mg", arrow_to: { x: 94, y: 92 } },
  ]);

  for (const p of placements) {
    assert.ok(p.x - p.width / 2 >= -0.01, `подпись вышла за левый край: ${p.x}`);
    assert.ok(p.x + p.width / 2 <= 100.01, `подпись вышла за правый край: ${p.x}`);
    assert.ok(p.y >= 0 && p.y <= 100, `подпись вышла по вертикали: ${p.y}`);
  }
});

test("раскладка детерминирована", () => {
  const labels = [
    { x: 30, y: 30, content: "mg", arrow_to: { x: 40, y: 55 } },
    { x: 70, y: 30, content: "T", arrow_to: { x: 62, y: 40 } },
  ];
  const first = JSON.stringify(layoutIllustrationLabels(null, labels));
  for (let i = 0; i < 4; i += 1) {
    assert.equal(JSON.stringify(layoutIllustrationLabels(null, labels)), first);
  }
});

// ── Видимость выноски: единое правило для обоих рендереров ──────────────────

test("у близкой подписи выноски нет", () => {
  const near = { x: 50, y: 44, connector: { start: { x: 50, y: 47 }, end: { x: 50, y: 50 } } };
  assert.equal(shouldShowLeaderLine(near, { x: 50, y: 50 }), false);
});

test("у далёкой подписи выноска есть", () => {
  const far = { x: 20, y: 20, connector: { start: { x: 24, y: 24 }, end: { x: 50, y: 50 } } };
  assert.equal(shouldShowLeaderLine(far, { x: 50, y: 50 }), true);
});

test("вручную перемещённая подпись всегда сохраняет выноску", () => {
  // Иначе после перетаскивания рядом с объектом связь пропадала бы, хотя
  // пользователь двигал подпись осознанно.
  const near = { x: 50, y: 45, connector: { start: { x: 50, y: 47 }, end: { x: 50, y: 50 } } };
  assert.equal(shouldShowLeaderLine(near, { x: 50, y: 50 }, true), true);
});

test("без connector выноска не рисуется никогда", () => {
  const noConnector = { x: 10, y: 10, connector: null };
  assert.equal(shouldShowLeaderLine(noConnector, { x: 50, y: 50 }, true), false);
});

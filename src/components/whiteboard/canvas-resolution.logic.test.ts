import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. chat-session-restore.logic.test.ts.
import {
  canvasPixelRatio,
  MAX_CANVAS_PIXELS,
  MAX_PIXEL_RATIO,
} from "./utils.ts";

/** Типичный телефон: 390×740 CSS, плотность 3. */
const phone = { cssWidth: 390, cssHeight: 740, density: 3 };
/** Типичный ноутбук: 1440×900 CSS, плотность 2. */
const laptop = { cssWidth: 1440, cssHeight: 900, density: 2 };

test("регрессия: на плотном экране буфер больше CSS-размера", () => {
  // Раньше буфер задавался как `canvas.width = window.innerWidth`, то есть
  // ratio всегда был 1 — каждый пиксель штриха растягивался втрое, и доска на
  // телефоне выглядела «в пикселях».
  assert.equal(canvasPixelRatio(phone), 3);
});

test("на экране без ретины ничего не раздувается", () => {
  assert.equal(canvasPixelRatio({ ...laptop, density: 1 }), 1);
});

test("ноутбук с ретиной рисует вдвое плотнее", () => {
  assert.equal(canvasPixelRatio(laptop), 2);
});

test("пинч-зум браузера повышает плотность отрисовки", () => {
  // Пинч-зум сам по себе перерисовку не вызывает: без учёта масштаба доска
  // «в приближении» осталась бы мыльной.
  assert.ok(canvasPixelRatio({ ...laptop, density: 1, pageScale: 2 }) > 1);
});

test("множитель ограничен сверху", () => {
  const ratio = canvasPixelRatio({ ...phone, density: 3, pageScale: 4 });
  assert.ok(ratio <= MAX_PIXEL_RATIO);
});

test("большой холст с ретиной укладывается в бюджет пикселей", () => {
  // 5K-монитор: 2560×1440 CSS при плотности 2 дало бы буфер на 14.7 Мп, и
  // множитель обязан просесть ниже двух, чтобы влезть в бюджет.
  const cssWidth = 2560;
  const cssHeight = 1440;
  const ratio = canvasPixelRatio({ cssWidth, cssHeight, density: 2 });
  const pixels = cssWidth * ratio * cssHeight * ratio;

  assert.ok(ratio < 2, `множитель ${ratio}`);
  assert.ok(pixels <= MAX_CANVAS_PIXELS * 1.01, `буфер ${Math.round(pixels)} px`);
});

test("множитель никогда не опускается ниже единицы", () => {
  // Инвариант сильнее бюджета: опустить множитель ниже 1 значило бы рисовать
  // ХУЖЕ, чем до правки. На холсте, который сам по себе больше бюджета, мы
  // просто не раздуваем буфер — но и не сжимаем его.
  const cssWidth = 20000;
  const cssHeight = 20000;
  const ratio = canvasPixelRatio({ cssWidth, cssHeight, density: 2 });

  assert.equal(ratio, 1);
  assert.ok(cssWidth * cssHeight > MAX_CANVAS_PIXELS);
});

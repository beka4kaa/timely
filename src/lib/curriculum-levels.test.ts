import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts.
import {
  LEVEL_ORDER,
  clampLevelPair,
  fractionForLevel,
  levelAt,
  levelFromFraction,
  levelIndex,
  levelSpan,
  spanAnnouncement,
  spanCaption,
} from "./curriculum-levels.ts";

test("шкала — шесть ступеней в порядке возрастания", () => {
  assert.equal(LEVEL_ORDER.length, 6);
  assert.equal(LEVEL_ORDER[0], "none");
  assert.equal(LEVEL_ORDER[5], "university");
});

test("неизвестный уровень не роняет разбор", () => {
  assert.equal(levelIndex("что-то ещё"), 0);
  assert.equal(levelIndex(null), 0);
});

test("валидная пара проходит без изменений", () => {
  const pair = { current: "beginner", target: "advanced" } as const;
  assert.deepEqual(clampLevelPair(pair, "current"), pair);
  assert.deepEqual(clampLevelPair(pair, "target"), pair);
});

test("поднятое «сейчас» толкает цель вверх, а само остаётся на месте", () => {
  const result = clampLevelPair(
    { current: "university", target: "beginner" },
    "current",
  );
  assert.equal(result.current, "university", "маркер под пальцем не смещается");
  assert.equal(result.target, "university");
});

test("опущенная цель тянет «сейчас» вниз, а сама остаётся на месте", () => {
  const result = clampLevelPair({ current: "advanced", target: "none" }, "target");
  assert.equal(result.target, "none", "маркер под пальцем не смещается");
  assert.equal(result.current, "none");
});

test("равные уровни разрешены: это программа на закрепление", () => {
  const pair = { current: "advanced", target: "advanced" } as const;
  assert.deepEqual(clampLevelPair(pair, "current"), pair);
  assert.equal(levelSpan(pair), 0);
  assert.match(spanCaption(pair), /закреплен/i);
});

test("выход за края шкалы прижимается к краям", () => {
  assert.equal(levelAt(-3), "none");
  assert.equal(levelAt(99), "university");
});

test("доля переводится в ступень округлением", () => {
  assert.equal(levelFromFraction(0), "none");
  assert.equal(levelFromFraction(1), "university");
  assert.equal(levelFromFraction(0.5), LEVEL_ORDER[3]);
  assert.equal(levelFromFraction(Number.NaN), "none");
  assert.equal(levelFromFraction(-5), "none");
});

test("позиция ступени и обратный перевод сходятся", () => {
  for (const level of LEVEL_ORDER) {
    assert.equal(levelFromFraction(fractionForLevel(level)), level);
  }
});

test("объявление называет пролёт целиком, а не одно значение", () => {
  const text = spanAnnouncement({ current: "beginner", target: "advanced" });
  assert.match(text, /Начальный/);
  assert.match(text, /Продвинутый/);
  assert.match(text, /3 ступени/);
});

test("склонение ступеней не превращается в «1 ступеней»", () => {
  assert.match(spanAnnouncement({ current: "advanced", target: "university" }), /1 ступень/);
  assert.match(spanAnnouncement({ current: "none", target: "advanced" }), /4 ступени/);
  assert.match(spanAnnouncement({ current: "none", target: "university" }), /5 ступеней/);
});

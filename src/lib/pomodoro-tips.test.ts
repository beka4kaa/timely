import assert from "node:assert/strict";
import { test } from "node:test";

import { TIPS, nextTip, quoted, tipsFor } from "./pomodoro-tips";

test("a hundred tips, half about rest, all different and short enough for one line", () => {
  assert.equal(TIPS.length, 100);
  assert.equal(tipsFor("rest").length, 50);
  assert.equal(tipsFor("focus").length, 50);
  assert.equal(new Set(TIPS.map((tip) => tip.text)).size, 100);
  for (const tip of TIPS) assert.ok(tip.text.length <= 72, tip.text);
});

test("a tip is shown as a quote in guillemets, without the final full stop", () => {
  assert.equal(quoted("Сделано лучше, чем идеально."), "«Сделано лучше, чем идеально»");
  assert.equal(quoted("Не нужно хотеть. Достаточно начать."), "«Не нужно хотеть. Достаточно начать»");
  assert.equal(quoted("Устали глаза? Поморгай"), "«Устали глаза? Поморгай»");
});

test("the next tip fits the phase and never repeats the one on screen", () => {
  for (let step = 0; step < 200; step += 1) {
    const current = nextTip(null, "rest");
    const next = nextTip(current, "rest");
    assert.notEqual(next, current);
    assert.equal(TIPS[next].kind, "rest");
  }
  assert.equal(TIPS[nextTip(null, "focus", () => 0)].kind, "focus");
  assert.equal(nextTip(0, "any", () => 0), 1);
});

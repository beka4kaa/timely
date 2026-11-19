import assert from "node:assert/strict";
import { test } from "node:test";

import { ASK_LEVELS, askChoice, choiceOf, gaugeAngle, levelOf } from "./ask-level.ts";

test("три положения: Instant, Medium, High", () => {
  assert.deepEqual(
    ASK_LEVELS.map((level) => level.name),
    ["Instant", "Medium", "High"],
  );
});

test("положение переводится в модель и рассуждение", () => {
  assert.deepEqual(choiceOf("instant"), { model: "fast", reasoning: "low" });
  assert.deepEqual(choiceOf("medium"), { model: "smart", reasoning: "low" });
  assert.deepEqual(choiceOf("high"), { model: "smart", reasoning: "high" });
});

test("прежний выбор показывается ближайшим положением", () => {
  assert.equal(levelOf("", ""), "medium"); // ничего не выбирал: как решит сервер
  assert.equal(levelOf("fast", "high"), "instant");
  assert.equal(levelOf("smart", "low"), "medium");
  assert.equal(levelOf("smart", "high"), "high");
  assert.equal(levelOf("smart", "max"), "high"); // «Максимума» в выборе больше нет
  assert.equal(levelOf("", "max"), "high");
});

test("в запрос уходит выбор положения, а без выбора — ничего", () => {
  assert.deepEqual(askChoice({ model: "", reasoning: "" }), {});
  assert.deepEqual(askChoice({ model: "smart", reasoning: "max" }), { model: "smart", reasoning: "high" });
  assert.deepEqual(askChoice({ model: "fast", reasoning: "" }), { model: "fast", reasoning: "low" });
});

test("стрелка спидометра: Instant влево, Medium вверх, High вправо", () => {
  assert.ok(gaugeAngle("instant") < 0);
  assert.equal(gaugeAngle("medium"), 0);
  assert.equal(gaugeAngle("high"), -gaugeAngle("instant"));
});

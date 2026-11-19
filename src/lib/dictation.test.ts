import assert from "node:assert/strict";
import { test } from "node:test";

import { heardFrom, withHeard } from "./dictation.ts";

const result = (transcript: string, isFinal: boolean) => Object.assign([{ transcript }], { isFinal });

test("услышанное собирается из кусков, готово только когда все куски окончательные", () => {
  assert.deepEqual(heardFrom([result("Объясни", true), result(" производную ", false)]), {
    text: "Объясни производную",
    final: false,
  });
  assert.deepEqual(heardFrom([result("привет", true)]), { text: "привет", final: true });
  assert.deepEqual(heardFrom([]), { text: "", final: false });
});

test("сказанное дописывается к тому, что уже набрано", () => {
  assert.equal(withHeard("", "привет"), "привет");
  assert.equal(withHeard("Объясни", "производную"), "Объясни производную");
  assert.equal(withHeard("Объясни ", "производную"), "Объясни производную");
  assert.equal(withHeard("Объясни", ""), "Объясни");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  curriculumSectionLabel,
  curriculumTabLabel,
  stepAfterGoal,
  wizardRail,
} from "./curriculum-books.ts";

test("after the subject the wizard goes to the upload step only when books are on", () => {
  assert.equal(stepAfterGoal(true), "upload");
  assert.equal(stepAfterGoal(false), "shelf");
});

test("the wizard rail has the book stage only when books are on", () => {
  assert.deepEqual(wizardRail(true).map((item) => item.label), ["Цель", "Учебник", "Программа"]);
  assert.deepEqual(wizardRail(false).map((item) => item.label), ["Цель", "Программа"]);
});

test("without books no rail stage owns the upload or processing step", () => {
  const owned = wizardRail(false).flatMap((item) => item.steps);
  assert.ok(!owned.includes("upload"));
  assert.ok(!owned.includes("processing"));
});

test("the section label drops books when they are off", () => {
  assert.equal(curriculumSectionLabel(true), "Курсы и книги");
  assert.equal(curriculumSectionLabel(false), "Курсы");
});

test("the phone tab label drops books when they are off", () => {
  assert.equal(curriculumTabLabel(true), "Книги");
  assert.equal(curriculumTabLabel(false), "Курсы");
});

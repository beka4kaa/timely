import assert from "node:assert/strict";
import test from "node:test";

import {
  curriculumSectionLabel,
  curriculumTabLabel,
  chatContextHint,
  chatEmptyLine,
  chatPlaceholder,
  railPlaceholder,
  showBookPicker,
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

test("the book picker in the chat shows only when books are on", () => {
  assert.equal(showBookPicker(true), true);
  assert.equal(showBookPicker(false), false);
});

test("the chat placeholder never mentions a book when books are off", () => {
  assert.equal(chatPlaceholder(true, true, "Спроси что угодно"), "Спроси по книге");
  assert.equal(chatPlaceholder(true, false, "Спроси что угодно"), "Спроси что угодно");
  assert.equal(chatPlaceholder(false, true, "Спроси что угодно"), "Спроси что угодно");
});

test("the rail placeholder never mentions a book when books are off", () => {
  assert.equal(railPlaceholder(true, true), "Спроси по книге");
  assert.equal(railPlaceholder(true, false), "Чем помочь?");
  assert.equal(railPlaceholder(false, true), "Чем помочь?");
});

test("the empty chat line has no book or textbook words when books are off", () => {
  const withBook = { title: "Физика", books: 1 };
  assert.match(chatEmptyLine(true, withBook), /книге/);
  assert.match(chatEmptyLine(true, { title: "Физика", books: 0 }), /нет книги/);
  assert.match(chatEmptyLine(true, null), /по книге/);
  for (const subject of [withBook, { title: "Физика", books: 0 }, null]) {
    assert.doesNotMatch(chatEmptyLine(false, subject), /книг|учебник/i);
  }
});

test("the context hint drops book fragments when books are off", () => {
  assert.match(chatContextHint(true), /книги/);
  assert.doesNotMatch(chatContextHint(false), /книг|учебник/i);
});

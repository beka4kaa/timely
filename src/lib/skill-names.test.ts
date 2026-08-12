import assert from "node:assert/strict";
import { test } from "node:test";

import { SCHEDULE_SKILLS, isSkillName, skillLabel } from "./skill-names.ts";

test("имена инструментов опознаются", () => {
  assert.equal(isSkillName("list_courses"), true);
  assert.equal(isSkillName("add_course_to_schedule"), true);
  assert.equal(isSkillName("propose_move_blocks"), true);
});

test("пробелы по краям не мешают", () => {
  assert.equal(isSkillName("  list_courses "), true);
});

test("похожее на скилл скиллом не считается", () => {
  // Ложный чип превращает обычный текст в кнопку, которой нет, — это хуже,
  // чем неподсвеченное имя.
  assert.equal(isSkillName("course_plan_id"), false);
  assert.equal(isSkillName("list_courses()"), false);
  assert.equal(isSkillName("courses"), false);
  assert.equal(isSkillName(""), false);
});

test("у каждого скилла есть человеческая подпись", () => {
  for (const skill of SCHEDULE_SKILLS) {
    assert.notEqual(skillLabel(skill), "", skill);
  }
});

test("у неизвестного имени подписи нет", () => {
  assert.equal(skillLabel("course_plan_id"), "");
});

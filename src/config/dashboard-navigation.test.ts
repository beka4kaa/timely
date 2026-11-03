import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getDashboardNavigation,
  getDashboardPageMeta,
  getDashboardSections,
  matchNavigation,
} from "./dashboard-navigation.ts";

test("шесть разделов из продуктовой схемы, по порядку", () => {
  assert.deepEqual(
    getDashboardSections().map((section) => section.title),
    ["Сейчас", "Учёба", "Тьютор", "Библиотека", "Соревнования", "Прогресс"],
  );
});

test("«Сейчас» горит только на корне, а не на каждой странице", () => {
  assert.deepEqual(matchNavigation("/dashboard"), {
    section: "now",
    itemUrl: "/dashboard",
  });
  assert.equal(matchNavigation("/dashboard/profile").section, null);
});

test("побеждает самый точный пункт: оценки — прогресс, а не дневник", () => {
  assert.deepEqual(matchNavigation("/dashboard/diary/grades"), {
    section: "progress",
    itemUrl: "/dashboard/diary/grades",
  });
  assert.deepEqual(matchNavigation("/dashboard/diary/schedule"), {
    section: "study",
    itemUrl: "/dashboard/diary",
  });
  assert.equal(matchNavigation("/dashboard/curriculum/plan/42").section, "library");
});

test("у раздела из одной страницы пункт меню — он сам", () => {
  const groups = getDashboardNavigation();
  const library = groups.find((group) => group.label === "Библиотека");
  assert.deepEqual(
    library?.items.map((item) => item.url),
    ["/dashboard/curriculum"],
  );
});

test("заголовок шапки: корень — «Сейчас», чужая страница — не «Сейчас»", () => {
  assert.equal(getDashboardPageMeta("/dashboard").title, "Сейчас");
  assert.equal(getDashboardPageMeta("/dashboard/leaderboard").title, "Рейтинг");
  assert.equal(getDashboardPageMeta("/dashboard/unknown").title, "Timely");
});

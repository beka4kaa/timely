import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dashboardViewOf,
  getDashboardNavigation,
  getDashboardPageMeta,
  getDashboardSections,
  itemMatches,
  matchNavigation,
} from "./dashboard-navigation.ts";

test("группы левой панели: тьютор сразу под «Сейчас»", () => {
  assert.deepEqual(
    getDashboardSections().map((section) => section.title),
    ["Сейчас", "Тьютор", "Учёба", "Рост", "Библиотека", "Соревнования"],
  );
});

test("«Сейчас» горит только на корне, а не на каждой странице", () => {
  assert.deepEqual(matchNavigation("/dashboard"), {
    section: "now",
    itemUrl: "/dashboard",
  });
  assert.equal(matchNavigation("/dashboard/profile").section, null);
});

test("побеждает самый точный пункт: страница курса в библиотеке, шаблон уроков в неделе", () => {
  assert.deepEqual(matchNavigation("/dashboard/diary/schedule"), {
    section: "study",
    itemUrl: "/dashboard/plan",
  });
  assert.deepEqual(matchNavigation("/dashboard/diary/grades"), {
    section: "study",
    itemUrl: "/dashboard/plan",
  });
  assert.deepEqual(matchNavigation("/dashboard/plan"), {
    section: "study",
    itemUrl: "/dashboard/plan",
  });
  assert.equal(matchNavigation("/dashboard/curriculum/plan/42").section, "library");
  assert.equal(matchNavigation("/dashboard/habits").section, "growth");
});

test("страница для стилей: курс отдельно от библиотеки, неизвестная без своего вида", () => {
  assert.equal(dashboardViewOf("/dashboard"), "now");
  assert.equal(dashboardViewOf("/dashboard/curriculum/plan/42"), "course");
  assert.equal(dashboardViewOf("/dashboard/curriculum"), "library");
  assert.equal(dashboardViewOf("/dashboard/weaknesses"), "weak");
  assert.equal(dashboardViewOf("/dashboard/nutrition"), "other");
});

test("доска выключена: в панели только чат", () => {
  const tutor = getDashboardSections().find((section) => section.key === "tutor");
  assert.deepEqual(
    tutor?.items.map((item) => item.url),
    ["/dashboard/chat"],
  );
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

test("в учёбе одна неделя вместо дневника и плана", () => {
  const study = getDashboardSections().find((section) => section.key === "study");

  assert.deepEqual(study?.items.map((item) => item.title), ["Неделя", "Слабые темы", "Помодоро"]);
  assert.equal(study?.url, "/dashboard/plan");
  assert.equal(itemMatches({ url: "/dashboard/plan", aliases: ["/dashboard/diary"] }, "/dashboard/diary/schedule"), true);
  assert.equal(itemMatches({ url: "/dashboard/plan" }, "/dashboard/planner"), false);
});

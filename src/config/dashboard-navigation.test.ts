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
import { SECTION_LABEL } from "../lib/curriculum-books.ts";

test("разделы: четыре страницы, потом три группы", () => {
  const sections = getDashboardSections();
  assert.deepEqual(sections.map((s) => s.title), ["Сейчас", "Тьютор", "Неделя", "Помодоро", "Учёба", "Рост", "Соревнования"]);
  assert.deepEqual(sections.map((s) => s.kind), ["page", "page", "page", "page", "group", "group", "group"]);
});

test("в учёбе слабые темы и курсы, доска выключена", () => {
  const study = getDashboardSections().find((s) => s.key === "study");
  assert.deepEqual(study?.items.map((i) => i.url), ["/dashboard/weaknesses", "/dashboard/curriculum"]);
  assert.equal(study?.items[1].title, SECTION_LABEL);
});

test("страницы горят по своим и прежним адресам", () => {
  assert.deepEqual(matchNavigation("/dashboard/diary/schedule"), { section: "week", itemUrl: "/dashboard/plan" });
  assert.deepEqual(matchNavigation("/dashboard/pomodoro/history/2026-11-19"), { section: "focus", itemUrl: "/dashboard/pomodoro" });
  assert.deepEqual(matchNavigation("/dashboard/curriculum/plan/42"), { section: "study", itemUrl: "/dashboard/curriculum" });
  assert.deepEqual(matchNavigation("/dashboard/leaderboard"), { section: "contests", itemUrl: "/dashboard/leaderboard" });
  assert.equal(matchNavigation("/dashboard/profile").section, null);
});

test("плоское меню доски: у страницы один пункт — она сама", () => {
  const week = getDashboardNavigation().find((g) => g.label === "Неделя");
  assert.deepEqual(week?.items.map((i) => i.url), ["/dashboard/plan"]);
});

test("«Сейчас» горит только на корне, а не на каждой странице", () => {
  assert.deepEqual(matchNavigation("/dashboard"), {
    section: "now",
    itemUrl: "/dashboard",
  });
  assert.equal(matchNavigation("/dashboard/profile").section, null);
});

test("побеждает самый точный адрес: оценки и шаблон уроков в неделе, привычки в росте", () => {
  assert.deepEqual(matchNavigation("/dashboard/diary/grades"), {
    section: "week",
    itemUrl: "/dashboard/plan",
  });
  assert.deepEqual(matchNavigation("/dashboard/plan"), {
    section: "week",
    itemUrl: "/dashboard/plan",
  });
  assert.equal(matchNavigation("/dashboard/habits").section, "growth");
});

test("страница для стилей: курс отдельно от библиотеки, неизвестная без своего вида", () => {
  assert.equal(dashboardViewOf("/dashboard"), "now");
  assert.equal(dashboardViewOf("/dashboard/curriculum/plan/42"), "course");
  assert.equal(dashboardViewOf("/dashboard/curriculum"), "library");
  assert.equal(dashboardViewOf("/dashboard/weaknesses"), "weak");
  assert.equal(dashboardViewOf("/dashboard/nutrition"), "other");
});

test("заголовок шапки: корень — «Сейчас», чужая страница — не «Сейчас»", () => {
  assert.equal(getDashboardPageMeta("/dashboard").title, "Сейчас");
  assert.equal(getDashboardPageMeta("/dashboard/leaderboard").title, "Рейтинг");
  assert.equal(getDashboardPageMeta("/dashboard/unknown").title, "Timely");
});

test("неделя горит и на прежнем адресе дневника", () => {
  const week = getDashboardSections().find((section) => section.key === "week");

  assert.equal(week?.url, "/dashboard/plan");
  assert.deepEqual(week?.aliases, ["/dashboard/diary"]);
  assert.equal(itemMatches({ url: "/dashboard/plan", aliases: ["/dashboard/diary"] }, "/dashboard/diary/schedule"), true);
  assert.equal(itemMatches({ url: "/dashboard/plan" }, "/dashboard/planner"), false);
});

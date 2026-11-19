import assert from "node:assert/strict";
import { test } from "node:test";

import { getDashboardSections } from "../config/dashboard-navigation.ts";
import { groupSignal, openGroupsFor, readOpenGroups, toggleGroup, writeOpenGroups } from "./nav-groups.ts";

const GROUPS = ["study", "growth", "contests"] as const;

test("первый заход: открыта только группа текущей страницы", () => {
  assert.deepEqual(openGroupsFor(null, "contests", GROUPS), ["contests"]);
  assert.deepEqual(openGroupsFor(null, "focus", GROUPS), []);
});

test("запомненное плюс группа текущей страницы, без чужих ключей", () => {
  assert.deepEqual(openGroupsFor(["growth", "library"], "contests", GROUPS), ["growth", "contests"]);
  assert.deepEqual(openGroupsFor(["growth", "contests"], "contests", GROUPS), ["growth", "contests"]);
});

test("переключение открывает и закрывает", () => {
  assert.deepEqual(toggleGroup(["growth"], "study"), ["growth", "study"]);
  assert.deepEqual(toggleGroup(["growth", "study"], "growth"), ["study"]);
});

test("сигнал группы: число повторений у учёбы, точка у книги", () => {
  const study = getDashboardSections().find((s) => s.key === "study")!;
  const growth = getDashboardSections().find((s) => s.key === "growth")!;
  assert.deepEqual(groupSignal(study, { dueReviews: 3, ingesting: true }), { count: 3, live: true });
  assert.deepEqual(groupSignal(study, { dueReviews: 0, ingesting: false }), { count: null, live: false });
  assert.deepEqual(groupSignal(growth, { dueReviews: 3, ingesting: true }), { count: null, live: false });
});

test("хранилище закрыто: чтение даёт null, запись не бросает", () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  try {
    assert.equal(readOpenGroups(), null);
    assert.doesNotThrow(() => writeOpenGroups(["study"]));
  } finally {
    if (before) Object.defineProperty(globalThis, "localStorage", before);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

test("в хранилище мусор: считается, что ничего не запомнено", () => {
  const store = new Map<string, string>([["timely-nav-groups", "{oops"]]);
  const before = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
  });
  try {
    assert.equal(readOpenGroups(), null);
    writeOpenGroups(["growth"]);
    assert.deepEqual(readOpenGroups(), ["growth"]);
  } finally {
    if (before) Object.defineProperty(globalThis, "localStorage", before);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  }
});

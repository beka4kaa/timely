import assert from "node:assert/strict";
import { test } from "node:test";

import {
  appPathToDashboardPath,
  dashboardPathToAppPath,
  isAppPassthroughPath,
  normalizeHostname,
  resolveHostRouting,
  toDashboardPath,
} from "./host-routing";

test("normalizes forwarded hosts with ports and trailing dots", () => {
  assert.equal(normalizeHostname("APP.TIMELYPLAN.ME:443"), "app.timelyplan.me");
  assert.equal(normalizeHostname("timelyplan.me., proxy.internal"), "timelyplan.me");
});

test("rewrites the app root to the dashboard diary without a public redirect", () => {
  assert.deepEqual(
    resolveHostRouting({
      hostname: "app.timelyplan.me",
      pathname: "/",
    }),
    {
      type: "rewrite",
      pathname: "/dashboard/diary",
    },
  );
});

test("preserves clean nested paths on the app subdomain", () => {
  assert.equal(
    appPathToDashboardPath("/whiteboard"),
    "/dashboard/whiteboard",
  );
  assert.equal(appPathToDashboardPath("/settings"), "/dashboard/settings");
});

test("redirects marketing dashboard paths to their clean app equivalents", () => {
  assert.deepEqual(
    resolveHostRouting({
      hostname: "timelyplan.me",
      pathname: "/dashboard",
    }),
    {
      type: "redirect",
      destination: "https://app.timelyplan.me/",
      status: 302,
    },
  );

  assert.deepEqual(
    resolveHostRouting({
      hostname: "www.timelyplan.me",
      pathname: "/dashboard/whiteboard",
      search: "?lesson=forces",
    }),
    {
      type: "redirect",
      destination: "https://app.timelyplan.me/whiteboard?lesson=forces",
      status: 302,
    },
  );
});

test("canonicalizes dashboard-prefixed URLs on the app subdomain", () => {
  assert.equal(
    dashboardPathToAppPath("/dashboard/diary/grades"),
    "/diary/grades",
  );
  assert.deepEqual(
    resolveHostRouting({
      hostname: "app.timelyplan.me",
      pathname: "/dashboard/diary/grades",
    }),
    {
      type: "redirect",
      destination: "https://app.timelyplan.me/diary/grades",
      status: 302,
    },
  );
});

test("keeps auth routes and static assets outside dashboard rewrites", () => {
  assert.equal(isAppPassthroughPath("/auth/signin"), true);
  assert.equal(isAppPassthroughPath("/logo.svg"), true);
  assert.deepEqual(
    resolveHostRouting({
      hostname: "app.timelyplan.me",
      pathname: "/auth/signin",
    }),
    { type: "next" },
  );
});

test("leaves the marketing landing and unrelated preview hosts untouched", () => {
  assert.deepEqual(
    resolveHostRouting({
      hostname: "timelyplan.me",
      pathname: "/",
    }),
    { type: "next" },
  );
  assert.deepEqual(
    resolveHostRouting({
      hostname: "preview.vercel.app",
      pathname: "/dashboard",
    }),
    { type: "next" },
  );
});

// ─────────────── Канонический путь для того, что решает по адресу ───────────────
//
// На app-хосте адресная строка чистая, а `/dashboard/...` живёт только после
// внутреннего rewrite. Из-за этого заголовок раздела оставался «Рабочим
// пространством», подсветка меню не зажигалась, а панель вопросов висела на
// странице «Тьютор» поверх такого же чата.

test("clean app paths resolve to their dashboard route", () => {
  assert.equal(toDashboardPath("/chat"), "/dashboard/chat");
  assert.equal(toDashboardPath("/curriculum/plan"), "/dashboard/curriculum/plan");
});

test("the clean app root is the diary, as the rewrite says", () => {
  assert.equal(toDashboardPath("/"), "/dashboard/diary");
});

test("dashboard paths pass through untouched", () => {
  assert.equal(toDashboardPath("/dashboard"), "/dashboard");
  assert.equal(toDashboardPath("/dashboard/chat"), "/dashboard/chat");
});

test("non-dashboard pages keep their own address", () => {
  // Иначе `/auth/signin` превратился бы в несуществующий раздел.
  assert.equal(toDashboardPath("/auth/signin"), "/auth/signin");
  assert.equal(toDashboardPath("/register"), "/register");
  assert.equal(toDashboardPath("/logo.svg"), "/logo.svg");
});

test("an empty path falls back to the dashboard root", () => {
  assert.equal(toDashboardPath(""), "/dashboard");
});

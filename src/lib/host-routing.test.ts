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
  assert.equal(normalizeHostname("APP.TIMELY-PLAN.COM:443"), "app.timely-plan.com");
  assert.equal(normalizeHostname("timely-plan.com., proxy.internal"), "timely-plan.com");
});

test("rewrites the app root to the «Сейчас» home without a public redirect", () => {
  assert.deepEqual(
    resolveHostRouting({
      hostname: "app.timely-plan.com",
      pathname: "/",
    }),
    {
      type: "rewrite",
      pathname: "/dashboard",
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
      hostname: "timely-plan.com",
      pathname: "/dashboard",
    }),
    {
      type: "redirect",
      destination: "https://app.timely-plan.com/",
      status: 302,
    },
  );

  assert.deepEqual(
    resolveHostRouting({
      hostname: "www.timely-plan.com",
      pathname: "/dashboard/whiteboard",
      search: "?lesson=forces",
    }),
    {
      type: "redirect",
      destination: "https://app.timely-plan.com/whiteboard?lesson=forces",
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
      hostname: "app.timely-plan.com",
      pathname: "/dashboard/diary/grades",
    }),
    {
      type: "redirect",
      destination: "https://app.timely-plan.com/diary/grades",
      status: 302,
    },
  );
});

test("keeps auth routes and static assets outside dashboard rewrites", () => {
  assert.equal(isAppPassthroughPath("/auth/signin"), true);
  assert.equal(isAppPassthroughPath("/logo.svg"), true);
  assert.deepEqual(
    resolveHostRouting({
      hostname: "app.timely-plan.com",
      pathname: "/auth/signin",
    }),
    { type: "next" },
  );
});

test("a shared chat opens on both hosts without the dashboard prefix and without sign-in routing", () => {
  assert.equal(isAppPassthroughPath("/share/AbC-123_xyz"), true);
  assert.equal(toDashboardPath("/share/AbC-123_xyz"), "/share/AbC-123_xyz");
  assert.deepEqual(resolveHostRouting({ hostname: "app.timely-plan.com", pathname: "/share/AbC-123_xyz" }), { type: "next" });
  assert.deepEqual(resolveHostRouting({ hostname: "timely-plan.com", pathname: "/share/AbC-123_xyz" }), { type: "next" });
  // Похожий раздел дашборда остаётся разделом дашборда.
  assert.equal(isAppPassthroughPath("/shared-goals"), false);
});

test("the privacy page opens on both hosts without the dashboard prefix", () => {
  assert.equal(isAppPassthroughPath("/privacy"), true);
  assert.equal(toDashboardPath("/privacy"), "/privacy");
  assert.deepEqual(resolveHostRouting({ hostname: "app.timely-plan.com", pathname: "/privacy" }), { type: "next" });
  assert.deepEqual(resolveHostRouting({ hostname: "timely-plan.com", pathname: "/privacy" }), { type: "next" });
  assert.equal(isAppPassthroughPath("/privacy-policy-of-someone"), false);
});

test("leaves the marketing landing and unrelated preview hosts untouched", () => {
  assert.deepEqual(
    resolveHostRouting({
      hostname: "timely-plan.com",
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

test("the clean app root is the «Сейчас» home, as the rewrite says", () => {
  assert.equal(toDashboardPath("/"), "/dashboard");
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

test("the demo host serves the dashboard on clean paths, with no sign-in", () => {
  const config = {
    marketingHostname: "timely-plan.com",
    appHostname: "app.timely-plan.com",
    appOrigin: "https://app.timely-plan.com",
    demoHostname: "demo.timely-plan.com",
  };
  const on = (pathname: string, search = "") =>
    resolveHostRouting({ hostname: "demo.timely-plan.com", pathname, search }, config);

  assert.deepEqual(on("/"), { type: "rewrite", pathname: "/dashboard" });
  assert.deepEqual(on("/plan"), { type: "rewrite", pathname: "/dashboard/plan" });
  // Relative, so the middleware keeps the demo's own scheme, host and port.
  assert.deepEqual(on("/dashboard/chat", "?chat=1"), { type: "redirect", destination: "/chat?chat=1", status: 302 });
  assert.deepEqual(on("/auth/signin"), { type: "redirect", destination: "/", status: 302 });
  assert.deepEqual(on("/register"), { type: "redirect", destination: "/", status: 302 });
  assert.deepEqual(on("/api/diary/week"), { type: "next" });
  assert.deepEqual(on("/demo/fixtures.json"), { type: "next" });
  // The app host keeps its absolute redirects and its sign-in.
  assert.deepEqual(
    resolveHostRouting({ hostname: "app.timely-plan.com", pathname: "/dashboard/chat" }, config),
    { type: "redirect", destination: "https://app.timely-plan.com/chat", status: 302 },
  );
  assert.deepEqual(resolveHostRouting({ hostname: "app.timely-plan.com", pathname: "/auth/signin" }, config), {
    type: "next",
  });
});

test("old domains move to the same page on timely-plan.com", () => {
  const config = {
    marketingHostname: "timely-plan.com",
    appHostname: "app.timely-plan.com",
    appOrigin: "https://app.timely-plan.com",
    demoHostname: "demo.timely-plan.com",
  };
  const from = (hostname: string, pathname: string, search = "") =>
    resolveHostRouting({ hostname, pathname, search }, config);

  assert.deepEqual(from("app.timely-plan.study", "/chat", "?chat=4"), {
    type: "redirect",
    destination: "https://app.timely-plan.com/chat?chat=4",
    status: 308,
  });
  assert.deepEqual(from("app.timely-plan.study", "/auth/signin"), {
    type: "redirect",
    destination: "https://app.timely-plan.com/auth/signin",
    status: 308,
  });
  assert.deepEqual(from("demo.timely-plan.study", "/plan"), {
    type: "redirect",
    destination: "https://demo.timely-plan.com/plan",
    status: 308,
  });
  assert.deepEqual(from("timely-plan.study", "/en"), {
    type: "redirect",
    destination: "https://timely-plan.com/en",
    status: 308,
  });
  assert.deepEqual(from("www.timely-plan.study", "/"), {
    type: "redirect",
    destination: "https://timely-plan.com/",
    status: 308,
  });
  assert.deepEqual(from("APP.TIMELYPLAN.ME:443", "/diary"), {
    type: "redirect",
    destination: "https://app.timely-plan.com/diary",
    status: 308,
  });
  // The new hosts themselves are untouched.
  assert.deepEqual(from("www.timely-plan.com", "/"), { type: "next" });
  assert.deepEqual(from("app.timely-plan.com", "/"), { type: "rewrite", pathname: "/dashboard" });
});

test("an old domain still set in the environment is served, not redirected in a loop", () => {
  const config = {
    marketingHostname: "timely-plan.study",
    appHostname: "app.timely-plan.study",
    appOrigin: "https://app.timely-plan.study",
    demoHostname: "demo.timely-plan.com",
  };
  assert.deepEqual(resolveHostRouting({ hostname: "app.timely-plan.study", pathname: "/" }, config), {
    type: "rewrite",
    pathname: "/dashboard",
  });
  assert.deepEqual(resolveHostRouting({ hostname: "timely-plan.study", pathname: "/" }, config), { type: "next" });
  assert.deepEqual(resolveHostRouting({ hostname: "demo.timely-plan.study", pathname: "/" }, config), {
    type: "redirect",
    destination: "https://demo.timely-plan.com/",
    status: 308,
  });
});

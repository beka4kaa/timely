import assert from "node:assert/strict";
import { test } from "node:test";

import { localeFromParams, resolveAppLocale, withLang } from "./app-locale";

test("?lang= запоминается, а из адреса убирается вместе с остальными параметрами на месте", () => {
  assert.deepEqual(resolveAppLocale("/dashboard", "?lang=en"), { locale: "en", destination: "/dashboard" });
  assert.deepEqual(resolveAppLocale("/chat", "?q=hi&lang=ru"), { locale: "ru", destination: "/chat?q=hi" });
});

test("без lang и с чужим языком адрес не трогается", () => {
  assert.equal(resolveAppLocale("/dashboard", ""), null);
  assert.equal(resolveAppLocale("/dashboard", "?q=1"), null);
  assert.equal(resolveAppLocale("/dashboard", "?lang=de"), null);
});

test("lang внутри callbackUrl: вход тоже открывается на этом языке", () => {
  const relative = resolveAppLocale("/auth/signin", `?callbackUrl=${encodeURIComponent("/dashboard?lang=en")}`);
  assert.deepEqual(relative, { locale: "en", destination: `/auth/signin?callbackUrl=${encodeURIComponent("/dashboard")}` });

  const absolute = resolveAppLocale(
    "/auth/signin",
    `?callbackUrl=${encodeURIComponent("https://app.timely-plan.com/chat?q=x&lang=en#end")}`,
  );
  assert.deepEqual(absolute, {
    locale: "en",
    destination: `/auth/signin?callbackUrl=${encodeURIComponent("https://app.timely-plan.com/chat?q=x#end")}`,
  });
});

test("ссылки английского лендинга несут lang=en, русского — ничего", () => {
  assert.equal(withLang("https://app.timely-plan.com/auth/signin", "en"), "https://app.timely-plan.com/auth/signin?lang=en");
  assert.equal(withLang("https://app.timely-plan.com/chat?q=a%20b", "en"), "https://app.timely-plan.com/chat?q=a%20b&lang=en");
  assert.equal(withLang("https://demo.timely-plan.com", "en"), "https://demo.timely-plan.com?lang=en");
  assert.equal(withLang("https://app.timely-plan.com/auth/signin", "ru"), "https://app.timely-plan.com/auth/signin");
});

test("страница входа читает язык из своих параметров: сверху или из callbackUrl", () => {
  assert.equal(localeFromParams({ lang: "en" }), "en");
  assert.equal(localeFromParams({ callbackUrl: "/dashboard?lang=en" }), "en");
  assert.equal(localeFromParams({ callbackUrl: ["/chat?q=1&lang=ru", "/x"] }), "ru");
  assert.equal(localeFromParams({ callbackUrl: "/dashboard" }), null);
  assert.equal(localeFromParams({}), null);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { isMarketingOnlyPath, marketingOriginFromEnv, resolveHostRouting } from "./host-routing";
import {
  acceptsRussianReaderLanguage,
  explicitLandingLocale,
  isBotUserAgent,
  resolveLandingLocale,
} from "./landing-locale";

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const TO_ENGLISH = { type: "redirect", destination: "/en", status: 302 } as const;

test("sends a first visit from an English-only browser to /en", () => {
  assert.deepEqual(
    resolveLandingLocale({ pathname: "/", acceptLanguage: "en-US,en;q=0.9", userAgent: CHROME }),
    TO_ENGLISH,
  );
  assert.deepEqual(
    resolveLandingLocale({ pathname: "/", acceptLanguage: "de-DE,de;q=0.9,en;q=0.8", userAgent: CHROME }),
    TO_ENGLISH,
  );
});

test("keeps the Russian page when any Russian-reading language is accepted", () => {
  for (const acceptLanguage of [
    "ru-RU,ru;q=0.9",
    "en-US,en;q=0.9,ru;q=0.8",
    "kk-KZ",
    "be",
    "ky-KG,en;q=0.5",
    "uz-Latn-UZ",
    "tg",
    "RU",
  ]) {
    assert.equal(
      resolveLandingLocale({ pathname: "/", acceptLanguage, userAgent: CHROME }),
      null,
      acceptLanguage,
    );
  }
});

test("a language the browser refuses with q=0 does not count", () => {
  assert.equal(acceptsRussianReaderLanguage("en-US, ru;q=0"), false);
  assert.equal(acceptsRussianReaderLanguage("en-US, ru;q=0.0"), false);
  assert.equal(acceptsRussianReaderLanguage("en-US, ru;q=0.1"), true);
  assert.equal(acceptsRussianReaderLanguage("*"), true);
  // «ru» должен быть отдельным языком, а не началом другого кода.
  assert.equal(acceptsRussianReaderLanguage("rue, run"), false);
});

test("the switch's cookie always wins over the browser language", () => {
  assert.equal(
    resolveLandingLocale({ pathname: "/", cookie: "ru", acceptLanguage: "en-US", userAgent: CHROME }),
    null,
  );
  assert.deepEqual(
    resolveLandingLocale({ pathname: "/", cookie: "en", acceptLanguage: "ru-RU", userAgent: CHROME }),
    TO_ENGLISH,
  );
  // Чужое значение — как будто куки нет.
  assert.deepEqual(
    resolveLandingLocale({ pathname: "/", cookie: "de", acceptLanguage: "en-US", userAgent: CHROME }),
    TO_ENGLISH,
  );
});

test("bots, link previews and requests without a language stay on the Russian page", () => {
  for (const userAgent of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "TelegramBot (like TwitterBot)",
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "WhatsApp/2.23.20.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36",
  ]) {
    assert.equal(isBotUserAgent(userAgent), true, userAgent);
    assert.equal(resolveLandingLocale({ pathname: "/", acceptLanguage: "en-US", userAgent }), null);
  }
  assert.equal(isBotUserAgent(CHROME), false);
  assert.equal(resolveLandingLocale({ pathname: "/", userAgent: CHROME }), null);
  assert.equal(resolveLandingLocale({ pathname: "/", acceptLanguage: "  ", userAgent: CHROME }), null);
});

test("only the Russian home page is redirected, and the query string survives", () => {
  for (const pathname of ["/en", "/privacy", "/auth/signin", "/dashboard"]) {
    assert.equal(
      resolveLandingLocale({ pathname, acceptLanguage: "en-US", userAgent: CHROME }),
      null,
      pathname,
    );
  }
  assert.deepEqual(
    resolveLandingLocale({
      pathname: "/",
      search: "?utm_source=accelerator",
      acceptLanguage: "en-US",
      userAgent: CHROME,
    }),
    { type: "redirect", destination: "/en?utm_source=accelerator", status: 302 },
  );
});

test("the English landing is served on the marketing host as is", () => {
  assert.deepEqual(resolveHostRouting({ hostname: "timelyplan.me", pathname: "/en" }), {
    type: "next",
  });
  assert.deepEqual(resolveHostRouting({ hostname: "www.timelyplan.me", pathname: "/en" }), {
    type: "next",
  });
});

test("the app host sends /en to the marketing site instead of /dashboard/en", () => {
  assert.deepEqual(
    resolveHostRouting({ hostname: "app.timelyplan.me", pathname: "/en", search: "?ref=demo" }),
    { type: "redirect", destination: "https://timelyplan.me/en?ref=demo", status: 302 },
  );
  assert.deepEqual(
    resolveHostRouting(
      { hostname: "app.example.test", pathname: "/en" },
      {
        marketingHostname: "example.test",
        appHostname: "app.example.test",
        appOrigin: "http://app.example.test",
        marketingOrigin: "http://example.test/",
      },
    ),
    { type: "redirect", destination: "http://example.test/en", status: 302 },
  );
});

test("the landing's own address comes from the same env as the middleware", () => {
  const saved = {
    host: process.env.TIMELY_MARKETING_HOST,
    origin: process.env.TIMELY_MARKETING_ORIGIN,
  };
  try {
    process.env.TIMELY_MARKETING_HOST = "timely-plan.study";
    delete process.env.TIMELY_MARKETING_ORIGIN;
    assert.equal(marketingOriginFromEnv(), "https://timely-plan.study");
    process.env.TIMELY_MARKETING_ORIGIN = "http://127.0.0.1:3417/";
    assert.equal(marketingOriginFromEnv(), "http://127.0.0.1:3417");
  } finally {
    if (saved.host === undefined) delete process.env.TIMELY_MARKETING_HOST;
    else process.env.TIMELY_MARKETING_HOST = saved.host;
    if (saved.origin === undefined) delete process.env.TIMELY_MARKETING_ORIGIN;
    else process.env.TIMELY_MARKETING_ORIGIN = saved.origin;
  }
});

test("only /en itself is a marketing-only path, not app sections that start with it", () => {
  assert.equal(isMarketingOnlyPath("/en"), true);
  assert.equal(isMarketingOnlyPath("/en/"), true);
  assert.equal(isMarketingOnlyPath("/entries"), false);
  assert.deepEqual(resolveHostRouting({ hostname: "app.timelyplan.me", pathname: "/entries" }), {
    type: "rewrite",
    pathname: "/dashboard/entries",
  });
});

test("the switch's ?lang=ru reaches the Russian page even when its cookie was not written", () => {
  assert.equal(
    resolveLandingLocale({
      pathname: "/",
      search: "?lang=ru",
      acceptLanguage: "en-US,en;q=0.9",
      userAgent: CHROME,
    }),
    null,
  );
  // A stale English cookie loses to the explicit choice in the address too.
  assert.equal(
    resolveLandingLocale({ pathname: "/", search: "lang=ru", cookie: "en", userAgent: CHROME }),
    null,
  );
  assert.equal(explicitLandingLocale("?lang=ru&utm=x"), "ru");
  assert.equal(explicitLandingLocale("?lang=de"), null);
  assert.equal(explicitLandingLocale(""), null);
});

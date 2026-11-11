import assert from "node:assert/strict";
import { test } from "node:test";

import { limitMessage, resetPhrase } from "./ai-limit.ts";

// UTC+5 без летнего времени: местная дата и дата в UTC расходятся.
process.env.TZ = "Asia/Almaty";

const NOW = new Date(2026, 10, 6, 15, 0);

test("окно на пять часов обновляется сегодня: называем время", () => {
  assert.equal(
    limitMessage(new Date(2026, 10, 6, 18, 40).toISOString(), NOW),
    "Лимит запросов закончился. Он обновится сегодня в 18:40.",
  );
});

test("после полуночи это уже завтра", () => {
  assert.equal(
    limitMessage(new Date(2026, 10, 7, 3, 5).toISOString(), NOW),
    "Лимит запросов закончился. Он обновится завтра в 03:05.",
  );
});

test("недельное окно обновляется через несколько дней, и часами это не назвать", () => {
  assert.equal(
    limitMessage(new Date(2026, 10, 9, 3, 0).toISOString(), NOW),
    "Лимит запросов закончился. Он обновится 9 ноября в 03:00.",
  );
});

test("без времени или с прошедшим временем ничего не обещаем", () => {
  const plain = "Лимит запросов закончился. Попробуй ещё раз позже.";
  assert.equal(limitMessage(undefined, NOW), plain);
  assert.equal(limitMessage("когда-нибудь", NOW), plain);
  assert.equal(limitMessage(new Date(2026, 10, 6, 14, 0).toISOString(), NOW), plain);
});

test("resetPhrase считает сегодня и завтра по местной дате", () => {
  assert.equal(resetPhrase(new Date(2026, 10, 6, 18, 40).toISOString(), NOW), "сегодня в 18:40");
  assert.equal(resetPhrase(new Date(2026, 10, 7, 3, 5).toISOString(), NOW), "завтра в 03:05");
  assert.equal(resetPhrase(new Date(2026, 10, 9, 3, 0).toISOString(), NOW), "9 ноября в 03:00");
  assert.equal(resetPhrase(undefined, NOW), null);
  assert.equal(resetPhrase("когда-нибудь", NOW), null);
  assert.equal(resetPhrase(new Date(2026, 10, 6, 14, 0).toISOString(), NOW), null);
});

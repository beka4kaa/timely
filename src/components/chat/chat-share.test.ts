import assert from "node:assert/strict";
import { test } from "node:test";

import { canShareChat, shareUrl } from "./chat-share";

test("делиться есть чем, только если есть реплика без ошибки", () => {
  const turns = [
    { role: "user", content: "Привет" },
    { role: "assistant", content: "", error: "Сеть" },
  ];
  assert.equal(canShareChat([]), false);
  assert.equal(canShareChat([{ role: "assistant", content: "", error: "Сеть" }]), false);
  assert.equal(canShareChat(turns), true);
});

test("ссылка на чат: адрес сайта и токен, без лишних слешей", () => {
  assert.equal(shareUrl("https://app.timely-plan.com", "AbC-123_xyz"), "https://app.timely-plan.com/share/AbC-123_xyz");
  assert.equal(shareUrl("http://localhost:3005/", "t0k"), "http://localhost:3005/share/t0k");
});

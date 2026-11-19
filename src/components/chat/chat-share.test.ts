import assert from "node:assert/strict";
import { test } from "node:test";

import { canShareChat, chatShareText } from "./chat-share";

test("the shared text is the title and the turns, signed by who said them", () => {
  assert.equal(
    chatShareText("Квадратные уравнения", [
      { role: "user", content: "Что такое дискриминант? " },
      { role: "assistant", content: "Число под корнем в формуле корней." },
    ]),
    "Квадратные уравнения\n\nЯ: Что такое дискриминант?\n\nTimely: Число под корнем в формуле корней.",
  );
});

test("failed and empty answers are left out, and an empty chat has nothing to share", () => {
  const turns = [
    { role: "user", content: "Привет" },
    { role: "assistant", content: "", error: "Сеть" },
  ];
  assert.equal(chatShareText(null, turns), "Новый чат\n\nЯ: Привет");
  assert.equal(canShareChat([]), false);
  assert.equal(canShareChat([{ role: "assistant", content: "", error: "Сеть" }]), false);
  assert.equal(canShareChat(turns), true);
});

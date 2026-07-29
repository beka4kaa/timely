import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно: соседние *.logic.test.ts импортируют без него
// и из-за этого не запускаются вообще (ERR_MODULE_NOT_FOUND) — нативному
// разбору типов в node нужен точный путь. С ним тест реально исполняется:
//   node --test --experimental-strip-types src/components/board/chat-session-restore.logic.test.ts
import { hasUserAuthoredMessage } from "./chat-session-restore.ts";

test("пустой чат не считается грязным", () => {
  assert.equal(hasUserAuthoredMessage([]), false);
});

test("регрессия: баннеры интейка плана НЕ блокируют восстановление", () => {
  // Ровно то состояние, в котором оказывался экран на каждом заходе: план
  // поднялся синхронно и положил свои служебные события. Если считать это
  // «грязным», восстановление сессии отменяется всегда и история никогда не
  // возвращается на экран.
  const afterPlanRestored = [
    { planningEvent: true },
    { planningEvent: true },
  ];

  assert.equal(hasUserAuthoredMessage(afterPlanRestored), false);
});

test("написанное пользователем блокирует восстановление", () => {
  const userStartedTyping = [{ planningEvent: true }, {}];

  assert.equal(hasUserAuthoredMessage(userStartedTyping), true);
});

test("сообщение без флага считается пользовательским", () => {
  assert.equal(hasUserAuthoredMessage([{ planningEvent: false }]), true);
});

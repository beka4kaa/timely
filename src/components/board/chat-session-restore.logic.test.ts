import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно: соседние *.logic.test.ts импортируют без него
// и из-за этого не запускаются вообще (ERR_MODULE_NOT_FOUND) — нативному
// разбору типов в node нужен точный путь. С ним тест реально исполняется:
//   node --test --experimental-strip-types src/components/board/chat-session-restore.logic.test.ts
import {
  boardHasUnsavedWork,
  hasUserAuthoredMessage,
} from "./chat-session-restore.ts";

const EMPTY = JSON.stringify({
  elements: [],
  strokes: [],
  camera: { x: 0, y: 0, zoom: 1 },
});
const WITH_STROKE = JSON.stringify({
  elements: [],
  strokes: [{ id: "s1", points: [], color: "#000", lineWidth: 3 }],
  camera: { x: 0, y: 0, zoom: 1 },
});

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

test("нетронутая доска не считается несохранённой работой", () => {
  // Иначе восстановление сессии отменялось бы на каждом заходе — ровно та
  // ловушка, в которую уже попадала проверка по сообщениям.
  assert.equal(boardHasUnsavedWork(EMPTY, null, EMPTY), false);
});

test("регрессия: нарисованное блокирует восстановление", () => {
  // Медленный mount-restore доезжал после того, как ученик уже порисовал, и
  // затирал рисунки, попутно заглушая автосейв подменой lastSavedCanvas.
  assert.equal(boardHasUnsavedWork(WITH_STROKE, null, EMPTY), true);
});

test("уже сохранённая доска не считается грязной", () => {
  assert.equal(boardHasUnsavedWork(WITH_STROKE, WITH_STROKE, EMPTY), false);
});

test("правка поверх сохранённого состояния считается грязной", () => {
  assert.equal(boardHasUnsavedWork(EMPTY, WITH_STROKE, EMPTY), true);
});

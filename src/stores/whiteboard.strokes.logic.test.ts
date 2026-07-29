import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в chat-session-restore.logic.test.ts.
import { useWhiteboardStore } from "./whiteboard.ts";

function reset() {
  useWhiteboardStore.getState().restoreCanvas(null);
}

const stroke = (id: string) => ({
  id,
  points: [{ x: 0, y: 0, pressure: 0.5 }],
  color: "#302d2a",
  lineWidth: 3,
});

test("регрессия: завершённый штрих будит подписчиков стора", () => {
  // Корень бага «доска не сохраняется»: штрихи жили в React-state хука
  // useCanvasDraw, автосейв сессии подписан на стор, и рисование не порождало
  // ни одного уведомления — а значит и ни одного запроса в сеть.
  reset();
  let notifications = 0;
  const unsubscribe = useWhiteboardStore.subscribe(() => {
    notifications += 1;
  });

  useWhiteboardStore.getState().commitStroke(stroke("s1"));
  unsubscribe();

  assert.equal(notifications, 1);
  assert.equal(useWhiteboardStore.getState().strokes.length, 1);
});

test("штрихи восстанавливаются из снимка сессии", () => {
  reset();
  useWhiteboardStore.getState().restoreCanvas({
    elements: [],
    strokes: [stroke("s1"), stroke("s2")],
    camera: { x: 5, y: 6, zoom: 2 },
  });

  const state = useWhiteboardStore.getState();
  assert.equal(state.strokes.length, 2);
  assert.deepEqual(state.camera, { x: 5, y: 6, zoom: 2 });
});

test("снимок без ключа strokes оставляет доску пустой, а не ломает её", () => {
  // Сессии, сохранённые до появления штрихов, обязаны открываться.
  reset();
  useWhiteboardStore.getState().commitStroke(stroke("s1"));
  useWhiteboardStore.getState().restoreCanvas({ elements: [] });

  assert.deepEqual(useWhiteboardStore.getState().strokes, []);
});

test("восстановление чистит историю штрихов", () => {
  // Иначе первый же Ctrl+Z вернул бы доску ПРЕДЫДУЩЕГО чата.
  reset();
  useWhiteboardStore.getState().commitStroke(stroke("s1"));
  useWhiteboardStore.getState().restoreCanvas({ strokes: [stroke("s9")] });
  useWhiteboardStore.getState().undoStroke();

  assert.equal(useWhiteboardStore.getState().strokes.length, 1);
  assert.equal(useWhiteboardStore.getState().lastStrokeHistorySequence, 0);
});

test("undo возвращает состояние до штриха", () => {
  reset();
  useWhiteboardStore.getState().commitStroke(stroke("s1"));
  useWhiteboardStore.getState().commitStroke(stroke("s2"));
  useWhiteboardStore.getState().undoStroke();

  assert.deepEqual(
    useWhiteboardStore.getState().strokes.map((s) => s.id),
    ["s1"],
  );
});

test("очистка доски откатывается одним шагом", () => {
  reset();
  useWhiteboardStore.getState().commitStroke(stroke("s1"));
  useWhiteboardStore.getState().clearStrokes();
  assert.deepEqual(useWhiteboardStore.getState().strokes, []);

  useWhiteboardStore.getState().undoStroke();
  assert.equal(useWhiteboardStore.getState().strokes.length, 1);
});

test("очистка пустой доски не плодит шаг истории", () => {
  reset();
  const before = useWhiteboardStore.getState().lastStrokeHistorySequence;
  useWhiteboardStore.getState().clearStrokes();

  assert.equal(useWhiteboardStore.getState().lastStrokeHistorySequence, before);
});

test("номера истории штрихов и элементов растут по одной шкале", () => {
  // Whiteboard.undoLatest выбирает, что отменять, СРАВНИВАЯ эти счётчики.
  // Разъедься они — Ctrl+Z начнёт отменять не то действие.
  reset();
  useWhiteboardStore.getState().recordElementCheckpoint([]);
  const afterElement = useWhiteboardStore.getState().lastElementHistorySequence;
  useWhiteboardStore.getState().commitStroke(stroke("s1"));

  assert.ok(useWhiteboardStore.getState().lastStrokeHistorySequence > afterElement);
});

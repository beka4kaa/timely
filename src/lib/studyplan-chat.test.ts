import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts.
import {
  applyAssistantEvent,
  failAssistantRequest,
  initialAssistantState,
  stageLabel,
  type AssistantState,
} from "./studyplan-chat.ts";

function play(events: { event: string; data: Record<string, unknown> }[]): AssistantState {
  return events.reduce(applyAssistantEvent, initialAssistantState);
}

test("стадии копятся в порядке вызова инструментов", () => {
  const state = play([
    { event: "stage", data: { stage: "tool", tool: "get_schedule" } },
    { event: "stage", data: { stage: "tool", tool: "find_free_slots" } },
  ]);
  assert.deepEqual(state.stages, ["get_schedule", "find_free_slots"]);
  assert.equal(state.status, "thinking");
});

test("стадия без имени инструмента ничего не меняет", () => {
  const state = play([{ event: "stage", data: { stage: "tool" } }]);
  assert.deepEqual(state.stages, []);
  assert.equal(state.status, "idle");
});

test("инструменту находится человеческое название", () => {
  assert.equal(stageLabel("propose_load_reduction"), "Разгружаю день");
  assert.equal(stageLabel("неизвестный"), "Работаю");
});

test("предложение доезжает до состояния", () => {
  const state = play([
    { event: "revision", data: { id: "rev-1", status: "proposed" } },
    { event: "content", data: { text: "Предложил перенос." } },
    { event: "done", data: { has_revision: true } },
  ]);
  assert.equal(state.revision?.id, "rev-1");
  assert.equal(state.answer, "Предложил перенос.");
  assert.equal(state.status, "done");
});

test("разобранная занятость приходит отдельно от предложения", () => {
  const state = play([
    {
      event: "commitments",
      data: { items: [{ title: "Школа", kind: "school", weekday: 0 }] },
    },
    { event: "done", data: {} },
  ]);
  assert.equal(state.commitments?.length, 1);
  assert.equal(state.commitments?.[0].title, "Школа");
  assert.equal(state.revision, null);
});

test("ошибка не стирает уже полученное предложение", () => {
  // Ревизия к этому моменту уже создана на сервере. Спрятать её из-за сбоя на
  // последнем шаге значило бы потерять готовое изменение.
  const state = play([
    { event: "revision", data: { id: "rev-1", status: "proposed" } },
    { event: "error", data: { error: "модель отвалилась" } },
  ]);
  assert.equal(state.status, "error");
  assert.equal(state.error, "модель отвалилась");
  assert.equal(state.revision?.id, "rev-1");
});

test("ошибка без текста всё равно объясняется человеку", () => {
  const state = play([{ event: "error", data: {} }]);
  assert.equal(state.status, "error");
  assert.ok(state.error && state.error.length > 0);
});

test("сбой сети завершает thinking и сохраняет готовое предложение", () => {
  const thinking: AssistantState = {
    ...initialAssistantState,
    status: "thinking",
    stages: ["get_schedule"],
    revision: { id: "rev-1", status: "proposed" } as AssistantState["revision"],
  };

  const failed = failAssistantRequest(thinking, new TypeError("Failed to fetch"));

  assert.equal(failed.status, "error");
  assert.match(failed.error ?? "", /попробуй ещё раз/i);
  assert.equal(failed.revision?.id, "rev-1");
  assert.deepEqual(failed.stages, ["get_schedule"]);
});

test("отмена запроса не оставляет помощника в thinking", () => {
  const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
  const failed = failAssistantRequest(
    { ...initialAssistantState, status: "thinking" },
    abortError,
  );

  assert.equal(failed.status, "error");
  assert.match(failed.error ?? "", /отменён/i);
});

test("неизвестное событие не ломает состояние", () => {
  const state = play([
    { event: "content", data: { text: "ответ" } },
    { event: "телепатия", data: { что: "то" } },
  ]);
  assert.equal(state.answer, "ответ");
  assert.equal(state.status, "thinking");
});

test("ответ без инструментов не выдумывает стадий", () => {
  const state = play([
    { event: "content", data: { text: "У тебя три занятия." } },
    { event: "done", data: { has_revision: false } },
  ]);
  assert.deepEqual(state.stages, []);
  assert.equal(state.revision, null);
  assert.equal(state.status, "done");
});

test("редьюсер чистый: исходное состояние не мутируется", () => {
  const before = JSON.stringify(initialAssistantState);
  play([
    { event: "stage", data: { tool: "get_schedule" } },
    { event: "content", data: { text: "ответ" } },
  ]);
  assert.equal(JSON.stringify(initialAssistantState), before);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import { applyAll, dismissAll, undoAll } from "./assistant-batch.ts";
import type { AssistantProposal, ProposalUndo } from "./assistant-proposal.ts";

const habit = (id: string, state?: AssistantProposal["state"]) =>
  ({ id, kind: "new_habit", name: id, goal_id: null, goal_title: null, state }) as AssistantProposal;
const windows = (id: string, state?: AssistantProposal["state"]) =>
  ({ id, kind: "study_windows", windows: [], replace: false, current: [], template_id: "t", state }) as AssistantProposal;

function setup() {
  const called: string[] = [];
  const changes: [string, Partial<AssistantProposal>][] = [];
  return {
    called,
    changes,
    onChange: (id: string, patch: Partial<AssistantProposal>) => changes.push([id, patch]),
    apply: async (proposal: AssistantProposal): Promise<ProposalUndo> => {
      called.push(proposal.id);
      return { habitIds: [called.length] };
    },
    undo: async (proposal: AssistantProposal) => {
      called.push(proposal.id);
    },
  };
}

const never = () => false;
const late = new Error("опоздало");
const isLate = (error: unknown) => error === late;

test("пишет по порядку и сохраняет каждое решение", async () => {
  const { called, changes, onChange, apply } = setup();

  const failure = await applyAll([habit("a"), habit("b"), habit("c")], apply, onChange, never);

  assert.equal(failure, null);
  assert.deepEqual(called, ["a", "b", "c"]);
  assert.deepEqual(changes[0], ["a", { state: "applied", undo: { habitIds: [1] } }]);
  assert.equal(changes.length, 3);
});

test("останавливается на первом сбое", async () => {
  const { called, changes, onChange } = setup();
  const boom = new Error("нет связи");
  const apply = async (proposal: AssistantProposal): Promise<ProposalUndo> => {
    called.push(proposal.id);
    if (proposal.id === "b") throw boom;
    return {};
  };

  const failure = await applyAll([habit("a"), habit("b"), habit("c")], apply, onChange, never);

  assert.deepEqual(called, ["a", "b"]);
  assert.equal(failure?.proposal.id, "b");
  assert.equal(failure?.error, boom);
  assert.deepEqual(changes, [["a", { state: "applied", undo: {} }]]);
});

test("устаревшее пропускается и названо", async () => {
  const { called, changes, onChange } = setup();
  const apply = async (proposal: AssistantProposal): Promise<ProposalUndo> => {
    called.push(proposal.id);
    if (proposal.id === "b") throw late;
    return {};
  };

  const failure = await applyAll([habit("a"), habit("b"), habit("c")], apply, onChange, isLate);

  assert.equal(failure, null);
  assert.deepEqual(called, ["a", "b", "c"]);
  assert.deepEqual(changes[1], ["b", { state: "stale" }]);
});

test("уже применённое не пишется второй раз", async () => {
  const { called, onChange, apply } = setup();

  await applyAll([habit("a", "applied"), habit("b")], apply, onChange, never);

  assert.deepEqual(called, ["b"]);
});

test("отмена идёт в обратном порядке", async () => {
  const { called, changes, onChange, undo } = setup();

  const failure = await undoAll([habit("a", "applied"), habit("b", "applied"), habit("c", "applied")], undo, onChange, never);

  assert.equal(failure, null);
  assert.deepEqual(called, ["c", "b", "a"]);
  assert.deepEqual(changes[0], ["c", { state: "undone" }]);
});

test("отмена пропускает то, что вернуть нельзя и что не применялось", async () => {
  const { called, onChange, undo } = setup();

  await undoAll([habit("a", "applied"), windows("b", "applied"), habit("c")], undo, onChange, never);

  assert.deepEqual(called, ["a"]);
});

test("сбой отмены останавливает её и называет, где", async () => {
  const { called, changes, onChange } = setup();
  const undo = async (proposal: AssistantProposal) => {
    called.push(proposal.id);
    if (proposal.id === "b") throw new Error("нет связи");
  };

  const failure = await undoAll([habit("a", "applied"), habit("b", "applied"), habit("c", "applied")], undo, onChange, never);

  assert.equal(failure?.proposal.id, "b");
  assert.deepEqual(called, ["c", "b"]);
  assert.deepEqual(changes, [["c", { state: "undone" }]]);
});

test("«Не надо» убирает только то, что ещё ждёт", async () => {
  const { called, changes, onChange, undo } = setup();

  const failure = await dismissAll([habit("a", "applied"), habit("b"), habit("c")], undo, onChange, never);

  assert.equal(failure, null);
  assert.deepEqual(called, ["b", "c"]);
  assert.deepEqual(changes, [
    ["b", { state: "dismissed" }],
    ["c", { state: "dismissed" }],
  ]);
});

test("устаревшее при отмене не мешает вернуть остальное", async () => {
  const { called, changes, onChange } = setup();
  const undo = async (proposal: AssistantProposal) => {
    called.push(proposal.id);
    if (proposal.id === "b") throw late;
  };

  const failure = await undoAll([habit("a", "applied"), habit("b", "applied"), habit("c", "applied")], undo, onChange, isLate);

  assert.equal(failure, null);
  assert.deepEqual(called, ["c", "b", "a"]);
  assert.deepEqual(changes[1], ["b", { state: "stale" }]);
});

test("устаревшее при «Не надо» не мешает убрать остальное", async () => {
  const { changes, onChange } = setup();
  const dismiss = async (proposal: AssistantProposal) => {
    if (proposal.id === "a") throw late;
  };

  const failure = await dismissAll([habit("a"), habit("b")], dismiss, onChange, isLate);

  assert.equal(failure, null);
  assert.deepEqual(changes, [
    ["a", { state: "stale" }],
    ["b", { state: "dismissed" }],
  ]);
});

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  matchingScheduleCommands,
  moveCommandSelection,
  parseScheduleCommand,
  resolveScheduleSubmission,
  scheduleCommands,
  slashQuery,
} from "./schedule-commands.ts";

test("slash menu открывается только для первого токена", () => {
  assert.equal(slashQuery("/"), "/");
  assert.equal(slashQuery("  /sta"), "/sta");
  assert.equal(slashQuery("покажи /plan"), null);
  assert.equal(slashQuery("/plan завтра"), null);
});

test("autocomplete находит основную команду и alias без учёта регистра", () => {
  assert.deepEqual(
    matchingScheduleCommands("/START-P", false).map((item) => item.id),
    ["start"],
  );
  assert.deepEqual(
    matchingScheduleCommands("/p", true).map((item) => item.id),
    ["plan"],
  );
});

test("доступность команд зависит от наличия расписания", () => {
  const empty = scheduleCommands(false);
  assert.equal(empty.find((item) => item.id === "start")?.available, true);
  assert.equal(empty.find((item) => item.id === "plan")?.available, false);

  const existing = scheduleCommands(true);
  assert.equal(existing.find((item) => item.id === "start")?.available, false);
  assert.equal(existing.find((item) => item.id === "plan")?.available, true);

  const draft = scheduleCommands(true, true);
  assert.equal(draft.find((item) => item.id === "start")?.available, true);
  assert.equal(draft.find((item) => item.id === "plan")?.available, true);
});

test("parser отделяет slash-команду от аргумента и не ловит похожие слова", () => {
  assert.deepEqual(parseScheduleCommand("/plan разгрузи среду"), {
    id: "plan",
    command: "/plan",
    argument: "разгрузи среду",
  });
  assert.deepEqual(parseScheduleCommand("/START_PLAN"), {
    id: "start",
    command: "/start",
    argument: "",
  });
  assert.equal(parseScheduleCommand("обычный вопрос"), null);
  assert.equal(parseScheduleCommand("/план"), null);
  assert.equal(parseScheduleCommand("/планета"), null);
});

test("клавиатурная навигация циклична", () => {
  assert.equal(moveCommandSelection(-1, "ArrowDown", 2), 0);
  assert.equal(moveCommandSelection(1, "ArrowDown", 2), 0);
  assert.equal(moveCommandSelection(0, "ArrowUp", 2), 1);
  assert.equal(moveCommandSelection(0, "ArrowUp", 0), -1);
});

test("slash-токен не попадает в сообщение модели", () => {
  assert.deepEqual(
    resolveScheduleSubmission("/plan разгрузи среду", "advice", true),
    { kind: "message", message: "разгрузи среду", mode: "plan" },
  );
  assert.deepEqual(resolveScheduleSubmission("/plan", "advice", true), {
    kind: "arm_plan",
  });
  assert.deepEqual(
    resolveScheduleSubmission("оцени неделю", "advice", true),
    { kind: "message", message: "оцени неделю", mode: "advice" },
  );
});

test("недоступная и неизвестная команда остаются локальными ошибками", () => {
  assert.equal(
    resolveScheduleSubmission("/plan перенеси", "advice", false).kind,
    "error",
  );
  assert.equal(
    resolveScheduleSubmission("/start", "advice", true).kind,
    "error",
  );
  assert.equal(
    resolveScheduleSubmission("/unknown", "advice", true).kind,
    "error",
  );
});

test("/start может перестроить ещё не подтверждённый setup-черновик", () => {
  assert.deepEqual(
    resolveScheduleSubmission("/start", "advice", true, true),
    { kind: "start" },
  );
});

test("выбранный /plan действует только на следующее сообщение", () => {
  const armed = resolveScheduleSubmission("перенеси урок", "plan", true);
  assert.deepEqual(armed, {
    kind: "message",
    message: "перенеси урок",
    mode: "plan",
  });
  // После отправки composer сбрасывает pendingMode в advice.
  const next = resolveScheduleSubmission("а нагрузка нормальная?", "advice", true);
  assert.equal(next.kind, "message");
  if (next.kind === "message") assert.equal(next.mode, "advice");
});

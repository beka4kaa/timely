import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_SCHEDULE_MODE,
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
    matchingScheduleCommands("/START-P").map((item) => item.id),
    ["start"],
  );
  assert.deepEqual(
    matchingScheduleCommands("/p").map((item) => item.id),
    ["plan"],
  );
});

test("все команды есть и без расписания: первое создаёт сам помощник", () => {
  assert.deepEqual(
    scheduleCommands().map((item) => item.id),
    ["start", "plan", "advice"],
  );
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
    resolveScheduleSubmission("/plan разгрузи среду", "advice"),
    { kind: "message", message: "разгрузи среду", mode: "plan" },
  );
  assert.deepEqual(resolveScheduleSubmission("/plan", "advice"), {
    kind: "arm_plan",
  });
  assert.deepEqual(
    resolveScheduleSubmission("оцени неделю", "advice"),
    { kind: "message", message: "оцени неделю", mode: "advice" },
  );
});

test("неизвестная команда остаётся локальной ошибкой", () => {
  assert.equal(resolveScheduleSubmission("/start", "advice").kind, "start");
  assert.equal(resolveScheduleSubmission("/unknown", "advice").kind, "error");
});

test("/start может перестроить ещё не подтверждённый setup-черновик", () => {
  assert.deepEqual(
    resolveScheduleSubmission("/start", "advice"),
    { kind: "start" },
  );
});

test("обычное сообщение готовит изменение, совет только по команде", () => {
  assert.equal(DEFAULT_SCHEDULE_MODE, "plan");
  assert.deepEqual(
    resolveScheduleSubmission("перенеси физику", DEFAULT_SCHEDULE_MODE),
    { kind: "message", message: "перенеси физику", mode: "plan" },
  );
  assert.deepEqual(resolveScheduleSubmission("/advice оцени неделю", "plan"), {
    kind: "message",
    message: "оцени неделю",
    mode: "advice",
  });
  assert.deepEqual(resolveScheduleSubmission("/advice", "plan"), {
    kind: "arm_advice",
  });
  assert.equal(resolveScheduleSubmission("/совет", "plan").kind, "arm_advice");
  assert.deepEqual(
    matchingScheduleCommands("/ad").map((item) => item.id),
    ["advice"],
  );
});

test("пустой календарь не мешает: /plan с просьбой идёт в модель", () => {
  assert.deepEqual(resolveScheduleSubmission("/plan добавь русский", "advice"), {
    kind: "message",
    message: "добавь русский",
    mode: "plan",
  });
});

test("выбранный /plan действует только на следующее сообщение", () => {
  const armed = resolveScheduleSubmission("перенеси урок", "plan");
  assert.deepEqual(armed, {
    kind: "message",
    message: "перенеси урок",
    mode: "plan",
  });
  // После отправки composer сбрасывает pendingMode в advice.
  const next = resolveScheduleSubmission("а нагрузка нормальная?", "advice");
  assert.equal(next.kind, "message");
  if (next.kind === "message") assert.equal(next.mode, "advice");
});

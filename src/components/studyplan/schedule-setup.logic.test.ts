import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeScheduleSetupAnswer,
  prepareScheduleSetupAnswer,
  scheduleSetupSummaryRows,
} from "./schedule-setup.logic.ts";

test("подписанный вариант дней уходит на сервер без free-form нормализации", () => {
  assert.deepEqual(
    prepareScheduleSetupAnswer("weekdays", "alternate", "option"),
    { ok: true, value: "alternate" },
  );
  assert.equal(
    prepareScheduleSetupAnswer("weekdays", "alternate", "other").ok,
    false,
  );
});

test("дни недели принимают привычные русские сокращения", () => {
  assert.deepEqual(normalizeScheduleSetupAnswer("weekdays", "пт, пн и ср."), {
    ok: true,
    value: "0,2,4",
  });
});

test("неизвестный день не уходит на сервер", () => {
  assert.equal(normalizeScheduleSetupAnswer("weekdays", "пн, когда смогу").ok, false);
});

test("время нормализуется в HH:MM", () => {
  assert.deepEqual(normalizeScheduleSetupAnswer("start_time", "7:05"), {
    ok: true,
    value: "07:05",
  });
  assert.equal(normalizeScheduleSetupAnswer("start_time", "25:10").ok, false);
});

test("своя длительность ограничена безопасным диапазоном", () => {
  assert.deepEqual(normalizeScheduleSetupAnswer("session_minutes", " 35 "), {
    ok: true,
    value: "35",
  });
  assert.equal(normalizeScheduleSetupAnswer("session_minutes", "10").ok, false);
  assert.equal(normalizeScheduleSetupAnswer("session_minutes", "30.5").ok, false);
});

test("итог показывает читаемый ритм недели", () => {
  const rows = scheduleSetupSummaryRows({
    course_plan_id: "plan-1",
    course_title: "Алгебра",
    weekdays: [0, 2, 4],
    weekday_labels: ["Пн", "Ср", "Пт"],
    start_time: "17:00",
    session_minutes: 45,
    sessions_per_week: 3,
    minutes_per_week: 135,
    timezone: "Asia/Bishkek",
    start_date: "2026-08-12",
  });

  assert.deepEqual(rows.at(-1), {
    label: "В неделю",
    value: "3 занятия · 135 мин",
  });
});

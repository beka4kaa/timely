import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoursePlanSummary } from "../../lib/curriculum-api.ts";
import type { StudySchedule } from "../../lib/studyplan-api.ts";
import {
  buildScheduleTargetOptions,
  resolveScheduleTarget,
  scheduleStatusLabel,
} from "./schedule-targets.ts";

function schedule(
  id: string,
  coursePlan: string,
  status: StudySchedule["status"],
  version: number,
  createdAt = "2026-08-12T00:00:00Z",
): StudySchedule {
  return {
    id,
    course_plan: coursePlan,
    template: "template",
    start_date: "2026-08-10",
    end_date: "2026-09-10",
    timezone: "Asia/Bishkek",
    status,
    version,
    generation_source: "test",
    scheduling_version: "1",
    pacing_snapshot: {},
    conflict_report: {},
    warnings: [],
    feasible: true,
    setup_restartable: false,
    confirmed_at: null,
    created_at: createdAt,
    updated_at: "2026-08-12T00:00:00Z",
  };
}

function plan(id: string, title: string): CoursePlanSummary {
  return {
    id,
    goal: "goal",
    document: null,
    material: null,
    title,
    status: "active",
    estimated_total_minutes: 60,
    forecast_finish_date: null,
    current_version: 1,
    created_at: "2026-08-12T00:00:00Z",
  };
}

test("selector сохраняет active и proposed варианты одного курса", () => {
  const result = buildScheduleTargetOptions(
    [
      schedule("active", "physics", "active", 1, "2026-08-11T10:00:00Z"),
      schedule("proposal", "physics", "proposed", 1, "2026-08-12T10:00:00Z"),
    ],
    [plan("physics", "Физика")],
  );

  assert.deepEqual(
    result.map(({ id, title, statusLabel }) => ({ id, title, statusLabel })),
    [
      { id: "proposal", title: "Физика", statusLabel: "Предложение" },
      { id: "active", title: "Физика", statusLabel: "Активное" },
    ],
  );
});

test("архивные и завершённые расписания не становятся target", () => {
  const result = buildScheduleTargetOptions(
    [
      schedule("draft", "math", "draft", 4),
      schedule("archived", "math", "archived", 3),
      schedule("completed", "math", "completed", 2),
    ],
    [plan("math", "Алгебра")],
  );

  assert.deepEqual(result.map((item) => item.id), ["draft"]);
  assert.equal(scheduleStatusLabel("draft"), "Черновик");
});

test("варианты сортируются по названию программы и дате создания", () => {
  const result = buildScheduleTargetOptions(
    [
      schedule("physics", "physics", "active", 1),
      schedule("algebra-old", "algebra", "active", 1, "2026-08-11T00:00:00Z"),
      schedule("algebra-new", "algebra", "proposed", 1, "2026-08-12T00:00:00Z"),
    ],
    [plan("physics", "Физика"), plan("algebra", "Алгебра")],
  );

  assert.deepEqual(result.map((item) => item.id), [
    "algebra-new",
    "algebra-old",
    "physics",
  ]);
});

test("выбранный target синхронно меняет календарь и CTA подтверждения", () => {
  const options = buildScheduleTargetOptions(
    [
      schedule("active", "physics", "active", 1),
      schedule("proposal", "physics", "proposed", 1),
      schedule("math", "math", "active", 1),
    ],
    [plan("physics", "Физика"), plan("math", "Алгебра")],
  );
  const blocks = {
    active: ["старое"],
    proposal: ["новое"],
    math: ["математика"],
  };

  const active = resolveScheduleTarget("active", options, blocks, [
    "active",
    "math",
  ]);
  assert.deepEqual(active.blocks, ["старое", "математика"]);
  assert.equal(active.proposalId, null);

  const proposal = resolveScheduleTarget("proposal", options, blocks, [
    "active",
    "math",
  ]);
  assert.deepEqual(proposal.blocks, ["новое", "математика"]);
  assert.equal(proposal.proposalId, "proposal");
});

test("исчезнувший target безопасно возвращается к доступному варианту", () => {
  const options = buildScheduleTargetOptions(
    [schedule("old", "physics", "active", 1)],
    [plan("physics", "Физика")],
  );
  const resolved = resolveScheduleTarget("missing", options, { old: ["старое"] });
  assert.equal(resolved.option?.id, "old");
  assert.deepEqual(resolved.blocks, ["старое"]);
});

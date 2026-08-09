import assert from "node:assert/strict";
import { test } from "node:test";

// Расширение указано намеренно — см. комментарий в
// src/lib/image-model-selection.test.ts.
import {
  forecastWarningMessage,
  paceAdvice,
  parseForecast,
  rhythmLine,
  riskLabel,
} from "./curriculum-forecast.ts";

const FULL = {
  sessions_per_week: 3,
  minutes_per_session: 45,
  estimated_sessions: 24,
  effective_minutes: 1080,
  estimated_finish_date: "2026-05-20",
  optimistic_finish_date: "2026-04-28",
  realistic_finish_date: "2026-05-20",
  risk: "medium",
  desired_deadline_feasible: false,
  required_sessions_per_week: 5,
  warnings: ["horizon_exceeded"],
};

test("полный прогноз разбирается целиком", () => {
  const parsed = parseForecast(FULL);
  assert.ok(parsed);
  assert.equal(parsed.sessionsPerWeek, 3);
  assert.equal(parsed.optimisticFinishDate, "2026-04-28");
  assert.equal(parsed.risk, "medium");
  assert.deepEqual(parsed.warnings, ["horizon_exceeded"]);
});

test("пустой объект — это отсутствие прогноза, а не пустая панель", () => {
  assert.equal(parseForecast({}), null);
  assert.equal(parseForecast(null), null);
  assert.equal(parseForecast(undefined), null);
  assert.equal(parseForecast([]), null);
  assert.equal(parseForecast("нет"), null);
});

test("null в desired_deadline_feasible доживает как null", () => {
  const parsed = parseForecast({ ...FULL, desired_deadline_feasible: null });
  assert.ok(parsed);
  assert.equal(
    parsed.desiredDeadlineFeasible,
    null,
    "срок не задавали — говорить «не успеваете» нельзя",
  );
});

test("три значения признака различимы", () => {
  assert.equal(parseForecast({ ...FULL, desired_deadline_feasible: true })?.desiredDeadlineFeasible, true);
  assert.equal(parseForecast({ ...FULL, desired_deadline_feasible: false })?.desiredDeadlineFeasible, false);
  assert.equal(parseForecast({ ...FULL, desired_deadline_feasible: 0 })?.desiredDeadlineFeasible, null);
});

test("мусор в числах и датах отбрасывается, а не показывается", () => {
  const parsed = parseForecast({
    ...FULL,
    sessions_per_week: 0,
    minutes_per_session: Number.NaN,
    estimated_finish_date: "   ",
    risk: "катастрофа",
    warnings: ["ok", 42, null],
  });
  assert.ok(parsed);
  assert.equal(parsed.sessionsPerWeek, null);
  assert.equal(parsed.minutesPerSession, null);
  assert.equal(parsed.estimatedFinishDate, null);
  assert.equal(parsed.risk, null);
  assert.deepEqual(parsed.warnings, ["ok"]);
});

test("одни предупреждения без чисел — всё ещё прогноз", () => {
  const parsed = parseForecast({ warnings: ["forecast_not_possible"] });
  assert.ok(parsed);
  assert.deepEqual(parsed.warnings, ["forecast_not_possible"]);
});

test("предупреждения переводятся, а неизвестный код показывается как есть", () => {
  assert.match(forecastWarningMessage("horizon_exceeded"), /пять лет/);
  assert.match(forecastWarningMessage("deadline_unreachable_at_any_pace"), /Сдвиньте срок/);
  assert.equal(forecastWarningMessage("unknown_code"), "unknown_code");
});

test("слово «невозможно» в предупреждениях не употребляется", () => {
  for (const code of [
    "horizon_exceeded",
    "deadline_unreachable_at_any_pace",
    "sessions_per_week_capped_by_available_days",
  ]) {
    assert.doesNotMatch(forecastWarningMessage(code), /невозможн/i);
  }
});

test("риск всегда имеет текстовую подпись", () => {
  assert.equal(typeof riskLabel("low"), "string");
  assert.equal(typeof riskLabel("medium"), "string");
  assert.equal(typeof riskLabel("high"), "string");
});

test("ритм склоняется правильно и молчит без данных", () => {
  assert.equal(rhythmLine(1, 45), "1 занятие в неделю по 45 минут");
  assert.equal(rhythmLine(3, 45), "3 занятия в неделю по 45 минут");
  assert.equal(rhythmLine(5, 45), "5 занятий в неделю по 45 минут");
  assert.equal(rhythmLine(null, 45), null);
  assert.equal(rhythmLine(3, null), null);
});

test("совет по темпу ведёт с действия и появляется только при провале срока", () => {
  const failing = parseForecast(FULL);
  assert.ok(failing);
  const advice = paceAdvice(failing, "2026-05-01");
  assert.ok(advice);
  assert.match(advice, /Чтобы успеть/);
  assert.match(advice, /5 занятий в неделю вместо 3/);

  const ok = parseForecast({ ...FULL, desired_deadline_feasible: true });
  assert.ok(ok);
  assert.equal(paceAdvice(ok, "2026-05-01"), null);

  const noDeadline = parseForecast({ ...FULL, desired_deadline_feasible: null });
  assert.ok(noDeadline);
  assert.equal(paceAdvice(noDeadline, null), null);
});

test("без достижимого темпа совет молчит вместо выдумки", () => {
  const parsed = parseForecast({ ...FULL, required_sessions_per_week: null });
  assert.ok(parsed);
  assert.equal(paceAdvice(parsed, "2026-05-01"), null);
});

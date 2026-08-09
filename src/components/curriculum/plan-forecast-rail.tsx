// Прогноз: успею ли я. Тихая правая колонка.
//
// На странице один герой — корешок. Поэтому здесь нет ни одного крупного
// числа: вердикт по срокам набран обычным текстом. Первая версия ставила рядом
// два героя (полоса и большая дата), и это ровно тот дефолт, к которому
// приходит любая генерация: большое число, мелкая подпись, акцентный градиент.
//
// Три даты вместо одной — потому что разброс честнее псевдоточности: буфер на
// пропуски встроен в расчёт, и делать вид, что дата одна, значит обещать то,
// чего расчёт не утверждает.

"use client";

import type { CoursePlan, LearningGoal } from "@/lib/curriculum-api";
import {
  forecastWarningMessage,
  formatPlanDate,
  formatShortDate,
  paceAdvice,
  parseForecast,
  rhythmLine,
  riskLabel,
  sessionsCountLabel,
} from "@/lib/curriculum-forecast";
import { formatMinutes } from "@/lib/curriculum-progress";
import { paperCaption, paperCard, paperNumber } from "./paper";

/** Раскладка трёх дат по одной микрошкале. */
function scalePositions(dates: (string | null)[]): number[] {
  const times = dates.map((iso) => (iso ? new Date(iso).getTime() : Number.NaN));
  const valid = times.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return dates.map(() => 0);
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = max - min;
  return times.map((value) => {
    if (!Number.isFinite(value)) return 0;
    return span === 0 ? 50 : ((value - min) / span) * 100;
  });
}

export function PlanForecastRail({
  plan,
  goal,
}: {
  plan: CoursePlan;
  goal: LearningGoal | null;
}) {
  const forecast = parseForecast(plan.forecast);

  // Прогноза нет — рисуем из настоящих колонок плана, а не пустую рамку.
  const sessionsPerWeek = forecast?.sessionsPerWeek ?? plan.recommended_sessions_per_week;
  const minutesPerSession =
    forecast?.minutesPerSession ?? plan.recommended_session_minutes;
  const rhythm = rhythmLine(sessionsPerWeek || null, minutesPerSession || null);

  const optimistic = forecast?.optimisticFinishDate ?? null;
  const expected = forecast?.estimatedFinishDate ?? plan.forecast_finish_date;
  const realistic = forecast?.realisticFinishDate ?? null;
  const dates = [optimistic, expected, realistic];
  const positions = scalePositions(dates);
  const labels = ["Оптимистично", "Ожидаемо", "С запасом"];
  const hasDates = dates.some(Boolean);

  const deadline = goal?.desired_finish_date ?? null;
  const advice = forecast ? paceAdvice(forecast, deadline) : null;
  const feasible = forecast?.desiredDeadlineFeasible ?? null;

  return (
    <aside className={`${paperCard} p-5`}>
      <p className={paperCaption}>Сроки</p>

      <p className="mt-3 text-[13px] leading-6 text-[#4a443d]">
        {rhythm ?? "Ритм занятий пока не рассчитан."}
      </p>
      <p className="mt-1 text-[12px] text-[#7f776e]">
        Всего{" "}
        <span className={paperNumber}>
          {formatMinutes(plan.estimated_total_minutes)}
        </span>
        {forecast?.estimatedSessions ? (
          <>
            {" · "}
            <span className={paperNumber}>
              {sessionsCountLabel(forecast.estimatedSessions)}
            </span>
          </>
        ) : null}
      </p>

      {hasDates && (
        <div className="mt-5 border-t border-[#e7e1d7] pt-4">
          <div className="relative h-[3px] rounded-full bg-[#e9e2d7]">
            {dates.map((iso, index) =>
              iso ? (
                <span
                  key={`${labels[index]}-${iso}`}
                  aria-hidden
                  className="absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{
                    left: `${positions[index]}%`,
                    background: index === 1 ? "#8a5b24" : "#c3b7a5",
                  }}
                />
              ) : null,
            )}
          </div>
          <dl className="mt-3 space-y-1.5">
            {dates.map((iso, index) =>
              iso ? (
                <div
                  key={`${labels[index]}-row`}
                  className="flex items-baseline justify-between gap-3"
                >
                  <dt className="text-[11px] text-[#9b9186]">{labels[index]}</dt>
                  <dd
                    className={`${paperNumber} text-[13px] ${
                      index === 1 ? "text-[#302b26]" : "text-[#7f776e]"
                    }`}
                  >
                    {formatShortDate(iso)}
                  </dd>
                </div>
              ) : null,
            )}
          </dl>
        </div>
      )}

      {/* Блок срока появляется, только когда срок вообще задавали: `null` в
          `desired_deadline_feasible` — это «не спрашивали», а не «не успеете». */}
      {feasible !== null && (
        <div
          className={`mt-5 rounded-[12px] border p-3.5 ${
            feasible
              ? "border-[#d9d2c6] bg-[#fbf8f2]"
              : "border-[#e0cba8] bg-[#fdf6e8]"
          }`}
        >
          <p className="text-[12px] font-medium text-[#3b352e]">
            {feasible
              ? `Успеваете к ${formatPlanDate(deadline)}`
              : `К ${formatPlanDate(deadline)} при таком темпе не выходит`}
          </p>
          {advice && (
            <p className="mt-1 text-[12px] leading-5 text-[#6f675e]">{advice}</p>
          )}
        </div>
      )}

      {forecast?.risk && (
        <p className="mt-4 flex items-center gap-2 text-[11px] text-[#7f776e]">
          <span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full"
            style={{
              background:
                forecast.risk === "low"
                  ? "#8a9a6b"
                  : forecast.risk === "medium"
                    ? "#c08a3e"
                    : "#b0673c",
            }}
          />
          {/* Точка риска всегда с текстовой подписью: цветом одним не говорим. */}
          {riskLabel(forecast.risk)}
        </p>
      )}

      {forecast && forecast.warnings.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-[#e7e1d7] pt-3">
          {forecast.warnings.map((code) => (
            <li key={code} className="text-[11px] leading-5 text-[#8b7a5e]">
              {forecastWarningMessage(code)}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}

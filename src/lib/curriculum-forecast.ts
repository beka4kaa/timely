// Разбор `CoursePlan.forecast` — ответа на главный вопрос ученика «успею ли я».
//
// Поле объявлено как `JSONField(default=dict)`, то есть по умолчанию это пустой
// объект, а не `null`. Поэтому «прогноза нет» и «прогноз пустой» — одно и то
// же, и разбор обязан вернуть `null`, чтобы страница не рисовала пустую рамку.
//
// Критическое правило: `desired_deadline_feasible` ТРЁХЗНАЧЕН. `null` значит
// «срок не задавали». Привести его к `false` — заявить «не успеваете» там, где
// сроков вообще не было; привести к `true` — ещё хуже. `null` обязан дожить до
// компонента как `null`.

export type ForecastRisk = "low" | "medium" | "high";

export interface PlanForecast {
  sessionsPerWeek: number | null;
  minutesPerSession: number | null;
  estimatedSessions: number | null;
  effectiveMinutes: number | null;
  estimatedFinishDate: string | null;
  optimisticFinishDate: string | null;
  realisticFinishDate: string | null;
  risk: ForecastRisk | null;
  /** null — срок не задавали. Ни в коем случае не false. */
  desiredDeadlineFeasible: boolean | null;
  requiredSessionsPerWeek: number | null;
  warnings: string[];
}

function positiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : null;
}

function isoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function risk(value: unknown): ForecastRisk | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

/** Разбор с проверкой каждого поля. `null` — показывать нечего. */
export function parseForecast(raw: unknown): PlanForecast | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const parsed: PlanForecast = {
    sessionsPerWeek: positiveInt(record.sessions_per_week),
    minutesPerSession: positiveInt(record.minutes_per_session),
    estimatedSessions: positiveInt(record.estimated_sessions),
    effectiveMinutes: positiveInt(record.effective_minutes),
    estimatedFinishDate: isoDate(record.estimated_finish_date),
    optimisticFinishDate: isoDate(record.optimistic_finish_date),
    realisticFinishDate: isoDate(record.realistic_finish_date),
    risk: risk(record.risk),
    desiredDeadlineFeasible:
      typeof record.desired_deadline_feasible === "boolean"
        ? record.desired_deadline_feasible
        : null,
    requiredSessionsPerWeek: positiveInt(record.required_sessions_per_week),
    warnings: Array.isArray(record.warnings)
      ? record.warnings.filter((code): code is string => typeof code === "string")
      : [],
  };

  const hasAnything =
    parsed.sessionsPerWeek !== null ||
    parsed.minutesPerSession !== null ||
    parsed.estimatedSessions !== null ||
    parsed.estimatedFinishDate !== null ||
    parsed.optimisticFinishDate !== null ||
    parsed.realisticFinishDate !== null ||
    parsed.risk !== null ||
    parsed.desiredDeadlineFeasible !== null ||
    parsed.warnings.length > 0;

  return hasAnything ? parsed : null;
}

const WARNINGS: Record<string, string> = {
  // «Невозможно» не пишем: бэкенд ограничивает расчёт пятью годами, и «нет»
  // здесь значит «не при таком темпе», а не «никогда».
  horizon_exceeded:
    "При таком темпе курс выходит за пять лет — дальше расчёт не идёт. Добавьте занятий в неделю.",
  deadline_unreachable_at_any_pace:
    "К этому сроку не успеть даже занимаясь каждый день. Сдвиньте срок или сократите программу.",
  sessions_per_week_capped_by_available_days:
    "Занятий в неделю выбрано больше, чем дней для учёбы — лишние перенесены на следующую неделю.",
  forecast_skipped_zero_duration:
    "У программы нулевая длительность, поэтому прогноз не считался.",
  forecast_not_possible: "Прогноз посчитать не удалось.",
};

export function forecastWarningMessage(code: string): string {
  return WARNINGS[code] ?? code;
}

/** Текстовая подпись риска. Цветом одним риск не показываем никогда. */
export function riskLabel(value: ForecastRisk): string {
  if (value === "low") return "Запас есть";
  if (value === "medium") return "Впритык";
  return "Темп напряжённый";
}

/** Дата человеческим языком: «20 мая 2026». */
export function formatPlanDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Короткая дата для микрошкалы: «20 мая». */
export function formatShortDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function sessionsWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "занятий";
  if (ones === 1) return "занятие";
  if (ones >= 2 && ones <= 4) return "занятия";
  return "занятий";
}

/** «24 занятия», а не «24 занятий». */
export function sessionsCountLabel(count: number): string {
  return `${count} ${sessionsWord(count)}`;
}

/** Ритм словами: «3 занятия в неделю по 45 минут». */
export function rhythmLine(
  sessionsPerWeek: number | null,
  minutesPerSession: number | null,
): string | null {
  if (!sessionsPerWeek || !minutesPerSession) return null;
  return `${sessionsPerWeek} ${sessionsWord(
    sessionsPerWeek,
  )} в неделю по ${minutesPerSession} минут`;
}

/**
 * Что делать, чтобы успеть. Ведём с действия, а не с приговора.
 *
 * Возвращает `null`, когда нужного темпа нет: тогда честнее показать
 * предупреждение `deadline_unreachable_at_any_pace`, чем выдуманный совет.
 */
export function paceAdvice(
  forecast: PlanForecast,
  desiredDeadline: string | null,
): string | null {
  if (forecast.desiredDeadlineFeasible !== false) return null;
  const required = forecast.requiredSessionsPerWeek;
  if (!required) return null;
  const current = forecast.sessionsPerWeek;
  const when = desiredDeadline ? `к ${formatPlanDate(desiredDeadline)}` : "к сроку";
  if (!current) {
    return `Чтобы успеть ${when}, нужно ${required} ${sessionsWord(required)} в неделю.`;
  }
  return `Чтобы успеть ${when}, нужно ${required} ${sessionsWord(
    required,
  )} в неделю вместо ${current}.`;
}

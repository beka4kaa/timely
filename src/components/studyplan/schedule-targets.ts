import type { CoursePlanSummary } from "@/lib/curriculum-api";
import type { StudySchedule } from "@/lib/studyplan-api";

export interface ScheduleTargetOption {
  id: string;
  coursePlanId: string;
  title: string;
  status: StudySchedule["status"];
  statusLabel: string;
  version: number;
  createdAt: string;
  timeZone: string;
  detail: string;
}

export interface ResolvedScheduleTarget<T> {
  option: ScheduleTargetOption | null;
  blocks: readonly T[];
  /** Только выбранный draft/proposed может управлять CTA подтверждения. */
  proposalId: string | null;
}

const STATUS_LABELS: Record<StudySchedule["status"], string> = {
  draft: "Черновик",
  proposed: "Предложение",
  confirmed: "Подтверждено",
  active: "Активное",
  completed: "Завершено",
  archived: "В архиве",
};

export function scheduleStatusLabel(status: StudySchedule["status"]): string {
  return STATUS_LABELS[status];
}

/**
 * Понятные варианты для селектора помощника.
 *
 * В календаре на курс видна одна версия, но помощнику можно явно выбрать и
 * активную, и новое предложение того же курса. Поэтому список строится из
 * несхлопнутого ответа `/study-schedules/`.
 */
export function buildScheduleTargetOptions(
  schedules: readonly StudySchedule[],
  plans: readonly CoursePlanSummary[],
): ScheduleTargetOption[] {
  const planTitles = new Map(plans.map((plan) => [plan.id, plan.title]));

  return schedules
    .filter(
      (schedule) =>
        schedule.status !== "archived" && schedule.status !== "completed",
    )
    .map((schedule) => {
      const statusLabel = scheduleStatusLabel(schedule.status);
      return {
        id: schedule.id,
        coursePlanId: schedule.course_plan,
        title: planTitles.get(schedule.course_plan) ?? "Учебная программа",
        status: schedule.status,
        statusLabel,
        version: schedule.version,
        createdAt: schedule.created_at,
        timeZone: schedule.timezone,
        detail: scheduleTargetDetail(statusLabel, schedule),
      };
    })
    .sort((left, right) => {
      const title = left.title.localeCompare(right.title, "ru");
      if (title !== 0) return title;
      const leftCreated = Date.parse(left.createdAt);
      const rightCreated = Date.parse(right.createdAt);
      if (Number.isFinite(leftCreated) && Number.isFinite(rightCreated)) {
        const created = rightCreated - leftCreated;
        if (created !== 0) return created;
      } else if (Number.isFinite(rightCreated)) {
        return 1;
      } else if (Number.isFinite(leftCreated)) {
        return -1;
      }
      if (left.version !== right.version) return right.version - left.version;
      return left.id.localeCompare(right.id);
    });
}

/** Один target одновременно управляет календарём, CTA и запросами помощника. */
export function resolveScheduleTarget<T>(
  selectedId: string | null,
  options: readonly ScheduleTargetOption[],
  blocksBySchedule: Readonly<Record<string, readonly T[]>>,
  defaultVisibleIds: readonly string[] = [],
): ResolvedScheduleTarget<T> {
  const option =
    options.find((item) => item.id === selectedId) ?? options[0] ?? null;
  const proposalId =
    option?.status === "draft" || option?.status === "proposed"
      ? option.id
      : null;
  const optionById = new Map(options.map((item) => [item.id, item]));
  const displayIds = option
    ? [
        option.id,
        ...defaultVisibleIds.filter((id) => {
          if (id === option.id) return false;
          return optionById.get(id)?.coursePlanId !== option.coursePlanId;
        }),
      ]
    : defaultVisibleIds;
  return {
    option,
    // Выбор варианта заменяет только версию его курса. Остальные курсы
    // остаются на общем календаре — selector не должен превращать его в
    // календарь одного предмета.
    blocks: displayIds.flatMap((id) => blocksBySchedule[id] ?? []),
    proposalId,
  };
}

function scheduleTargetDetail(
  statusLabel: string,
  schedule: StudySchedule,
): string {
  const date = new Date(schedule.created_at);
  const created = Number.isNaN(date.getTime())
    ? ""
    : new Intl.DateTimeFormat("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: schedule.timezone || "UTC",
      }).format(date);
  const version = schedule.version > 1 ? ` · версия ${schedule.version}` : "";
  return `${statusLabel}${created ? ` · ${created}` : ""}${version}`;
}

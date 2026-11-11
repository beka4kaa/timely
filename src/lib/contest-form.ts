// Форма контеста в админке без React: черновик, бюджет баллов и что мешает публикации.
// Сервер проверяет то же самое сам; здесь проверка нужна, чтобы сказать заранее.

import type { AdminContest, AdminContestInput, ContestArtName, ContestFileInfo, ContestTier } from "./contest-api";
import { canSetTier, tierMeta } from "./contest-tiers";
import { ru } from "./contest-view";

export const MAX_TASKS = 20;

export interface TaskDraft {
  /** Ключ строки для React: у новой задачи ещё нет id. */
  key: string;
  id?: number;
  answer: string;
  points: number;
  statement: ContestFileInfo | null;
  solution: ContestFileInfo | null;
  /** Текст условия старой задачи без PDF. Редактор его не меняет. */
  legacyText: string;
}

export interface ContestDraft {
  title: string;
  description: string;
  start: Date;
  end: Date;
  tier: ContestTier;
  art: ContestArtName;
  tasks: TaskDraft[];
}

let keys = 0;

export function emptyTask(): TaskDraft {
  keys += 1;
  return { key: `task-${keys}`, answer: "", points: 10, statement: null, solution: null, legacyText: "" };
}

/** Новый контест: завтра в 11:00 по местному времени на три часа, бронза, кольца. */
export function emptyDraft(now: Date): ContestDraft {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 11, 0, 0, 0);
  return {
    title: "",
    description: "",
    start,
    end: new Date(start.getTime() + 3 * 60 * 60 * 1000),
    tier: 5,
    art: "rings",
    tasks: [emptyTask()],
  };
}

export function draftFromAdmin(contest: AdminContest): ContestDraft {
  return {
    title: contest.title,
    description: contest.description,
    start: new Date(contest.start_time),
    end: new Date(contest.end_time),
    tier: contest.tier,
    art: contest.art,
    tasks: contest.tasks.map((task) => ({
      key: `task-id-${task.id}`,
      id: task.id,
      answer: task.answer,
      points: task.points,
      statement: task.statement,
      solution: task.solution,
      legacyText: task.condition_text,
    })),
  };
}

export function draftToInput(draft: ContestDraft): AdminContestInput {
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    start_time: draft.start.toISOString(),
    end_time: draft.end.toISOString(),
    tier: draft.tier,
    art: draft.art,
    tasks: draft.tasks.map((task) => ({
      ...(task.id ? { id: task.id } : {}),
      answer: task.answer.trim(),
      points: task.points,
      statement_file: task.statement?.id ?? null,
      solution_file: task.solution?.id ?? null,
    })),
  };
}

export function pointsBudget(draft: ContestDraft): { total: number; cap: number; over: number; share: number } {
  const total = draft.tasks.reduce((sum, task) => sum + Math.max(0, Math.round(task.points) || 0), 0);
  const cap = tierMeta(draft.tier).cap;
  return { total, cap, over: Math.max(0, total - cap), share: cap ? Math.min(1, total / cap) : 0 };
}

function hasAnswer(answer: string): boolean {
  return answer.split(";").some((part) => part.trim().length > 0);
}

/** Что мешает опубликовать, теми же словами, что ответит сервер. */
export function publishBlockers(draft: ContestDraft, now: Date, canTopTiers: boolean): string[] {
  const found: string[] = [];
  if (!draft.title.trim()) found.push("Напиши название.");
  if (draft.end.getTime() <= draft.start.getTime()) found.push("Конец должен быть позже начала.");
  else if (draft.end.getTime() <= now.getTime()) found.push("Конец уже прошёл.");
  if (!canSetTier({ is_staff: canTopTiers }, draft.tier)) found.push("Этот тир ставит только владелец.");
  if (!draft.tasks.length) {
    found.push("Добавь хотя бы одну задачу.");
    return found;
  }
  if (draft.tasks.length > MAX_TASKS) {
    found.push(`Задач не больше ${MAX_TASKS}.`);
    return found;
  }
  draft.tasks.forEach((task, index) => {
    const number = index + 1;
    if (!task.statement) found.push(`У задачи ${number} нет PDF условия.`);
    if (!hasAnswer(task.answer)) found.push(`У задачи ${number} нет ответа.`);
    if (!(task.points >= 1)) found.push(`Баллы задачи ${number} от 1.`);
  });
  const budget = pointsBudget(draft);
  if (budget.over > 0 && canSetTier({ is_staff: canTopTiers }, draft.tier)) {
    found.push(`Сумма ${budget.total} больше потолка тира: ${budget.cap}.`);
  }
  return found;
}

/** «Длится 3 часа», «Длится 1 час 30 минут», «Длится 2 дня». */
export function durationLabel(start: Date, end: Date): string {
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000);
  if (minutes <= 0) return "Конец раньше начала";
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  const parts = [
    days ? `${days} ${ru(days, "день", "дня", "дней")}` : "",
    hours ? `${hours} ${ru(hours, "час", "часа", "часов")}` : "",
    rest ? `${rest} ${ru(rest, "минута", "минуты", "минут")}` : "",
  ].filter(Boolean);
  return `Длится ${parts.slice(0, 2).join(" ")}`;
}

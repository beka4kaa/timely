/**
 * studyplan-api.ts — типизированный клиент раздела «План».
 *
 * Ходим напрямую в `BACKEND_URL` через `authFetch`, как `curriculum-api.ts` и
 * `contest-api.ts`. Поля оставлены в snake_case: так их отдаёт DRF, и это
 * снимает слой преобразований вместе с его ошибками.
 *
 * ВАЖНО: у бэкенда `APPEND_SLASH = False`, поэтому КАЖДЫЙ путь заканчивается
 * слешем. Без него DRF-роутер ответит 404.
 */
"use client";

import { BACKEND_URL } from "@/lib/api-utils";
import { authFetch } from "@/lib/auth-fetch";
import type { CalendarBlock } from "@/lib/studyplan-calendar";

const BASE = `${BACKEND_URL}/api`;

// ─────────────────────────────── Типы ────────────────────────────────────────

export type ScheduleStatus =
  | "draft"
  | "proposed"
  | "confirmed"
  | "active"
  | "completed"
  | "archived";

export type BlockStatus =
  | "scheduled"
  | "ready"
  | "in_progress"
  | "paused"
  | "completed"
  | "partially_completed"
  | "missed"
  | "skipped"
  | "rescheduled"
  | "cancelled";

export interface LearningBlock extends CalendarBlock {
  schedule: string;
  course_plan: string;
  module: string | null;
  workspace_type: string;
  end_at: string;
  priority: number;
  status: BlockStatus;
  lesson_payload: Record<string, unknown>;
  mastery_criteria: string;
  source_section_ids: string[];
  source_chunk_ids: string[];
  prerequisite_block_ids: string[];
  review_of_topic: string | null;
  version: number;
}

/** Блок общего календаря с данными его расписания и программы. */
export interface CalendarLearningBlock extends LearningBlock {
  schedule_version: number;
  schedule_status: ScheduleStatus;
  schedule_timezone: string;
  course_plan_title: string;
}

export interface FixedCommitment {
  id: string;
  kind: "school" | "tutor" | "exam" | "family" | "other";
  title: string;
  weekday: number | null;
  start_time: string | null;
  duration_minutes: number;
  valid_from: string | null;
  valid_until: string | null;
  start_at: string | null;
  end_at: string | null;
  source: "manual" | "chat";
  source_text: string;
  created_at: string;
}

export interface ConflictReport {
  feasible: boolean;
  required_minutes: number;
  available_minutes: number;
  unplaced: {
    topic_external_id: string;
    activity_type: string;
    duration_minutes: number;
    reason: string;
  }[];
  overrun_days: number;
  suggestions: string[];
}

export interface StudySchedule {
  id: string;
  course_plan: string;
  template: string;
  start_date: string;
  end_date: string;
  timezone: string;
  status: ScheduleStatus;
  version: number;
  generation_source: string;
  scheduling_version: string;
  pacing_snapshot: Record<string, unknown>;
  /** Пустой объект — расписание вмещает программу. */
  conflict_report: Partial<ConflictReport>;
  warnings: string[];
  feasible: boolean;
  confirmed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleDiffEntry {
  block_id: string;
  title: string;
  from: { start_at: string; end_at: string; duration_minutes: number };
  to: { start_at: string; end_at: string; duration_minutes: number };
}

export interface ScheduleDiff {
  moved: ScheduleDiffEntry[];
  created: ScheduleDiffEntry[];
  removed: ScheduleDiffEntry[];
  shortened: ScheduleDiffEntry[];
  extended: ScheduleDiffEntry[];
}

export interface ScheduleRevision {
  id: string;
  schedule: string;
  base_version: number;
  proposed_version: number;
  requested_by: "student" | "ai" | "system";
  request_text: string;
  reason: string;
  status: "proposed" | "confirmed" | "rejected" | "reverted" | "expired";
  diff: ScheduleDiff;
  impact: {
    blocks_touched?: number;
    finish_before?: string | null;
    finish_after?: string | null;
  };
  created_at: string;
  confirmed_at: string | null;
  reverted_at: string | null;
}

export interface GenerationResult {
  schedule: StudySchedule;
  feasible: boolean;
  warnings: string[];
  blocks_created: number;
}

export interface TemplateSlot {
  id: string;
  weekday: number;
  start_time: string;
  duration_minutes: number;
  allowed_activity_types: string[];
  subject_id: string;
  fixed: boolean;
  priority: number;
}

export interface WeeklyTemplate {
  id: string;
  title: string;
  timezone: string;
  active: boolean;
  valid_from: string | null;
  valid_until: string | null;
  max_minutes_per_day: number;
  max_minutes_per_week: number;
  slots: TemplateSlot[];
}

// ────────────────────────────── Транспорт ────────────────────────────────────

/** Ошибка бэкенда с машиночитаемым кодом. */
export class StudyplanApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;

  constructor(message: string, status: number, code = "", payload: unknown = null) {
    super(message);
    this.name = "StudyplanApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }

  /** Расписание успели изменить в другой вкладке — нужно перечитать календарь. */
  get isStale(): boolean {
    return this.code === "stale_version" || this.code === "stale_revision";
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    const record = (body ?? {}) as Record<string, unknown>;
    const message =
      (typeof record.error === "string" && record.error) ||
      (typeof record.detail === "string" && record.detail) ||
      `Запрос не удался (${response.status})`;
    const code = typeof record.code === "string" ? record.code : "";
    throw new StudyplanApiError(message, response.status, code, body);
  }
  return body as T;
}

function list<T>(body: T[] | { results: T[] }): T[] {
  return Array.isArray(body) ? body : body.results;
}

// ───────────────────────────── Расписания ────────────────────────────────────

export async function listSchedules(coursePlanId?: string): Promise<StudySchedule[]> {
  const query = coursePlanId ? `?course_plan=${encodeURIComponent(coursePlanId)}` : "";
  const response = await authFetch(`${BASE}/study-schedules/${query}`);
  return list(await unwrap<StudySchedule[] | { results: StudySchedule[] }>(response));
}

export async function getSchedule(id: string): Promise<StudySchedule> {
  return unwrap<StudySchedule>(await authFetch(`${BASE}/study-schedules/${id}/`));
}

export async function generateSchedule(input: {
  coursePlanId: string;
  startDate: string;
  endDate?: string;
  timezone: string;
  templateId?: string;
  bufferPercentage?: number;
}): Promise<GenerationResult> {
  const response = await authFetch(`${BASE}/study-schedules/generate/`, {
    method: "POST",
    body: JSON.stringify({
      course_plan: input.coursePlanId,
      start_date: input.startDate,
      ...(input.endDate ? { end_date: input.endDate } : {}),
      timezone: input.timezone,
      ...(input.templateId ? { template: input.templateId } : {}),
      ...(input.bufferPercentage !== undefined
        ? { buffer_percentage: input.bufferPercentage }
        : {}),
    }),
  });
  return unwrap<GenerationResult>(response);
}

export async function confirmSchedule(id: string): Promise<StudySchedule> {
  const response = await authFetch(`${BASE}/study-schedules/${id}/confirm/`, {
    method: "POST",
  });
  return unwrap<StudySchedule>(response);
}

/**
 * Блоки расписания за период.
 *
 * `from`/`to` — календарные даты в зоне РАСПИСАНИЯ: бэкенд читает голую дату
 * как локальную полночь ученика, поэтому недельный вид спрашивает ровно свою
 * неделю и не тащит соседние.
 */
export async function listBlocks(
  scheduleId: string,
  range?: { from: string; to: string },
): Promise<LearningBlock[]> {
  const query = range
    ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
    : "";
  const response = await authFetch(
    `${BASE}/study-schedules/${scheduleId}/blocks/${query}`,
  );
  return unwrap<LearningBlock[]>(response);
}

/**
 * Единая лента блоков пользователя.
 *
 * Бэкенд сам выбирает новейшую видимую версию каждого курса, поэтому старая
 * активная и новое предложение одной программы не дублируются в сетке.
 */
export async function listCalendarBlocks(range: {
  from: string;
  to: string;
  timezone: string;
}): Promise<CalendarLearningBlock[]> {
  const query = new URLSearchParams({
    from: range.from,
    to: range.to,
    timezone: range.timezone,
  });
  const response = await authFetch(`${BASE}/learning-blocks/?${query.toString()}`);
  return list(
    await unwrap<
      CalendarLearningBlock[] | { results: CalendarLearningBlock[] }
    >(response),
  );
}

// ─────────────────────────────── Изменения ───────────────────────────────────

/**
 * Ручной перенос блока: применяется сразу, но остаётся отменяемым.
 *
 * Жест ученика — это уже решение, и требовать после него ещё одно
 * подтверждение значило бы спрашивать дважды об одном. Поэтому изменение
 * применяется, а вернуть как было можно через `undoRevision`.
 */
export async function moveBlock(
  blockId: string,
  input: { startAt: string; durationMinutes?: number; baseVersion?: number },
): Promise<{ block: LearningBlock; revision: ScheduleRevision }> {
  const response = await authFetch(`${BASE}/learning-blocks/${blockId}/`, {
    method: "PATCH",
    body: JSON.stringify({
      start_at: input.startAt,
      ...(input.durationMinutes ? { duration_minutes: input.durationMinutes } : {}),
      ...(input.baseVersion !== undefined ? { base_version: input.baseVersion } : {}),
    }),
  });
  return unwrap<{ block: LearningBlock; revision: ScheduleRevision }>(response);
}

/**
 * Отменить занятия пачкой или вернуть отменённые обратно.
 *
 * «Удалить» занятие нельзя: оно часть учебной программы. Отменённое гаснет,
 * зачёркивается и перестаёт занимать время — поэтому операция обратима, и
 * поэтому же на неё можно вешать Delete без страха.
 */
export async function cancelBlocks(
  blockIds: string[],
  options?: { restore?: boolean },
): Promise<{ changed: string[]; restored: boolean }> {
  const response = await authFetch(`${BASE}/learning-blocks/cancel/`, {
    method: "POST",
    body: JSON.stringify({
      block_ids: blockIds,
      ...(options?.restore ? { restore: true } : {}),
    }),
  });
  return unwrap<{ changed: string[]; restored: boolean }>(response);
}

export async function listRevisions(scheduleId: string): Promise<ScheduleRevision[]> {
  const response = await authFetch(`${BASE}/study-schedules/${scheduleId}/revisions/`);
  return unwrap<ScheduleRevision[]>(response);
}

export async function proposeMoves(
  scheduleId: string,
  input: {
    moves: { blockId: string; startAt: string; durationMinutes?: number }[];
    baseVersion?: number;
    requestText?: string;
    reason?: string;
  },
): Promise<ScheduleRevision> {
  const response = await authFetch(
    `${BASE}/study-schedules/${scheduleId}/revisions/`,
    {
      method: "POST",
      body: JSON.stringify({
        moves: input.moves.map((move) => ({
          block_id: move.blockId,
          start_at: move.startAt,
          ...(move.durationMinutes ? { duration_minutes: move.durationMinutes } : {}),
        })),
        ...(input.baseVersion !== undefined
          ? { base_version: input.baseVersion }
          : {}),
        request_text: input.requestText ?? "",
        reason: input.reason ?? "",
      }),
    },
  );
  return unwrap<ScheduleRevision>(response);
}

async function revisionAction(
  id: string,
  action: "confirm" | "reject" | "undo",
): Promise<ScheduleRevision> {
  const response = await authFetch(`${BASE}/schedule-revisions/${id}/${action}/`, {
    method: "POST",
  });
  return unwrap<ScheduleRevision>(response);
}

export const confirmRevision = (id: string) => revisionAction(id, "confirm");
export const rejectRevision = (id: string) => revisionAction(id, "reject");
export const undoRevision = (id: string) => revisionAction(id, "undo");

// ──────────────────────────── Ритм и занятость ───────────────────────────────

export async function listTemplates(): Promise<WeeklyTemplate[]> {
  const response = await authFetch(`${BASE}/study-templates/`);
  return list(await unwrap<WeeklyTemplate[] | { results: WeeklyTemplate[] }>(response));
}

export interface FixedCommitmentInput {
  title: string;
  kind: string;
  weekday?: number;
  start_time?: string;
  duration_minutes?: number;
  valid_from?: string | null;
  valid_until?: string | null;
  start_at?: string;
  end_at?: string;
}

/**
 * Записать занятое время.
 *
 * Помощник только РАЗБИРАЕТ фразу ученика в структуру; создаёт запись эта
 * функция и только после того, как человек согласился с разбором. Поэтому
 * `source: "chat"` — чтобы в списке было видно, что блок появился из разговора,
 * и ученик мог поправить нас, а не удалять и заводить заново.
 */
export async function createCommitment(
  input: FixedCommitmentInput,
  source: "manual" | "chat" = "manual",
  sourceText = "",
): Promise<{ id: string }> {
  const response = await authFetch(`${BASE}/study-commitments/`, {
    method: "POST",
    body: JSON.stringify({ ...input, source, source_text: sourceText }),
  });
  return unwrap<{ id: string }>(response);
}

export async function listCommitments(): Promise<FixedCommitment[]> {
  const response = await authFetch(`${BASE}/study-commitments/`);
  return list(
    await unwrap<FixedCommitment[] | { results: FixedCommitment[] }>(response),
  );
}

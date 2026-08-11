/**
 * curriculum-api.ts — типизированный клиент раздела «Курс по книге».
 *
 * Ходим напрямую в `BACKEND_URL` через `authFetch`, как это делают самые новые
 * разделы приложения (`components/nutrition/lib.ts`, `lib/contest-api.ts`).
 * У этого есть две причины помимо единообразия:
 *
 *  1. Загрузка PDF/EPUB — multipart, а `lib/backend-helpers.ts` умеет только JSON
 *     (он хардкодит `Content-Type: application/json`);
 *  2. Генерация плана — это вызов модели на 30–90 секунд, и прямой путь убирает
 *     из него потолок Next-прокси.
 *
 * Поля намеренно оставлены в snake_case: так их отдаёт DRF, и это снимает целый
 * слой преобразований вместе с его ошибками.
 *
 * ВАЖНО: у бэкенда `APPEND_SLASH = False`, поэтому КАЖДЫЙ путь заканчивается
 * слешем. Без него DRF-роутер ответит 404.
 */
"use client";

import { getSession } from "next-auth/react";

import { BACKEND_URL } from "@/lib/api-utils";
import { authFetch } from "@/lib/auth-fetch";
import type { IngestionStatusCode } from "@/lib/curriculum-progress";

const BASE = `${BACKEND_URL}/api/curriculum`;

// ─────────────────────────────── Типы ────────────────────────────────────────

export type GoalStatus = "draft" | "confirmed" | "archived";
export type Level =
  | "none"
  | "beginner"
  | "school_basic"
  | "school_confident"
  | "advanced"
  | "university";
export type Balance = "theory" | "balanced" | "practice";

export interface LearningGoal {
  id: string;
  original_text: string;
  normalized_subject: string;
  normalized_direction: string;
  normalization_confidence: number | null;
  normalization_confirmed: boolean;
  normalization_model: string;
  goal_type: string;
  current_level: Level;
  target_level: Level;
  preferred_language: string;
  theory_practice_balance: Balance;
  desired_finish_date: string | null;
  status: GoalStatus;
  created_at: string;
}

export interface DocumentFileInfo {
  original_filename: string;
  sanitized_filename: string;
  mime_type: string;
  byte_size: number;
  content_hash: string;
  antivirus_status: string;
}

export interface CurriculumDocument {
  id: string;
  /** Предмет книги. `null` у книг, загруженных до появления каталога. */
  goal: string | null;
  title: string;
  authors: string[];
  language: string;
  document_type: string;
  source_type: string;
  page_count: number;
  ingestion_status: IngestionStatusCode;
  processing_version: string;
  file: DocumentFileInfo | null;
  created_at: string;
}

export interface IngestionJob {
  id: string;
  status: IngestionStatusCode;
  processing_version: string;
  retry_count: number;
  error_code: string;
  error_message: string;
  warnings: string[];
  started_at: string | null;
  finished_at: string | null;
}

export interface IngestionAttempt {
  from_status: string;
  to_status: string;
  succeeded: boolean;
  error_code: string;
  error_message: string;
  duration_ms: number;
  created_at: string;
}

export interface IngestionStats {
  pages: number;
  sections: number;
  blocks: number;
  tasks: number;
  chunks: number;
}

export interface IngestionState {
  document_id: string;
  stalled: boolean;
  ingestion_status: IngestionStatusCode;
  step_index: number;
  step_total: number;
  progress: number;
  step_label: string;
  phase: string;
  phase_label: string;
  phase_index: number;
  phase_total: number;
  is_terminal: boolean;
  job: IngestionJob | null;
  attempts: IngestionAttempt[];
  warnings: string[];
  stats: IngestionStats;
}

export interface TopicSourceRef {
  section_path: string | null;
  page_start: number | null;
  page_end: number | null;
}

export interface DurationBreakdown {
  theory_minutes: number;
  practice_minutes: number;
  assessment_minutes: number;
  total_minutes: number;
}

export interface CourseTopic {
  id: string;
  external_id: string;
  title: string;
  objective: string;
  order_index: number;
  difficulty: string;
  estimated_minutes: number;
  /** Из чего сложилось время темы. Пусто у планов, созданных до расчёта. */
  duration_breakdown: DurationBreakdown | Record<string, never>;
  suggested_lesson_count: number;
  theory_practice_balance: Balance;
  mastery_criteria: string;
  review_strategy: string;
  prerequisites: string[];
  sources: TopicSourceRef[];
}

export interface CourseModule {
  id: string;
  external_id: string;
  title: string;
  /** Номер главы, как он напечатан: «Глава 3». Пусто у модулей без номера. */
  number_label: string;
  /** Часть книги над главой: «Законы сохранения в механике». Пусто — частей нет. */
  part_title: string;
  objective: string;
  order_index: number;
  estimated_minutes: number;
  completion_criteria: string;
  topics: CourseTopic[];
}

export interface CourseMilestone {
  id: string;
  title: string;
  description: string;
  order_index: number;
  /** Модуль, по завершении которого веха достигнута. `null` — веха общая. */
  module: string | null;
}

export type PlanStatus =
  | "draft"
  | "reviewing"
  | "awaiting_approval"
  | "active"
  | "rejected"
  | "archived";

/** То, что реально приходит из списка планов (`CoursePlanListSerializer`). */
export interface CoursePlanSummary {
  id: string;
  goal: string;
  document: string | null;
  title: string;
  status: PlanStatus;
  estimated_total_minutes: number;
  forecast_finish_date: string | null;
  current_version: number;
  created_at: string;
}

export interface CoursePlan {
  id: string;
  /** Идентификаторы цели и учебника. DRF их отдаёт, и без них страница
   *  программы не может загрузить книгу и цель по холодной ссылке. */
  goal: string;
  document: string;
  title: string;
  objective: string;
  current_level: Level;
  target_level: Level;
  language: string;
  estimated_total_minutes: number;
  recommended_sessions_per_week: number;
  recommended_session_minutes: number;
  forecast_finish_date: string | null;
  forecast: Record<string, unknown>;
  status: PlanStatus;
  generation_model: string;
  reviewer_model: string;
  modules: CourseModule[];
  milestones: CourseMilestone[];
  created_at: string;
}

export interface ReviewFinding {
  kind: string;
  message: string;
  topic_external_id: string;
  severity: "info" | "warning" | "blocker";
}

export interface GeneratePlanResponse {
  plan: CoursePlan;
  /** null, когда отчёта валидации нет. Показывать «0%» в этом случае нельзя. */
  coverage_ratio: number | null;
  warnings: string[];
  review_findings: ReviewFinding[];
  planner_model: string;
  reviewer_model: string;
}

/** Претензия валидатора. Приезжает в теле 422 при отказе. */
export interface PlanIssue {
  code: string;
  message: string;
  severity: "blocker" | "warning";
  topic_external_id: string;
}

/** Ошибка от бэкенда с машиночитаемым кодом. */
export class CurriculumApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;

  constructor(message: string, status: number, code = "", payload: unknown = null) {
    super(message);
    this.name = "CurriculumApiError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }

  /**
   * Претензии валидатора при отказе (422, `code: "plan_rejected"`).
   *
   * Ученику важно увидеть, ЧТО именно забраковано, — иначе «сгенерировать
   * заново» превращается в лотерею.
   */
  get issues(): PlanIssue[] {
    const record = (this.payload ?? {}) as Record<string, unknown>;
    return Array.isArray(record.issues) ? (record.issues as PlanIssue[]) : [];
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
    throw new CurriculumApiError(message, response.status, code, body);
  }
  return body as T;
}

// ──────────────────────────────── Цель ───────────────────────────────────────

export async function listGoals(): Promise<LearningGoal[]> {
  const response = await authFetch(`${BASE}/goals/`);
  const body = await unwrap<LearningGoal[] | { results: LearningGoal[] }>(response);
  return Array.isArray(body) ? body : body.results;
}

export async function getGoal(id: string): Promise<LearningGoal> {
  return unwrap<LearningGoal>(await authFetch(`${BASE}/goals/${id}/`));
}

export async function createGoal(originalText: string): Promise<LearningGoal> {
  const response = await authFetch(`${BASE}/goals/`, {
    method: "POST",
    body: JSON.stringify({ original_text: originalText }),
  });
  return unwrap<LearningGoal>(response);
}

/** Просит модель разобрать формулировку. `original_text` при этом не меняется. */
export async function normalizeGoal(id: string): Promise<LearningGoal> {
  const response = await authFetch(`${BASE}/goals/${id}/normalize/`, { method: "POST" });
  return unwrap<LearningGoal>(response);
}

export async function updateGoal(
  id: string,
  patch: Partial<
    Pick<
      LearningGoal,
      | "current_level"
      | "target_level"
      | "theory_practice_balance"
      | "desired_finish_date"
      | "preferred_language"
      | "goal_type"
    >
  >,
): Promise<LearningGoal> {
  const response = await authFetch(`${BASE}/goals/${id}/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return unwrap<LearningGoal>(response);
}

/** Подтверждение нормализации с правками ученика. Отдельный экшен: поля нормализации read-only. */
export async function confirmGoal(
  id: string,
  edits: { normalized_subject?: string; normalized_direction?: string } = {},
): Promise<LearningGoal> {
  const response = await authFetch(`${BASE}/goals/${id}/confirm/`, {
    method: "POST",
    body: JSON.stringify(edits),
  });
  return unwrap<LearningGoal>(response);
}

// ────────────────────────────── Документ ─────────────────────────────────────

export async function listDocuments(): Promise<CurriculumDocument[]> {
  const response = await authFetch(`${BASE}/documents/`);
  const body = await unwrap<
    CurriculumDocument[] | { results: CurriculumDocument[] }
  >(response);
  return Array.isArray(body) ? body : body.results;
}

export async function getDocument(id: string): Promise<CurriculumDocument> {
  return unwrap<CurriculumDocument>(await authFetch(`${BASE}/documents/${id}/`));
}

/**
 * Раздел оглавления. Поля называются иначе, чем в цитатах темы (`path` против
 * `section_path`, `start_page` против `page_start`) — это разные модели, и
 * сводить их к одному имени на клиенте значит прятать различие.
 */
export interface DocumentSectionRef {
  id: string;
  kind: string;
  title: string;
  path: string;
  order_index: number;
  start_page: number | null;
  end_page: number | null;
}

/** Оглавление учебника. Отдаётся голым массивом, без конверта `results`. */
export async function getSections(documentId: string): Promise<DocumentSectionRef[]> {
  const response = await authFetch(`${BASE}/documents/${documentId}/sections/`);
  const body = await unwrap<DocumentSectionRef[] | { results: DocumentSectionRef[] }>(
    response,
  );
  return Array.isArray(body) ? body : body.results;
}

export interface UploadResult {
  document: CurriculumDocument;
  warnings: string[];
}

/**
 * Загрузка PDF или EPUB с прогрессом.
 *
 * Здесь XHR, а не fetch, по одной причине: у fetch нет события прогресса
 * ОТПРАВКИ. Учебник может весить десятки мегабайт, и полоса «сколько улетело» —
 * единственное, что отличает работающую загрузку от зависшей.
 *
 * `Content-Type` не выставляем намеренно: boundary для multipart умеет
 * проставить только браузер.
 */
export function uploadDocument(
  file: File,
  options: {
    title?: string;
    language?: string;
    /** Предмет, в карточку которого попадёт книга. */
    goalId?: string | null;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  } = {},
): Promise<UploadResult> {
  return new Promise<UploadResult>((resolve, reject) => {
    void (async () => {
      const session = await getSession();
      const email = session?.user?.email;

      const form = new FormData();
      form.append("file", file);
      if (options.title) form.append("title", options.title);
      if (options.goalId) form.append("goal_id", options.goalId);
      form.append("language", options.language || "ru");

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE}/documents/upload/`);
      if (email) xhr.setRequestHeader("X-User-Email", email);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && options.onProgress) {
          options.onProgress(event.loaded / event.total);
        }
      };

      xhr.onload = () => {
        let body: Record<string, unknown> = {};
        try {
          body = JSON.parse(xhr.responseText || "{}");
        } catch {
          body = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({
            document: body.document as CurriculumDocument,
            warnings: (body.warnings as string[]) || [],
          });
          return;
        }
        reject(
          new CurriculumApiError(
            (body.error as string) || `Загрузка не удалась (${xhr.status})`,
            xhr.status,
            (body.code as string) || "",
            body,
          ),
        );
      };

      xhr.onerror = () =>
        reject(new CurriculumApiError("Не удалось связаться с сервером.", 0));
      xhr.onabort = () =>
        reject(new CurriculumApiError("Загрузка отменена.", 0, "aborted"));

      options.signal?.addEventListener("abort", () => xhr.abort());
      xhr.send(form);
    })().catch(reject);
  });
}

/** Ставит документ в обработку. Отвечает сразу: результат забирается опросом. */
export async function startIngestion(
  documentId: string,
): Promise<{ document: CurriculumDocument; job: IngestionJob; poll_url: string }> {
  const response = await authFetch(`${BASE}/documents/${documentId}/ingest/`, {
    method: "POST",
  });
  return unwrap(response);
}

export async function getIngestionState(documentId: string): Promise<IngestionState> {
  const response = await authFetch(`${BASE}/documents/${documentId}/status/`);
  return unwrap<IngestionState>(response);
}

// ──────────────────────────────── План ───────────────────────────────────────

/**
 * Список планов приходит в КОМПАКТНОЙ форме: `CoursePlanListSerializer` не
 * отдаёт ни модулей, ни тем. Раньше здесь стоял полный `CoursePlan`, и тип врал
 * — обращение к `plan.modules` из списка молча дало бы `undefined`.
 */
export async function listPlans(): Promise<CoursePlanSummary[]> {
  const response = await authFetch(`${BASE}/plans/`);
  const body = await unwrap<
    CoursePlanSummary[] | { results: CoursePlanSummary[] }
  >(response);
  return Array.isArray(body) ? body : body.results;
}

export async function getPlan(id: string): Promise<CoursePlan> {
  return unwrap<CoursePlan>(await authFetch(`${BASE}/plans/${id}/`));
}

/**
 * Генерация программы. Это вызов модели: обычно 30–90 секунд.
 *
 * `signal` обязателен на стороне вызывающего — без таймаута вкладка может ждать
 * бесконечно, если соединение подвиснет.
 */
export async function generatePlan(
  goalId: string,
  documentId: string,
  signal?: AbortSignal,
): Promise<GeneratePlanResponse> {
  const response = await authFetch(`${BASE}/plans/generate/`, {
    method: "POST",
    body: JSON.stringify({ goal_id: goalId, document_id: documentId }),
    signal,
  });
  return unwrap<GeneratePlanResponse>(response);
}

export async function approvePlan(planId: string): Promise<{ plan: CoursePlan }> {
  const response = await authFetch(`${BASE}/plans/${planId}/approve/`, {
    method: "POST",
  });
  return unwrap(response);
}

/** Строит программу заново по той же книге; прежняя уходит в архив. */
export async function rebuildPlan(
  planId: string,
  signal?: AbortSignal,
): Promise<GeneratePlanResponse> {
  const response = await authFetch(`${BASE}/plans/${planId}/rebuild/`, {
    method: "POST",
    signal,
  });
  return unwrap<GeneratePlanResponse>(response);
}

export interface PacePatch {
  sessions_per_week?: number;
  minutes_per_session?: number;
  /** `null` убирает срок; отсутствие поля его не трогает. */
  desired_finish_date?: string | null;
}

/**
 * Меняет темп и срок. Модель не вызывается — пересчитывается только прогноз,
 * поэтому это быстро и работает даже на подтверждённой программе.
 */
export async function updatePlanPace(
  planId: string,
  patch: PacePatch,
): Promise<{ plan: CoursePlan; warnings: string[] }> {
  const response = await authFetch(`${BASE}/plans/${planId}/pace/`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return unwrap(response);
}

export interface StructureTopicPatch {
  external_id: string;
  title?: string;
  objective?: string;
  estimated_minutes?: number;
}

export interface StructureModulePatch {
  external_id: string;
  title?: string;
  objective?: string;
  topics: StructureTopicPatch[];
}

/**
 * Заменяет состав программы целиком.
 *
 * Дерево уходит полностью: чего в нём нет — то удалено. Точечных операций нет
 * намеренно — правка обязана быть атомарной и давать одну новую версию.
 * Добавить тему нельзя: у неё неоткуда взяться ссылкам на страницы книги.
 */
export async function updatePlanStructure(
  planId: string,
  modules: StructureModulePatch[],
): Promise<{ plan: CoursePlan; warnings: string[] }> {
  const response = await authFetch(`${BASE}/plans/${planId}/structure/`, {
    method: "PUT",
    body: JSON.stringify({ modules }),
  });
  return unwrap(response);
}

// ─────────────────────────────── Удаление ────────────────────────────────────
//
// `unwrap` здесь не годится: DELETE отвечает 204 без тела, и попытка разобрать
// пустой ответ как JSON упадёт. Поэтому статус проверяется напрямую.

async function remove(path: string): Promise<void> {
  const response = await authFetch(path, { method: "DELETE" });
  if (response.ok || response.status === 404) return;
  let code = "";
  let message = `Не удалось удалить (${response.status}).`;
  try {
    const body = await response.json();
    code = body?.code || "";
    message = body?.error || body?.detail || message;
  } catch {
    // Тела нет — оставляем сообщение по статусу.
  }
  throw new CurriculumApiError(message, response.status, code, null);
}

/** Удаляет предмет вместе с его книгами и планами. */
export async function deleteGoal(goalId: string): Promise<void> {
  return remove(`${BASE}/goals/${goalId}/`);
}

export async function deleteDocument(documentId: string): Promise<void> {
  return remove(`${BASE}/documents/${documentId}/`);
}

export async function deletePlan(planId: string): Promise<void> {
  return remove(`${BASE}/plans/${planId}/`);
}

// ───────────────────────── Вопрос по книгам предмета ─────────────────────────

export interface AskCitation {
  /** Готовая подпись: «Механика, §5.2, стр. 292». Собирает backend. */
  label: string;
  /** Название книги отдельно: панель показывает его один раз над списком. */
  document_title: string;
  document_id: string;
  section_path: string;
  page_start: number;
  page_end: number;
}

export interface AskMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Спрашивает по книгам предмета. Ответ приходит потоком.
 *
 * Возвращается сырой `Response`: события читает `readSse`, а панель решает,
 * что с ними делать. Обёртка вокруг потока прятала бы возможность прервать
 * запрос — а прервать нужно, когда ученик закрыл панель.
 */
export async function askSubjectStream(
  body: {
    /** Пусто — разговор без книги: поиска не будет, ответ пойдёт от модели. */
    goal_id: string | null;
    message: string;
    history?: AskMessage[];
  },
  signal?: AbortSignal,
): Promise<Response> {
  const response = await authFetch(`${BASE}/ask/stream/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    // До первого события ошибка ещё приходит кодом и телом — показываем её,
    // а не молчаливый пустой поток.
    let message = `Не удалось спросить (${response.status}).`;
    try {
      const failure = await response.json();
      message = failure?.error || message;
    } catch {
      // Тела нет — оставляем сообщение по статусу.
    }
    throw new CurriculumApiError(message, response.status, "", null);
  }
  return response;
}

// ─────────────────────────── Чаты внутри предмета ────────────────────────────

/** Строка списка. Сообщений здесь нет: их вес не нужен, чтобы показать название. */
export interface SubjectChatSummary {
  id: string;
  /** Пусто — разговор без книги. */
  goal: string | null;
  title: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface SubjectChat extends Omit<SubjectChatSummary, "message_count"> {
  messages: AskTurn[];
}

/** Реплика в том виде, в каком её держит панель. */
export interface AskTurn {
  role: "user" | "assistant";
  content: string;
  citations?: AskCitation[];
  grounded?: boolean;
  error?: string;
  found?: number;
  durationMs?: number;
}

/**
 * Чаты предмета, чаты без книги или все сразу.
 *
 * `null` — разговоры без книги; бэкенд ждёт для них слово `none`, потому что
 * пустой `?goal=` означал бы «все». Без аргумента — действительно все: так
 * страница чата показывает историю целиком, не спрашивая по предмету за раз.
 */
export async function listChats(
  goalId?: string | null,
): Promise<SubjectChatSummary[]> {
  const query =
    goalId === undefined ? "" : `?goal=${goalId === null ? "none" : goalId}`;
  const response = await authFetch(`${BASE}/chats/${query}`);
  const body = await unwrap<
    SubjectChatSummary[] | { results: SubjectChatSummary[] }
  >(response);
  return Array.isArray(body) ? body : body.results;
}

export async function getChat(chatId: string): Promise<SubjectChat> {
  return unwrap<SubjectChat>(await authFetch(`${BASE}/chats/${chatId}/`));
}

export async function createChat(
  goalId: string | null,
  body: { title?: string; messages?: AskTurn[] } = {},
): Promise<SubjectChat> {
  const response = await authFetch(`${BASE}/chats/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal: goalId, ...body }),
  });
  return unwrap<SubjectChat>(response);
}

export async function updateChat(
  chatId: string,
  body: { title?: string; messages?: AskTurn[] },
): Promise<SubjectChat> {
  const response = await authFetch(`${BASE}/chats/${chatId}/`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return unwrap<SubjectChat>(response);
}

export async function deleteChat(chatId: string): Promise<void> {
  return remove(`${BASE}/chats/${chatId}/`);
}

/**
 * Просит модель придумать чату название.
 *
 * Отказ здесь не ошибка: заголовок — украшение списка, и ронять из-за него
 * разговор нельзя. Бэкенд в этом случае уже подставил первый вопрос.
 */
export async function renameChatAutomatically(chatId: string): Promise<string> {
  try {
    const response = await authFetch(`${BASE}/chats/${chatId}/title/`, {
      method: "POST",
    });
    const body = await response.json();
    return String(body?.title || "");
  } catch {
    return "";
  }
}

/**
 * Client for the saved-chat-history API (`/api/chat-sessions/...`, rewritten
 * by next.config.js to the Django `ai_engine/chat-sessions` ViewSet).
 *
 * Persists AI Tutor conversations per account: messages, the LessonPlan
 * driving them (topic/goal/tasks) и содержимое доски — рисунки ученика,
 * тексты и иллюстрации. Доска сохраняется ОТДЕЛЬНЫМ, более редким автосейвом:
 * иллюстрации лежат в элементах как data-URI и весят сотни килобайт, гонять их
 * вместе с каждым сообщением слишком дорого. Подробности — в docstring модели
 * ChatSession на бэкенде.
 */
import { authFetch } from "@/lib/auth-fetch";
import type { ChatMessage } from "./ai-chat";
import type { LessonPlan } from "./lesson-plan";

// No trailing slash: Next.js redirects trailing-slash URLs away before
// rewrites run, which drops the slash Django's router requires. The
// next.config.js rewrite rules add the correct trailing slash back on the
// way to Django — callers here must never append one themselves.
const BASE_PATH = "/api/chat-sessions";

/** Single place that builds request paths, so the no-trailing-slash contract
 * above can't be broken by a caller assembling a URL by hand. Encoding also
 * keeps an id containing `/` or `?` from escaping into the route. */
function sessionPath(id?: string): string {
  return id ? `${BASE_PATH}/${encodeURIComponent(id)}` : BASE_PATH;
}

export interface ChatSessionSummary {
  id: string;
  title: string;
  topic: string;
  /** Режим тьютора, которым велась сессия. Пустая строка — сохранено до
   * появления режимов; бэкенд трактует её как режим по умолчанию. */
  mode: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** Снимок доски: элементы, штрихи карандаша и камера. Форму задаёт стор
 * whiteboard, поэтому она намеренно нетипизирована — дублировать её значило бы
 * держать две расходящиеся копии одного описания. */
export interface CanvasSnapshot {
  elements?: unknown[];
  strokes?: unknown[];
  camera?: unknown;
}

export interface ChatSessionDetail extends ChatSessionSummary {
  messages: ChatMessage[];
  lesson_plan: LessonPlan | null;
  /** Рисунки, тексты и иллюстрации доски этой сессии. */
  canvas: CanvasSnapshot | null;
  /** Права выдаёт сервер (read-only), клиент их только читает. */
  policy: import("./tutor-modes").HelpPolicySnapshot | null;
  hint_level: number;
  attempt_count: number;
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Сервер вернул ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function listChatSessions(): Promise<ChatSessionSummary[]> {
  const response = await authFetch(sessionPath(), { method: "GET" });
  return unwrap<ChatSessionSummary[]>(response);
}

export async function getChatSession(id: string): Promise<ChatSessionDetail> {
  const response = await authFetch(sessionPath(id), { method: "GET" });
  return unwrap<ChatSessionDetail>(response);
}

export async function createChatSession(input: {
  id: string;
  /** Необязателен: если не прислать, backend придумает короткое имя по первой
   * реплике (chat_title.py). Клиент его не переопределяет. */
  title?: string;
  topic: string;
  messages: ChatMessage[];
  lesson_plan: LessonPlan | null;
  canvas?: CanvasSnapshot;
  mode?: string;
  hint_level?: number;
  attempt_count?: number;
}): Promise<ChatSessionDetail> {
  const response = await authFetch(sessionPath(), {
    method: "POST",
    body: JSON.stringify(input),
  });
  return unwrap<ChatSessionDetail>(response);
}

export async function updateChatSession(
  id: string,
  patch: Partial<{
    title: string;
    topic: string;
    messages: ChatMessage[];
    lesson_plan: LessonPlan | null;
    canvas: CanvasSnapshot;
    mode: string;
    hint_level: number;
    attempt_count: number;
  }>,
  /** `keepalive` позволяет запросу пережить уход со страницы. Браузер даёт на
   * такие запросы жёсткий бюджет около 64 КБ, поэтому вызывающий обязан сам
   * убедиться, что тело маленькое. */
  options: { keepalive?: boolean } = {},
): Promise<ChatSessionDetail> {
  const response = await authFetch(sessionPath(id), {
    method: "PATCH",
    body: JSON.stringify(patch),
    keepalive: options.keepalive,
  });
  return unwrap<ChatSessionDetail>(response);
}

export async function deleteChatSession(id: string): Promise<void> {
  const response = await authFetch(sessionPath(id), { method: "DELETE" });
  if (!response.ok && response.status !== 204) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Сервер вернул ${response.status}`);
  }
}

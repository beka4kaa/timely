// Ответы публичного демо вместо сервера. Чистые функции: install.ts превращает их
// в настоящие Response, а тесты проверяют без браузера.

import { addDays, daysBetween, mondayOf, shiftDates, shiftString, type DemoShift } from "./dates";

export interface DemoFixtures {
  meta: { capturedAt: string; timeZone: string; today: string; email: string };
  /** Ответ на GET по ключу «A|B путь?запрос»: A — API сайта, B — бэкенд. */
  get: Record<string, { status: number; body: unknown }>;
  /** Все блоки учёбы снимка, без повторов. */
  blocks: Array<Record<string, unknown>>;
  /** Недели дневника по понедельникам снимка. */
  diaryWeeks: Record<string, unknown>;
}

export interface DemoRequest {
  method: string;
  scope: "A" | "B";
  path: string;
  search: string;
  body?: string | null;
}

export interface SseFrame {
  event: string;
  data: Record<string, unknown>;
}

export interface DemoReply {
  status: number;
  json?: unknown;
  sse?: SseFrame[];
}

/** Расписание: двигается целыми неделями, чтобы дни недели не съезжали. */
const WEEKLY = [/^\/api\/learning-blocks\//, /^\/api\/study-schedules\//, /^\/api\/study-commitments\//, /^\/api\/diary\//];

function isWeekly(path: string): boolean {
  return WEEKLY.some((pattern) => pattern.test(path));
}

const STUDENT_NAME = "Алия";

function authReply(request: DemoRequest, fixtures: DemoFixtures): DemoReply {
  const route = request.path.replace(/^\/api\/auth\//, "").replace(/\/$/, "");
  if (route === "session") {
    return {
      status: 200,
      json: {
        user: { id: "demo", name: STUDENT_NAME, email: fixtures.meta.email },
        expires: "2099-12-31T00:00:00.000Z",
      },
    };
  }
  if (route === "csrf") return { status: 200, json: { csrfToken: "demo" } };
  if (route === "backend-token") return { status: 200, json: { token: "demo", expiresIn: 86_400 } };
  if (route === "signout") return { status: 200, json: { url: "/" } };
  return { status: 200, json: {} };
}

function latin(text: string): boolean {
  const latinLetters = (text.match(/[a-z]/gi) ?? []).length;
  const cyrillic = (text.match(/[а-яё]/gi) ?? []).length;
  return latinLetters > cyrillic;
}

const TUTOR_REPLY = {
  ru:
    "Это демо, поэтому ответ здесь заготовлен заранее. В настоящем Timely тьютор ответил бы на твой вопрос по-настоящему.\n\n" +
    "Как он работает: не решает за тебя, а ведёт по шагам. Сначала спросит, что ты уже знаешь и где застрял, потом даст одну подсказку, проверит твой шаг и в конце предложит похожую задачу, чтобы закрепить.\n\n" +
    "Открой разговор «Тригонометрическое уравнение» в списке чатов: там видно, как это выглядит.",
  en:
    "This is the demo, so the answer here is prepared in advance. In the real Timely the tutor would answer your question live.\n\n" +
    "How it works: it doesn't solve for you, it guides you step by step. It asks what you already know and where you're stuck, gives one hint at a time, checks each step and ends with a similar problem to lock it in.\n\n" +
    "Open the «Тригонометрическое уравнение» chat in the list to see what that looks like.",
};

const PLAN_REPLY = {
  ru: "Это демо, поэтому план здесь не меняется. В настоящем Timely помощник разобрал бы просьбу, показал, какие блоки сдвинутся, и предложил «Применить» или «Вернуть как было».",
  en: "This is the demo, so the plan doesn't change here. In the real Timely the assistant would read your request, show which blocks move and offer Apply or Undo.",
};

/** Заготовленный ответ потоком: те же события, что шлёт настоящий тьютор. */
export function cannedStream(path: string, body: string | null | undefined): SseFrame[] {
  let message = "";
  try {
    const parsed = JSON.parse(body ?? "{}") as { message?: unknown };
    if (typeof parsed.message === "string") message = parsed.message;
  } catch {
    // Без тела отвечаем по-русски.
  }
  const lang = latin(message) ? "en" : "ru";
  const text = (path.includes("studyplan") ? PLAN_REPLY : TUTOR_REPLY)[lang];
  const frames: SseFrame[] = [{ event: "stage", data: { stage: "thinking" } }];
  // Кусками, как приходит настоящий поток: `delta` читает чат, `text` — помощник плана.
  for (const piece of text.match(/[\s\S]{1,24}/g) ?? []) {
    frames.push({ event: "content", data: { delta: piece, text: piece } });
  }
  frames.push({ event: "done", data: {} });
  return frames;
}

function writeReply(request: DemoRequest): DemoReply {
  if (request.method === "DELETE") return { status: 204 };
  if (request.scope === "B" && request.path === "/api/demo/start/") {
    return { status: 200, json: { ok: true, seeded: false } };
  }
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(request.body ?? "{}");
  } catch {
    parsed = {};
  }
  // В демо ничего не сохраняется: страница получает «успех» с тем, что отправила.
  const echo = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  return { status: 200, json: { id: `demo-${Date.now().toString(36)}`, ...(echo as object) } };
}

function blocksReply(fixtures: DemoFixtures, request: DemoRequest, weeks: number): unknown[] {
  const params = new URLSearchParams(request.search);
  const from = params.get("from");
  const to = params.get("to");
  return fixtures.blocks
    .map((block) => shiftDates(block, weeks))
    .filter((block) => {
      const day = String(block.start_at ?? "").slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      for (const field of ["schedule", "course_plan"]) {
        const wanted = params.get(field);
        if (wanted && block[field] !== wanted) return false;
      }
      return true;
    });
}

function diaryReply(fixtures: DemoFixtures, request: DemoRequest, weeks: number): unknown {
  const wanted = new URLSearchParams(request.search).get("weekStart");
  const keys = Object.keys(fixtures.diaryWeeks);
  if (!keys.length) return {};
  if (!wanted) return shiftDates(fixtures.diaryWeeks[keys[0]], weeks);
  const captured = addDays(wanted, -weeks);
  if (fixtures.diaryWeeks[captured]) return shiftDates(fixtures.diaryWeeks[captured], weeks);
  // Других недель в снимке нет: показываем ту же школьную неделю на нужных датах.
  const main = fixtures.diaryWeeks[mondayOf(fixtures.meta.today)] ? mondayOf(fixtures.meta.today) : keys[0];
  return shiftDates(fixtures.diaryWeeks[main], daysBetween(main, wanted));
}

function fallbackGet(request: DemoRequest): DemoReply {
  const last = request.path.replace(/\/$/, "").split("/").pop() ?? "";
  if (/^[0-9a-f-]{8,}$/i.test(last) || /^\d+$/.test(last)) return { status: 404, json: { detail: "Не найдено." } };
  return { status: 200, json: request.path.endsWith("/") ? [] : {} };
}

/** Ответ демо на запрос приложения. */
export function respondDemo(fixtures: DemoFixtures, request: DemoRequest, shift: DemoShift): DemoReply {
  const method = request.method.toUpperCase();
  if (request.scope === "A" && request.path.startsWith("/api/auth/")) return authReply(request, fixtures);
  if (method === "POST" && /\/stream\/?$/.test(request.path)) {
    return { status: 200, sse: cannedStream(request.path, request.body) };
  }
  if (method !== "GET" && method !== "HEAD") return writeReply({ ...request, method });

  const days = isWeekly(request.path) ? shift.weeks : shift.days;
  if (request.scope === "B" && request.path === "/api/learning-blocks/") {
    return { status: 200, json: blocksReply(fixtures, request, shift.weeks) };
  }
  if (request.scope === "A" && request.path === "/api/diary/week") {
    return { status: 200, json: diaryReply(fixtures, request, shift.weeks) };
  }

  const base = `${request.scope} ${request.path}`;
  const exact = fixtures.get[`${base}${shiftString(request.search, -days)}`];
  const hit = exact ?? Object.entries(fixtures.get).find(([key]) => key === base || key.startsWith(`${base}?`))?.[1];
  if (!hit) return fallbackGet(request);
  return { status: hit.status, json: shiftDates(hit.body, days) };
}

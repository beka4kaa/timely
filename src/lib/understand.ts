// Что человек написал: тему, которую изучил, привычку, цель или просто вопрос.
//
// Смысл разбирает модель (`POST /api/ai/understand`), а если модели нет или она не
// ответила за девять секунд, работают простые правила ниже: добавить тему можно и без
// неё. Сам разбор ничего не сохраняет: сначала человек видит, что получилось, и
// подтверждает (CLAUDE.md §3.3).

import { authFetch } from "./auth-fetch";

export interface UnderstoodTopic {
  title: string;
  /** Предмет, как его назвала модель или правила. Пусто, если непонятно. */
  subject: string;
}

export type Understood =
  | { kind: "topics"; topics: UnderstoodTopic[] }
  | { kind: "habit"; name: string }
  | {
      kind: "goal";
      title: string;
      scope: "study" | "general";
      /** ISO-дата срока. `null`, если срок не назван. */
      deadline: string | null;
      /** Привычки, которые помогут дойти до цели. */
      habits: string[];
    }
  | { kind: "question" };

export type UnderstoodKind = Understood["kind"];

const SERVER_TIMEOUT_MS = 9000;

const capital = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

const MONTHS: Array<[RegExp, number]> = [
  [/январ/, 0],
  [/феврал/, 1],
  [/март/, 2],
  [/апрел/, 3],
  [/ма[йя]|мае/, 4],
  [/июн/, 5],
  [/июл/, 6],
  [/август/, 7],
  [/сентябр/, 8],
  [/октябр/, 9],
  [/ноябр/, 10],
  [/декабр/, 11],
];

/** Срок из текста: «к декабрю», «до 20 мая». Прошедший месяц значит следующий год. */
export function parseDeadline(text: string, now: Date = new Date()): string | null {
  const lower = text.toLowerCase();
  const near = lower.match(/(?:^|\s)(?:к|до)\s+(?:(\d{1,2})\s+)?([а-яё]+)/);
  if (!near) return null;
  const month = MONTHS.find(([pattern]) => pattern.test(near[2]));
  if (!month) return null;
  const day = near[1] ? Number(near[1]) : 1;
  let year = now.getFullYear();
  const candidate = new Date(year, month[1], day);
  if (candidate.getTime() < now.getTime()) year += 1;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month[1] + 1)}-${pad(day)}`;
}

const SUBJECTS: Array<[RegExp, string]> = [
  [/физик|ньютон|ускорен|скорост|закон ома|импульс|кинематик|динамик/, "Физика"],
  [/алгебр|уравнен|неравенств|интервал|логарифм|функци|производн/, "Алгебра"],
  [/геометр|треугольник|окружност|подоби/, "Геометрия"],
  [/математ/, "Математика"],
  [/хими|реакци|молекул|валентн/, "Химия"],
  [/биолог|клетк|фотосинтез/, "Биология"],
  [/истори|реформ|войн|револю/, "История"],
  [/географ/, "География"],
  [/русск|сложноподч|причаст|орфограф|пунктуац/, "Русский язык"],
  [/литератур|онегин|стихотворен/, "Литература"],
  [/англ|english|unit\b/, "Английский"],
  [/казах/, "Казахский язык"],
  [/информат|программир|алгоритм/, "Информатика"],
];

function subjectOf(text: string): string {
  const lower = text.toLowerCase();
  return SUBJECTS.find(([pattern]) => pattern.test(lower))?.[1] ?? "";
}

/** Предмет, названный прямо: «по физике прошли импульс». Только он относится ко всем темам сразу. */
const NAMED_SUBJECT = /физик|алгебр|геометр|математ|хими|биолог|истори|географ|русск|литератур|англ|казах|информат/;

function namedSubjectOf(text: string): string {
  const named = text.toLowerCase().match(NAMED_SUBJECT)?.[0];
  return named ? subjectOf(named) : "";
}

const STUDIED =
  /(^|\s)(изучил[аи]?|изучали|прош[её]л|прошла|прошли|разобрал[аи]?|разбирали|выучил[аи]?|учил[аи]?|повторил[аи]?)(\s|$)/;
const HABIT = /кажд(ый|ое|ую|ые)|ежедневно|привычк|по утрам|по вечерам|раза? в неделю/;
const GOAL = /(^|\s)(хочу|цель|сдать|поступить|выиграть|победить|достичь|добиться)(\s|$)/;
const COMMAND = /перен[её]с|сдвин|подвин|короч|таймер|помодоро|задал|контест|рейтинг|дальше|отмет|сними|удали|убери|поменяй|измени/;
/** Похоже на вопрос, даже если в нём есть «хочу» или «цель»: такое идёт к тьютору. */
const QUESTION =
  /\?\s*$|^(как|что|почему|зачем|когда|где|кто|сколько|объясни|помоги|расскажи|покажи|реши|проверь)\s|хочу\s+(понять|узнать|спросить|разобраться)/;

function parseTopics(text: string): UnderstoodTopic[] {
  // Всё до глагола это вступление: «сегодня на уроке по физике мы прошли…».
  const clean = text.replace(
    /^(?:.*?\s)?(?:изучил[аи]?|изучали|прош[её]л|прошла|прошли|разобрал[аи]?|разбирали|выучил[аи]?|учил[аи]?|повторил[аи]?)\s+/i,
    "",
  );
  return clean
    .split(/,|;|\s+и\s+|\s+а ещё\s+|\s+потом\s+/)
    .map((part) => part.replace(/^\s*(тему|темы)\s+/i, "").trim().replace(/[.!]+$/, ""))
    .filter((part) => part.length > 1)
    .slice(0, 5)
    .map((part) => ({ title: capital(part), subject: subjectOf(part) || namedSubjectOf(text) }));
}

export function parseHabit(text: string): string {
  const name = text
    .replace(/^\s*(хочу|буду|надо|нужно|хотел бы|хотела бы)\s+/i, "")
    .replace(/\s*(каждый день|ежедневно|по утрам|по вечерам)\s*/i, " ")
    .trim()
    .replace(/[.!]+$/, "");
  return capital(name || text.trim());
}

export function parseGoal(text: string): Extract<Understood, { kind: "goal" }> {
  const lower = text.toLowerCase();
  const title = text
    .replace(/^\s*(хочу|моя цель|цель|цель:|нужно|надо)\s*:?\s*/i, "")
    .replace(/\s+(к|до)\s+(\d{1,2}\s+)?[а-яё]+\s*$/i, "")
    .trim()
    .replace(/[.!]+$/, "");
  const study = Boolean(subjectOf(lower)) || /сдать|экзамен|сор|соч|контрольн|олимпиад|оценк|итогов|поступить/.test(lower);
  return {
    kind: "goal",
    title: capital(title || text.trim()),
    scope: study ? "study" : "general",
    deadline: parseDeadline(text),
    habits: [],
  };
}

/** Разбор без модели. `expect` решает, если по словам непонятно: на странице целей это цель. */
export function understandLocally(text: string, expect?: UnderstoodKind): Understood {
  const lower = text.toLowerCase();
  if (COMMAND.test(lower) || QUESTION.test(lower.trim())) return { kind: "question" };
  if (STUDIED.test(lower)) return { kind: "topics", topics: parseTopics(text) };
  if (HABIT.test(lower)) return { kind: "habit", name: parseHabit(text) };
  if (GOAL.test(lower)) return parseGoal(text);
  if (expect === "topics") return { kind: "topics", topics: parseTopics(text) };
  if (expect === "habit") return { kind: "habit", name: parseHabit(text) };
  if (expect === "goal") return parseGoal(text);
  return { kind: "question" };
}

function normalize(data: unknown): Understood | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (row.kind === "question") return { kind: "question" };
  if (row.kind === "topics" && Array.isArray(row.topics)) {
    const topics = row.topics
      .map((topic) => topic as Record<string, unknown>)
      .filter((topic) => typeof topic.title === "string" && topic.title.trim())
      .map((topic) => ({ title: String(topic.title).trim(), subject: String(topic.subject ?? "").trim() }))
      .slice(0, 8);
    return topics.length ? { kind: "topics", topics } : null;
  }
  if (row.kind === "habit" && typeof row.name === "string" && row.name.trim()) {
    return { kind: "habit", name: row.name.trim() };
  }
  if (row.kind === "goal" && typeof row.title === "string" && row.title.trim()) {
    return {
      kind: "goal",
      title: row.title.trim(),
      scope: row.scope === "general" ? "general" : "study",
      deadline: typeof row.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.deadline) ? row.deadline : null,
      habits: Array.isArray(row.habits) ? row.habits.map(String).filter(Boolean).slice(0, 3) : [],
    };
  }
  return null;
}

/**
 * Разбирает текст. Никогда не бросает: без сети и без модели отвечают правила.
 *
 * `expect` — что человек, скорее всего, вводит на этой странице.
 */
export async function understand(text: string, expect?: UnderstoodKind): Promise<Understood> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), SERVER_TIMEOUT_MS);
  try {
    const response = await authFetch("/api/ai/understand", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, expect: expect ?? null }),
      signal: controller.signal,
    });
    if (response.ok) {
      const parsed = normalize(await response.json());
      if (parsed) return parsed;
    }
  } catch {
    // Сеть или таймаут: разбираем правилами.
  } finally {
    window.clearTimeout(timer);
  }
  return understandLocally(text, expect);
}

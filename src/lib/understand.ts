// Что человек написал: тему, которую изучил, привычку, цель или просто вопрос.
//
// Смысл разбирает модель (`POST /api/ai/understand`), а если модели нет или она не
// ответила за девять секунд, работают простые правила ниже: добавить тему можно и без
// неё. Сам разбор ничего не сохраняет: сначала человек видит, что получилось, и
// подтверждает (CLAUDE.md §3.3).

import type { HabitSchedule } from "../components/habits/habit-schedule";

import { authFetch } from "./auth-fetch";

export interface UnderstoodTopic {
  title: string;
  /** Предмет, как его назвала модель или правила. Пусто, если непонятно. */
  subject: string;
}

export type Understood =
  | { kind: "topics"; topics: UnderstoodTopic[] }
  | {
      kind: "habit";
      name: string;
      /** Как часто, если сказано. `null`: каждый день. */
      schedule: HabitSchedule | null;
    }
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
const HABIT =
  /кажд(ый|ое|ую|ые)|ежедневно|привычк|по утрам|по вечерам|раза? в (неделю|месяц|пару|несколько|две|два|три|четыре|пять|шесть|семь|\d)|(дважды|трижды) в неделю|через день|по будням|по выходным|по (понедельникам|вторникам|средам|четвергам|пятницам|субботам|воскресеньям)/;
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

// ── Как часто ──

const every = (intervalDays: number): HabitSchedule => ({ frequency: "interval", weekdays: [], intervalDays });
const onDays = (weekdays: number[]): HabitSchedule => ({ frequency: "weekdays", weekdays, intervalDays: 2 });

const NUMBER_WORDS: Record<string, number> = { два: 2, две: 2, дважды: 2, три: 3, трижды: 3, четыре: 4, пять: 5, шесть: 6, семь: 7 };
const ORDINALS: Record<string, number> = { второй: 2, третий: 3, четвёртый: 4, четвертый: 4, пятый: 5 };
const numberOf = (raw: string) => NUMBER_WORDS[raw.toLowerCase()] ?? Number(raw);

/** Столько раз в неделю: дни с просветами. Перед добавлением их всё равно видно и можно поменять. */
const TIMES_A_WEEK: Record<number, number[]> = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] };

// Границы слова вручную: `\b` не знает кириллицу, а просмотр назад ломает старые браузеры.
const START = "(^|[^а-яё])";
const END = "(?![а-яё])";
const phrase = (source: string) => new RegExp(`${START}(${source})${END}`, "i");
const COUNT = "\\d{1,2}|два|две|три|четыре|пять|шесть|семь";

/** Порядок важен: «пять раз в неделю» не должно стать «раз в неделю». `null` значит каждый день. */
const SCHEDULE_PHRASES: ReadonlyArray<readonly [RegExp, (match: RegExpMatchArray) => HabitSchedule | null]> = [
  [phrase("кажд(?:ый|ое)\\s+день|ежедневно|изо\\s+дня\\s+в\\s+день"), () => null],
  [phrase("через\\s+день"), () => every(2)],
  [phrase("кажд(?:ый|ое)\\s+(второй|третий|четв[её]ртый|пятый)\\s+день"), (match) => every(ORDINALS[match[3].toLowerCase()])],
  [
    phrase(`(?:раз\\s+в|кажд(?:ые|ый))\\s+(${COUNT})\\s+(?:день|дня|дней)`),
    (match) => (numberOf(match[3]) < 2 ? null : every(Math.min(30, numberOf(match[3])))),
  ],
  [phrase("раз\\s+в\\s+пару\\s+дней"), () => every(2)],
  [phrase("раз\\s+в\\s+несколько\\s+дней"), () => every(3)],
  [phrase("(?:раз\\s+в|каждые)\\s+(?:две|2)\\s+недели"), () => every(14)],
  [phrase("раз\\s+в\\s+месяц|каждый\\s+месяц"), () => every(30)],
  [
    phrase("(2|3|4|5|6|два|три|четыре|пять|шесть|дважды|трижды)\\s*(?:раза?\\s+)?в\\s+неделю"),
    (match) => onDays(TIMES_A_WEEK[numberOf(match[3])]),
  ],
  [phrase("(?:(?:один|1)\\s+)?раз\\s+в\\s+неделю|каждую\\s+неделю"), () => every(7)],
  [phrase("с\\s+понедельника\\s+по\\s+пятницу|пн\\s*[-–—]\\s*пт|по\\s+будням|в\\s+будни(?:е\\s+дни)?"), () => onDays([0, 1, 2, 3, 4])],
  [phrase("по\\s+выходным|в\\s+выходные(?:\\s+дни)?"), () => onDays([5, 6])],
];

const DAY_FORMS = [
  "понедельник(?:а|ам|и)?|пн",
  "вторник(?:а|ам|и)?|вт",
  "сред(?:а|у|е|ы|ам)|ср",
  "четверг(?:а|ам|и)?|чт",
  "пятниц(?:а|у|е|ы|ам)|пт",
  "суббот(?:а|у|е|ы|ам)|сб",
  "воскресень(?:е|я|ям)|вс",
];
const DAY_WORD = `(?:${DAY_FORMS.join("|")})${END}`;
const DAY_LEAD = "кажд(?:ый|ую|ое)\\s+|по\\s+|во?\\s+";
const DAY_LIST = new RegExp(
  `${START}((${DAY_LEAD})?${DAY_WORD}(?:(?:\\s*[,/]\\s*|\\s+и\\s+|\\s+)(?:${DAY_LEAD})?${DAY_WORD})*)`,
  "gi",
);
const DAY_PATTERNS = DAY_FORMS.map((form) => new RegExp(`${START}(?:${form})${END}`, "i"));
const SHORT_DAY = new RegExp(`${START}(?:пн|вт|ср|чт|пт|сб|вс)${END}`, "i");

function findSchedule(text: string): { schedule: HabitSchedule | null; start: number; end: number } | null {
  for (const [pattern, make] of SCHEDULE_PHRASES) {
    const match = text.match(pattern);
    if (match?.index !== undefined) {
      return { schedule: make(match), start: match.index + match[1].length, end: match.index + match[0].length };
    }
  }
  for (const match of Array.from(text.matchAll(DAY_LIST))) {
    const list = match[2];
    const weekdays = DAY_PATTERNS.flatMap((pattern, day) => (pattern.test(list) ? [day] : []));
    // Одно слово без предлога может быть и не днём: «окружающая среда».
    if (match[3] || weekdays.length > 1 || SHORT_DAY.test(list)) {
      const start = (match.index ?? 0) + match[1].length;
      return { schedule: weekdays.length === 7 ? null : onDays(weekdays), start, end: start + list.length };
    }
  }
  return null;
}

/** Как часто по словам ученика. `null`: не сказано или каждый день. */
export function parseSchedule(text: string): HabitSchedule | null {
  return findSchedule(text)?.schedule ?? null;
}

export function parseHabit(text: string): string {
  const found = findSchedule(text);
  const name = (found ? `${text.slice(0, found.start)} ${text.slice(found.end)}` : text)
    .replace(/^\s*(хочу|буду|надо|нужно|хотел бы|хотела бы)\s+/i, "")
    .replace(/\s*(каждый день|ежедневно|по утрам|по вечерам)\s*/i, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s,:;–—-]+|[\s,:;.!–—-]+$/g, "");
  return capital(name || text.trim());
}

const habitFrom = (named: string, said: string): Understood => ({
  kind: "habit",
  name: parseHabit(named),
  schedule: parseSchedule(said),
});

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
  if (HABIT.test(lower)) return habitFrom(text, text);
  if (GOAL.test(lower)) return parseGoal(text);
  if (expect === "topics") return { kind: "topics", topics: parseTopics(text) };
  if (expect === "habit") return habitFrom(text, text);
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
    return { kind: "habit", name: row.name.trim(), schedule: null };
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
      // Смысл определила модель, а частоту правила знают точно: она могла оставить её в названии.
      if (parsed) return parsed.kind === "habit" ? habitFrom(parsed.name, text) : parsed;
    }
  } catch {
    // Сеть или таймаут: разбираем правилами.
  } finally {
    window.clearTimeout(timer);
  }
  return understandLocally(text, expect);
}

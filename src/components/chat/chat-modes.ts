// Режимы тьютора: как он ведёт разговор.
//
// Само поведение описано на сервере (`backend/curriculum/ask_modes.py`): он дописывает
// правила режима к системному промпту. Здесь только то, что видит ученик: название,
// подсказка в поле и кнопки под готовым ответом. Эти кнопки шлют настоящий вопрос,
// заготовленных ответов нет: отвечает только модель.
//
// Без React и без запросов: чистые функции, проверяются тестом.

import type { IconName } from "@/components/shell/icons";

import { isOpenGoal, toneOf } from "../goals/goal-logic";

export type ChatModeKey = "plain" | "plan" | "guide" | "ideas" | "check";

export interface ChatMode {
  key: ChatModeKey;
  icon: IconName;
  name: string;
  note: string;
  /** Подсказка в пустом поле. */
  hint: string;
  /** Кнопки под готовым ответом: подпись и есть вопрос тьютору. */
  follow: readonly string[];
}

export const DEFAULT_MODE: ChatModeKey = "plain";

export const CHAT_MODES: readonly ChatMode[] = [
  {
    key: "plain",
    icon: "zap",
    name: "Обычный",
    note: "Просто поболтать и спросить что угодно",
    hint: "Спроси о чём угодно",
    follow: ["Подробнее"],
  },
  {
    key: "plan",
    icon: "plan",
    name: "Планирование",
    note: "Выбрать цель и разложить путь к ней по дням",
    hint: "Что нужно успеть?",
    follow: [],
  },
  {
    key: "guide",
    icon: "compass",
    name: "Наводящая помощь",
    note: "Не решает за тебя, ведёт подсказками",
    hint: "Какую задачу разберём?",
    follow: ["Дай подсказку", "Покажи решение"],
  },
  {
    key: "ideas",
    icon: "bulb",
    name: "Брейншторм",
    note: "Ищет идеи вместе с тобой, текст пишешь сам",
    hint: "О чём подумаем?",
    follow: ["Подкинь идею"],
  },
  {
    key: "check",
    icon: "target",
    name: "Проверь меня",
    note: "Спрашивает и смотрит, что ты помнишь",
    hint: "Какую тему проверить?",
    follow: [],
  },
];

const FALLBACK = CHAT_MODES[0];

export function modeByKey(key: string | null | undefined): ChatMode {
  return CHAT_MODES.find((mode) => mode.key === key) ?? FALLBACK;
}

/** Следующий режим по кругу: Shift+Tab в поле. */
export function nextMode(key: ChatModeKey): ChatMode {
  const index = CHAT_MODES.findIndex((mode) => mode.key === key);
  return CHAT_MODES[(index + 1) % CHAT_MODES.length];
}

// ── Цели для режима «Планирование» ───────────────────────────────────────────

/** Цель в том виде, в каком её отдаёт `GET /api/goals/`. Нужное нам подмножество полей. */
export interface PlanGoal {
  id: string;
  title: string;
  type: string;
  status: string;
  priority?: string | null;
  endDate?: string | null;
  dueDate?: string | null;
  /** Цвет плашки. У старых целей его нет. */
  tone?: string | null;
  /** Главная цель ученика. */
  isMain?: boolean;
}

const PRIORITY_ORDER = ["critical", "high", "medium", "low"];

/** Срок цели: дата конца, а если её нет, дата сдачи. */
export function goalDue(goal: PlanGoal): string | null {
  return goal.endDate || goal.dueDate || null;
}

/** Цели, к которым можно идти: без подцелей и привычек, без закрытых. Главная, важные и близкие сверху. */
export function selectPlanGoals(rows: readonly PlanGoal[]): PlanGoal[] {
  const rank = (goal: PlanGoal) => {
    const place = PRIORITY_ORDER.indexOf(goal.priority ?? "");
    return place < 0 ? PRIORITY_ORDER.length : place;
  };
  // Срока нет: такая цель стоит за всеми со сроком.
  const when = (goal: PlanGoal) => goalDue(goal) ?? "9999";
  return rows
    .filter(isOpenGoal)
    .sort(
      (a, b) =>
        Number(Boolean(b.isMain)) - Number(Boolean(a.isMain)) ||
        rank(a) - rank(b) ||
        when(a).localeCompare(when(b)),
    );
}

/** Класс плашки: тот же цвет, что у этой цели на странице целей. */
export function goalTone(goal: Pick<PlanGoal, "id" | "tone">): string {
  return `p-${toneOf(goal.id, goal.tone)}`;
}

const MONTHS = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

/** «6 ноября», а если год другой, «1 сентября 2027». Дата приходит как `ГГГГ-ММ-ДД`. */
export function formatDue(iso: string | null | undefined, now: Date = new Date()): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return null;
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  const date = `${Number(match[3])} ${month}`;
  return Number(match[1]) === now.getFullYear() ? date : `${date} ${match[1]}`;
}

/** Вопрос, который уходит тьютору, когда ученик нажал на цель. */
export function goalQuestion(goal: PlanGoal, now: Date = new Date()): string {
  const due = formatDue(goalDue(goal), now);
  return due
    ? `Цель: «${goal.title}», срок ${due}. Разложи на шаги.`
    : `Цель: «${goal.title}». Разложи на шаги.`;
}

const STEPS_LIMIT = 900;
const NUMBERED = /^\s*\d+[.)]\s+\S/;
const BULLET = /^\s*[-*•]\s+\S/;

/** Убирает разметку: помощник по плану получает простой текст. */
function plainText(text: string): string {
  return text
    .replace(/\*\*|__/g, "")
    .replace(/`/g, "")
    .replace(/^#+\s+/gm, "")
    .trim();
}

/** Есть ли в ответе список шагов. Встречный вопрос тьютора шагами не считается. */
export function hasSteps(answer: string): boolean {
  return answer.split("\n").some((line) => NUMBERED.test(line) || BULLET.test(line));
}

/**
 * Шаги из ответа: нумерованный список, иначе маркированный, иначе весь ответ.
 *
 * Весь ответ лучше, чем ничего: дальше помощник по плану всё равно покажет предпросмотр,
 * и ученик решит сам.
 */
export function stepsFromAnswer(answer: string): string {
  const lines = answer.split("\n");
  const numbered = lines.filter((line) => NUMBERED.test(line));
  const picked = numbered.length ? numbered : lines.filter((line) => BULLET.test(line));
  const text = plainText(picked.length ? picked.map((line) => line.trim()).join("\n") : answer);
  return text.length > STEPS_LIMIT ? `${text.slice(0, STEPS_LIMIT).trimEnd()}…` : text;
}

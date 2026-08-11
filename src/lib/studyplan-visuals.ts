// Как выглядит блок в календаре: подпись, тон, состояние.
//
// Вынесено из компонента, потому что это правила, а не разметка, и их надо
// проверять таблицей. Главное правило одно: **тип занятия и состояние блока
// кодируются РАЗНЫМИ средствами**. Тип — тоном заливки, состояние — рамкой и
// насыщенностью. Если бы оба брали цвет, «пропущенная теория» и «выполненная
// проверка» стали бы неразличимы, а именно эти два вопроса ученик и задаёт
// календарю: что это за занятие и сделал ли я его.
//
// Палитра одноцветная (hue 30, тёплая бумага раздела). Разные оттенки для
// разных предметов превратили бы неделю в мозаику, из которой не читается ни
// расписание, ни прогресс.

export type BlockVisualStatus =
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

const ACTIVITY_LABELS: Record<string, string> = {
  theory: "Теория",
  guided_example: "Разбор примера",
  guided_practice: "Практика с разбором",
  independent_practice: "Практика",
  homework: "Домашняя работа",
  review: "Повторение",
  assessment: "Проверка",
  project: "Проект",
  reading: "Чтение",
  coding: "Код",
  handwritten_problem: "Задача на бумаге",
  offline_activity: "Вне приложения",
};

/**
 * Насколько занятие «весит». Теория светлее, проверка темнее — по шкале
 * нагрузки, а не по алфавиту: так неделя читается как рельеф, и тяжёлые дни
 * видно, не читая подписей.
 */
const ACTIVITY_WEIGHT: Record<string, number> = {
  reading: 0,
  theory: 0,
  guided_example: 1,
  guided_practice: 2,
  review: 2,
  independent_practice: 3,
  homework: 3,
  coding: 3,
  handwritten_problem: 3,
  project: 4,
  assessment: 5,
  offline_activity: 1,
};

const MAX_WEIGHT = 5;

export interface BlockAppearance {
  label: string;
  /** Заливка блока. */
  background: string;
  /** Полоса слева: она же несёт признак закреплённости и повторения. */
  accent: string;
  border: string;
  text: string;
  /** Повторение рисуется пунктиром — это не новая тема. */
  dashed: boolean;
  /** Выполненное и отменённое приглушается, а не выделяется. */
  faded: boolean;
  /** Пропущенное и идущее сейчас получают заметную рамку. */
  ring: string | null;
  /** Короткая пометка состояния. `null` — состояние по умолчанию. */
  statusLabel: string | null;
  /** Заголовок зачёркивается только у отменённого: пропуск ещё можно нагнать. */
  struck: boolean;
}

const STATUS_LABELS: Record<BlockVisualStatus, string | null> = {
  scheduled: null,
  ready: "Можно начинать",
  in_progress: "Идёт",
  paused: "Пауза",
  completed: "Готово",
  partially_completed: "Частично",
  missed: "Пропущено",
  skipped: "Пропущено намеренно",
  rescheduled: "Перенесено",
  cancelled: "Отменено",
};

const FADED_STATUSES = new Set<BlockVisualStatus>([
  "completed",
  "skipped",
  "cancelled",
  "rescheduled",
]);

export function activityLabel(activityType: string): string {
  return ACTIVITY_LABELS[activityType] ?? activityType;
}

/** Тон заливки по весу занятия. Один цвет, меняется только светлота. */
export function activityTone(activityType: string): {
  background: string;
  accent: string;
  border: string;
  text: string;
} {
  const weight = ACTIVITY_WEIGHT[activityType] ?? 2;
  const step = Math.min(Math.max(weight / MAX_WEIGHT, 0), 1);
  const lightness = 94 - step * 12;
  return {
    background: `hsl(32 42% ${lightness.toFixed(0)}%)`,
    accent: `hsl(30 ${(38 - step * 10).toFixed(0)}% ${(52 - step * 18).toFixed(0)}%)`,
    border: `hsl(32 30% ${(lightness - 8).toFixed(0)}%)`,
    text: step > 0.6 ? "hsl(28 30% 22%)" : "hsl(28 20% 28%)",
  };
}

export function blockAppearance(block: {
  activity_type: string;
  status: string;
  fixed: boolean;
  review_step?: number | null;
}): BlockAppearance {
  const status = (block.status as BlockVisualStatus) ?? "scheduled";
  const tone = activityTone(block.activity_type);
  const isReview = block.activity_type === "review" || block.review_step != null;

  let ring: string | null = null;
  if (status === "in_progress") ring = "hsl(32 55% 45%)";
  else if (status === "missed") ring = "hsl(4 58% 52%)";
  else if (status === "partially_completed") ring = "hsl(38 60% 48%)";

  return {
    label: activityLabel(block.activity_type),
    background: tone.background,
    // Закреплённый блок держит акцент независимо от типа занятия: «это не
    // двигается» важнее, чем «это теория».
    accent: block.fixed ? "hsl(28 18% 38%)" : tone.accent,
    border: tone.border,
    text: tone.text,
    dashed: isReview,
    faded: FADED_STATUSES.has(status),
    ring,
    statusLabel: STATUS_LABELS[status] ?? null,
    struck: status === "cancelled",
  };
}

/** Подпись длительности: «45 мин», «1 ч 30 мин». */
export function durationLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe} мин`;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

const WEEKDAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS_GENITIVE = [
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

export function weekdayShort(weekday: number): string {
  return WEEKDAY_SHORT[weekday] ?? "";
}

/** «18 августа» — для заголовка дня. Без года: он виден из недели. */
export function dayLabel(dateKey: string): string {
  const [, month, day] = dateKey.split("-").map(Number);
  return `${day} ${MONTHS_GENITIVE[(month ?? 1) - 1] ?? ""}`.trim();
}

/** «17–23 августа» или «31 августа — 6 сентября» для заголовка недели. */
export function weekLabel(days: string[]): string {
  if (days.length === 0) return "";
  const first = days[0];
  const last = days[days.length - 1];
  const [, firstMonth] = first.split("-").map(Number);
  const [, lastMonth] = last.split("-").map(Number);
  const firstDay = Number(first.split("-")[2]);
  const lastDay = Number(last.split("-")[2]);

  if (firstMonth === lastMonth) {
    return `${firstDay}–${lastDay} ${MONTHS_GENITIVE[(firstMonth ?? 1) - 1] ?? ""}`;
  }
  return `${dayLabel(first)} — ${dayLabel(last)}`;
}

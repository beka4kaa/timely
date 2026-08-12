import { formatMinutes } from "./studyplan-calendar.ts";

// Как выглядит блок в календаре: подпись, тон, состояние.
//
// Вынесено из компонента, потому что это правила, а не разметка, и их надо
// проверять таблицей. Главное правило неизменно: **тип занятия и состояние
// блока кодируются РАЗНЫМИ средствами**. Если бы оба брали заливку,
// «пропущенная теория» и «выполненная проверка» стали бы неразличимы, а именно
// эти два вопроса ученик и задаёт календарю: что это за занятие и сделал ли я
// его.
//
// ЧТО ИЗМЕНИЛОСЬ. Раньше палитра была принципиально одноцветной (hue 32):
// считалось, что разные оттенки для разных предметов превратят неделю в
// мозаику. На практике вышло наоборот — вся неделя стала одинаково бежевой
// (весь диапазон укладывался в 12% светлоты одного тона), и по цвету нельзя
// было отличить физику от алгебры. Читаемость нормального календаря держится
// на обратном принципе: цвет кодирует ИСТОЧНИК.
//
// Новое правило:
//
//     оттенок  = курс      (`courseAccent`, шесть различимых цветов)
//     плотность = вес занятия (теория бледнее, проверка плотнее)
//     состояние = рамка, приглушённость, пунктир — но НЕ заливка
//
// Мозаики не выходит, потому что заливка живёт в диапазоне 8–18% примеси
// акцента: неделя читается группами, а не пестрит.

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
  /** Занятое время штрихуется: его не двигают и оно не про учёбу. */
  hatched: boolean;
  /**
   * Закреплённое занятие: стоит на месте, но остаётся своим.
   *
   * Раньше закрепление показывали подменой акцента на серый — вместе с ним
   * блок терял и цвет курса, то есть ответ на вопрос «это какой предмет».
   * Теперь это отдельный признак: цвет остаётся курсовым, а «не двигается»
   * рисует компонент.
   */
  pinned: boolean;
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

/** Бумага, на которой лежит блок: с ней смешивается акцент курса. */
const SHEET = "#fffdfa";

/**
 * Занятое время — школа, репетитор, семейное.
 *
 * Оно намеренно БЕЗ цвета курса: это не учебная нагрузка ученика, а чужое
 * время, которое он не двигает. Нейтральный тёплый серый плюс штриховка в
 * компоненте читаются как «здесь занято», а не как ещё один предмет.
 */
export const OCCUPIED_ACCENT = "hsl(28 12% 55%)";

const OCCUPIED = {
  background: "hsl(30 10% 94%)",
  border: "hsl(30 10% 86%)",
  accent: OCCUPIED_ACCENT,
  text: "hsl(28 10% 34%)",
};

/**
 * Тон блока: оттенок даёт курс, плотность — вес занятия.
 *
 * Примесь акцента идёт от 15% у чтения до 30% у проверки. Ниже 15% предмет
 * перестаёт читаться по заливке и остаётся жить в одном канте — именно так
 * выглядела первая версия, и вся неделя снова казалась одинаково бежевой.
 * Выше 30% семь колонок начинают спорить с тёплой бумагой раздела.
 */
export function blockTone(
  accent: string,
  activityType: string,
): { background: string; border: string; text: string } {
  const weight = ACTIVITY_WEIGHT[activityType] ?? 2;
  const step = Math.min(Math.max(weight / MAX_WEIGHT, 0), 1);
  const fill = 15 + step * 15;
  return {
    background: `color-mix(in srgb, ${accent} ${fill.toFixed(0)}%, ${SHEET})`,
    border: `color-mix(in srgb, ${accent} 42%, ${SHEET})`,
    text: "#312c27",
  };
}

export function blockAppearance(
  block: {
    activity_type: string;
    status: string;
    fixed: boolean;
    review_step?: number | null;
  },
  options: {
    /** Цвет курса. Для занятого времени игнорируется. */
    accent: string;
    /** Чужое время: школа, репетитор. Не путать с `fixed` у закреплённого занятия. */
    occupied?: boolean;
  },
): BlockAppearance {
  const status = (block.status as BlockVisualStatus) ?? "scheduled";
  const occupied = options.occupied === true;
  const tone = occupied ? OCCUPIED : blockTone(options.accent, block.activity_type);
  const isReview = block.activity_type === "review" || block.review_step != null;

  let ring: string | null = null;
  if (status === "in_progress") ring = "hsl(32 55% 45%)";
  else if (status === "missed") ring = "hsl(4 58% 52%)";
  else if (status === "partially_completed") ring = "hsl(38 60% 48%)";

  return {
    label: activityLabel(block.activity_type),
    background: tone.background,
    accent: occupied ? OCCUPIED.accent : options.accent,
    border: tone.border,
    text: tone.text,
    dashed: isReview,
    faded: FADED_STATUSES.has(status),
    hatched: occupied,
    pinned: block.fixed === true && !occupied,
    ring,
    statusLabel: STATUS_LABELS[status] ?? null,
    struck: status === "cancelled",
  };
}

/**
 * День недели с предлогом: «в среду», «во вторник».
 *
 * Предлог хранится вместе со словом, а не приклеивается снаружи: у вторника он
 * «во», и склейка «в вторник» вылезла бы в первой же живой неделе.
 */
const WEEKDAY_ON = [
  "в понедельник",
  "во вторник",
  "в среду",
  "в четверг",
  "в пятницу",
  "в субботу",
  "в воскресенье",
];

export function weekdayOnLabel(weekday: number): string {
  return WEEKDAY_ON[weekday] ?? "";
}

/** Подпись длительности: «45 мин», «1 ч 30 мин». */
export function durationLabel(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe} мин`;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest === 0 ? `${hours} ч` : `${hours} ч ${rest} мин`;
}

/**
 * Время занятия целиком: «09:00–11:00 · 2 ч».
 *
 * Одного начала мало. «09:00 · 2 ч» заставляет считать конец в уме, а конец —
 * это то, что ученик и проверяет, когда прикидывает, успеет ли он на секцию.
 * Длительность при этом остаётся: она отвечает на другой вопрос — «сколько это
 * займёт», — и по двум концам считается не быстрее.
 *
 * Заезд за полночь печатается как есть: занятие с 23:30 на час кончается в
 * 00:30, и «23:30–00:30» честнее, чем «23:30–24:30».
 */
export function timeRangeLabel(
  startMinutes: number,
  durationMinutes: number,
): string {
  const end = (Math.round(startMinutes + durationMinutes) + 24 * 60) % (24 * 60);
  return `${formatMinutes(startMinutes)}–${formatMinutes(end)} · ${durationLabel(
    durationMinutes,
  )}`;
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

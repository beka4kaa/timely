// Путь курса: план и ритм → раскладка по оси ВРЕМЕНИ.
//
// Страница программы отвечает на вопрос «жить ли по этой программе три
// месяца», и все настоящие вопросы ученика лежат на оси времени: когда
// закончу, успею ли к сроку, сколько это в неделях. Прежний герой экрана —
// корешок книги — отвечал про страницы, то есть про качество генератора.
//
// ГЛАВНОЕ ПРАВИЛО: даты считает бэкенд, здесь их только раскладывают. Свой
// календарь рядом с `forecast` дал бы на одном экране два несогласных
// прогноза. Отсюда и деление: длительности глав задают ПРОПОРЦИИ, а концы
// отрезка приходят готовыми датами.
//
// Ось идёт от сегодня до позднейшей из двух дат — реалистичного финиша и
// срока. Поэтому перелёт («курс кончается позже, чем нужно») и запас
// («кончается раньше») — это одна и та же геометрия с разным знаком.

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

/** Больше восьми подписей линейка не выдерживает: дальше она хуже пустоты. */
const MAX_TICKS = 8;

/** Короче восьми недель курс размечается неделями, дальше — месяцами. */
const MONTHS_FROM_WEEKS = 8;

const MONTHS = [
  "янв",
  "фев",
  "мар",
  "апр",
  "мая",
  "июн",
  "июл",
  "авг",
  "сен",
  "окт",
  "ноя",
  "дек",
];

export interface PathModuleInput {
  id: string;
  title: string;
  /** «Глава 3», как напечатано в книге. Пусто — подпишем порядковым номером. */
  numberLabel?: string;
  minutes: number;
}

export interface PathMilestoneInput {
  id: string;
  title: string;
  /** Модуль, по завершении которого веха достигнута. */
  moduleId: string | null;
}

export interface CoursePathInput {
  modules: readonly PathModuleInput[];
  milestones?: readonly PathMilestoneInput[];
  /** Сегодня. Приходит снаружи, иначе расчёт нельзя проверить тестом. */
  today: Date;
  expectedFinish?: string | null;
  optimisticFinish?: string | null;
  realisticFinish?: string | null;
  /** `goal.desired_finish_date`. Пусто — срока не задавали. */
  deadline?: string | null;
}

export interface PathBlock {
  /** Уникален в пределах пути: глава, разрезанная сроком, даёт два блока. */
  key: string;
  moduleId: string;
  title: string;
  label: string;
  minutes: number;
  startPct: number;
  widthPct: number;
  /** Границы куска в календаре. `null`, когда календаря нет. */
  startDate: string | null;
  endDate: string | null;
  /** Кусок лежит правее срока: рисуется контуром, а не заливкой. */
  beyondDeadline: boolean;
}

export interface PathMark {
  atPct: number;
  date: string;
}

export interface PathTick {
  atPct: number;
  label: string;
}

export interface PathMilestone {
  id: string;
  title: string;
  atPct: number;
  /** Номер главы, после которой веха: «Глава 5» или «5». */
  moduleLabel: string;
}

export interface CoursePath {
  blocks: PathBlock[];
  totalMinutes: number;
  /** Есть ли календарь. Без него рисуются только пропорции глав. */
  dated: boolean;
  /** Докуда по оси дотягивается сам курс. 100 — ось кончается финишем. */
  coursePct: number;
  deadline: PathMark | null;
  /** Доля курса правее срока. Ноль — успеваем. */
  overshootPct: number;
  /** Доля оси между финишем и сроком. Ноль — запаса нет. */
  slackPct: number;
  finish: {
    optimistic: PathMark | null;
    expected: PathMark | null;
    realistic: PathMark | null;
  };
  ticks: PathTick[];
  milestones: PathMilestone[];
  /** Длина курса в неделях. `null` без календаря. */
  weeks: number | null;
}

function time(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) ? value : null;
}

function isoDay(value: number): string {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Раскладка пути. `null` — рисовать нечего: нет глав или у всех нулевое время.
 */
export function buildCoursePath(input: CoursePathInput): CoursePath | null {
  const modules = input.modules.filter((item) => item.minutes > 0);
  const totalMinutes = modules.reduce((sum, item) => sum + item.minutes, 0);
  if (modules.length === 0 || totalMinutes <= 0) return null;

  const start = input.today.getTime();
  const expected = time(input.expectedFinish);
  const realistic = time(input.realisticFinish);
  const optimistic = time(input.optimisticFinish);
  const deadline = time(input.deadline);

  // Курс кончается ожидаемой датой; реалистичная — это буфер на пропуски, и
  // растягивать по ней блоки значило бы обещать, что буфер точно уйдёт в дело.
  const courseEnd = expected ?? realistic;
  const dated = courseEnd !== null && courseEnd > start;

  // Ось тянется до самого позднего события: за срок уходит перелёт, за финиш —
  // запас. Без календаря ось — это просто сто процентов длительностей.
  const axisEnd = dated
    ? Math.max(courseEnd as number, realistic ?? 0, deadline ?? 0)
    : start;
  const axisSpan = dated ? axisEnd - start : 0;

  const pctOf = (value: number | null): number | null => {
    if (!dated || value === null || axisSpan <= 0) return null;
    const pct = ((value - start) / axisSpan) * 100;
    return Math.min(100, Math.max(0, pct));
  };
  const dateAt = (pct: number): string | null =>
    dated ? isoDay(start + (axisSpan * pct) / 100) : null;

  const coursePct = dated ? (pctOf(courseEnd) ?? 100) : 100;
  const deadlinePct = pctOf(deadline);

  const blocks: PathBlock[] = [];
  let cursor = 0;
  modules.forEach((item, index) => {
    const width = (item.minutes / totalMinutes) * coursePct;
    const label = item.numberLabel?.trim() || String(index + 1);
    const pieces: [number, number, boolean][] = [];

    // Глава, которую срок разрезает пополам, становится двумя кусками: одна
    // половина ещё в срок, другая уже нет. Без разреза пришлось бы врать в
    // любую сторону — целую главу считать успевшей или целую провалившейся.
    if (deadlinePct !== null && cursor < deadlinePct && cursor + width > deadlinePct) {
      pieces.push([cursor, deadlinePct - cursor, false]);
      pieces.push([deadlinePct, cursor + width - deadlinePct, true]);
    } else {
      pieces.push([cursor, width, deadlinePct !== null && cursor >= deadlinePct]);
    }

    pieces.forEach(([startPct, widthPct, beyondDeadline], piece) => {
      blocks.push({
        key: pieces.length > 1 ? `${item.id}-${piece}` : item.id,
        moduleId: item.id,
        title: item.title,
        label,
        minutes: item.minutes,
        startPct,
        widthPct,
        startDate: dateAt(startPct),
        endDate: dateAt(startPct + widthPct),
        beyondDeadline,
      });
    });

    cursor += width;
  });

  const mark = (value: number | null): PathMark | null => {
    const pct = pctOf(value);
    return pct === null || value === null ? null : { atPct: pct, date: isoDay(value) };
  };

  const milestones = buildMilestones(input.milestones ?? [], blocks);

  return {
    blocks,
    totalMinutes,
    dated,
    coursePct,
    deadline: mark(deadline),
    overshootPct:
      deadlinePct === null ? 0 : Math.max(0, coursePct - deadlinePct),
    slackPct: deadlinePct === null ? 0 : Math.max(0, deadlinePct - coursePct),
    finish: {
      optimistic: mark(optimistic),
      expected: mark(expected),
      realistic: mark(realistic),
    },
    ticks: dated ? buildTicks(start, axisEnd) : [],
    milestones,
    weeks: dated ? Math.max(1, Math.round(((courseEnd as number) - start) / WEEK_MS)) : null,
  };
}

/** Вехи стоят на конце своей главы: это и есть «глава пройдена». */
function buildMilestones(
  milestones: readonly PathMilestoneInput[],
  blocks: readonly PathBlock[],
): PathMilestone[] {
  const result: PathMilestone[] = [];
  for (const milestone of milestones) {
    if (!milestone.moduleId) continue;
    // Последний кусок главы: разрезанная сроком глава кончается вторым.
    let end: PathBlock | null = null;
    for (const block of blocks) {
      if (block.moduleId === milestone.moduleId) end = block;
    }
    if (!end) continue;
    result.push({
      id: milestone.id,
      title: milestone.title,
      atPct: end.startPct + end.widthPct,
      moduleLabel: end.label,
    });
  }
  return result;
}

/**
 * Линейка под осью: недели на коротком курсе, месяцы на длинном.
 *
 * Прореживается до восьми подписей. Считать по неделям год — это пятьдесят
 * две засечки, из которых не прочитать ни одной.
 */
function buildTicks(start: number, end: number): PathTick[] {
  const span = end - start;
  if (span <= 0) return [];

  const raw: PathTick[] = [];
  if (span / WEEK_MS <= MONTHS_FROM_WEEKS) {
    for (let at = start, week = 1; at < end; at += WEEK_MS, week += 1) {
      raw.push({ atPct: ((at - start) / span) * 100, label: `нед. ${week}` });
    }
  } else {
    // Первое число каждого месяца: границы месяцев ученик и так знает, и по
    // ним дата на оси читается без вычислений.
    const cursor = new Date(start);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    while (cursor.getTime() <= end) {
      const at = cursor.getTime();
      if (at >= start) {
        raw.push({
          atPct: ((at - start) / span) * 100,
          label: MONTHS[cursor.getMonth()],
        });
      }
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  if (raw.length <= MAX_TICKS) return raw;
  const step = Math.ceil(raw.length / MAX_TICKS);
  return raw.filter((_, index) => index % step === 0);
}

// Сколько курса пройдено: из занятий его расписания.
//
// Отдельного поля «прогресс» у программы нет. Настоящий след учёбы это статус
// занятий (`LearningBlock.status`), поэтому прогресс считается из них, а не
// рисуется по календарю: прошедшая дата ещё не значит, что тема пройдена.
//
// Повторения не считаются: это забота о памяти, а не новый кусок программы, и
// без них курс можно закончить на все сто процентов. Отменённое, перенесённое и
// намеренно пропущенное тоже: в план оно больше не входит.
//
// Без React и без запросов: чистые функции, проверяются тестом.

export interface ProgressBlock {
  module: string | null;
  topic: string | null;
  status: string;
  activity_type: string;
  duration_minutes: number;
}

export interface ProgressPart {
  doneMinutes: number;
  totalMinutes: number;
  /** Целые проценты. 100 только когда пройдено всё, 0 только когда не пройдено ничего. */
  percent: number;
  finished: boolean;
}

export interface CourseProgress extends ProgressPart {
  modules: Map<string, ProgressPart>;
  topics: Map<string, ProgressPart>;
}

const NOT_IN_PLAN = new Set(["cancelled", "rescheduled", "skipped"]);

/** Доля занятия, которая считается пройденной. */
function doneShare(status: string): number {
  if (status === "completed") return 1;
  if (status === "partially_completed") return 0.5;
  return 0;
}

export function percentOf(done: number, total: number): number {
  if (total <= 0 || done <= 0) return 0;
  if (done >= total) return 100;
  return Math.min(99, Math.max(1, Math.round((done / total) * 100)));
}

function part(doneMinutes: number, totalMinutes: number): ProgressPart {
  return {
    doneMinutes,
    totalMinutes,
    percent: percentOf(doneMinutes, totalMinutes),
    finished: totalMinutes > 0 && doneMinutes >= totalMinutes,
  };
}

function add(map: Map<string, [number, number]>, key: string | null, done: number, total: number) {
  if (!key) return;
  const current = map.get(key) ?? [0, 0];
  map.set(key, [current[0] + done, current[1] + total]);
}

/**
 * `programMinutes`: сколько идёт вся программа, если расписание покрывает только её часть.
 * Иначе пять пройденных тем из тридцати выглядели бы как законченный курс.
 */
export function summarizeProgress(blocks: readonly ProgressBlock[], programMinutes = 0): CourseProgress {
  let done = 0;
  let total = 0;
  const modules = new Map<string, [number, number]>();
  const topics = new Map<string, [number, number]>();

  for (const block of blocks) {
    if (NOT_IN_PLAN.has(block.status) || block.activity_type === "review") continue;
    const minutes = Math.max(0, block.duration_minutes || 0);
    const finished = minutes * doneShare(block.status);
    done += finished;
    total += minutes;
    add(modules, block.module, finished, minutes);
    add(topics, block.topic, finished, minutes);
  }

  const parts = (map: Map<string, [number, number]>) => {
    const result = new Map<string, ProgressPart>();
    map.forEach(([partDone, partTotal], key) => result.set(key, part(partDone, partTotal)));
    return result;
  };

  return { ...part(done, Math.max(total, programMinutes)), modules: parts(modules), topics: parts(topics) };
}

/** Сколько минут программы учитывать: только у расписания, которое покрывает её часть. */
export function programMinutesOf(
  schedule: { partial_by_period?: boolean },
  plan: { estimated_total_minutes: number } | null | undefined,
): number {
  return schedule.partial_by_period ? (plan?.estimated_total_minutes ?? 0) : 0;
}

export interface ProgressModule {
  id: string;
  minutes: number;
  topics: readonly { id: string }[];
}

export type StepState = "done" | "cur" | "todo";

export interface CourseStates {
  modules: Map<string, { state: StepState; percent: number }>;
  topics: Map<string, StepState>;
  currentModuleId: string | null;
  currentTopicId: string | null;
}

/**
 * Где ученик сейчас: первая непройденная тема по порядку программы.
 *
 * Глава пройдена, только когда пройдены все её темы: тема, которой не нашлось
 * места в расписании, не даёт главе закрыться раньше времени.
 */
export function locateInCourse(
  modules: readonly ProgressModule[],
  progress: CourseProgress | null,
): CourseStates {
  const states: CourseStates = {
    modules: new Map(),
    topics: new Map(),
    currentModuleId: null,
    currentTopicId: null,
  };

  for (const courseModule of modules) {
    let allDone = courseModule.topics.length > 0;
    let holdsCurrent = false;
    for (const topic of courseModule.topics) {
      const finished = progress?.topics.get(topic.id)?.finished ?? false;
      if (finished) {
        states.topics.set(topic.id, "done");
        continue;
      }
      allDone = false;
      if (states.currentTopicId === null) {
        states.currentTopicId = topic.id;
        states.currentModuleId = courseModule.id;
        holdsCurrent = true;
        states.topics.set(topic.id, "cur");
      } else {
        states.topics.set(topic.id, "todo");
      }
    }

    const counted = progress?.modules.get(courseModule.id);
    const percent = allDone
      ? 100
      : Math.min(99, percentOf(counted?.doneMinutes ?? 0, Math.max(counted?.totalMinutes ?? 0, courseModule.minutes)));
    states.modules.set(courseModule.id, {
      state: allDone ? "done" : holdsCurrent ? "cur" : "todo",
      percent,
    });
  }
  return states;
}

/** Курс пройден, только когда пройдены все темы и не осталось занятий: добавленные тоже считаются. */
export function isCourseDone(
  topicCount: number,
  states: CourseStates,
  progress: CourseProgress | null,
): boolean {
  return topicCount > 0 && states.currentTopicId === null && progress?.finished !== false;
}

// ─────────────────────────── Какое расписание считать ────────────────────────

const SCHEDULE_ORDER: Record<string, number> = {
  active: 0,
  confirmed: 1,
  completed: 2,
  proposed: 3,
  draft: 4,
};

export interface ScheduleRef {
  id: string;
  course_plan: string;
  status: string;
  version: number;
  created_at: string;
}

/**
 * Расписание, по которому ученик занимается.
 *
 * Новое предложение ещё не заменило действующее: его занятия ни разу не отмечены,
 * и считать по нему значило бы показать ноль поверх сделанной работы. Архив не
 * считается вовсе.
 */
export function pickProgressSchedule<T extends ScheduleRef>(schedules: readonly T[]): T | null {
  let best: T | null = null;
  for (const schedule of schedules) {
    const rank = SCHEDULE_ORDER[schedule.status];
    if (rank === undefined) continue;
    if (!best) {
      best = schedule;
      continue;
    }
    const bestRank = SCHEDULE_ORDER[best.status];
    if (
      rank < bestRank ||
      (rank === bestRank && schedule.created_at > best.created_at)
    ) {
      best = schedule;
    }
  }
  return best;
}

// ──────────────────────────── Подпись срока в каталоге ───────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/** Меньше этого запаса до срока это уже впритык. */
const TIGHT_DAYS = 14;

/**
 * Что сказать про срок курса одной строкой: «до 14 марта», «до 28 апреля, впритык».
 *
 * `tight` просит выделить строку: с этим сроком надо что-то решать.
 */
export function courseFinishLine(
  finish: string | null | undefined,
  deadline: string | null | undefined,
  dayMonth: (iso: string) => string,
): { text: string; tight: boolean } | null {
  if (!finish) {
    return deadline ? { text: `срок ${dayMonth(deadline)}`, tight: false } : null;
  }
  if (!deadline) return { text: `до ${dayMonth(finish)}`, tight: false };

  const slack = (new Date(deadline).getTime() - new Date(finish).getTime()) / DAY_MS;
  if (slack < 0) {
    return { text: `срок ${dayMonth(deadline)}, не успеваешь`, tight: true };
  }
  if (slack <= TIGHT_DAYS) return { text: `до ${dayMonth(finish)}, впритык`, tight: true };
  return { text: `до ${dayMonth(finish)}`, tight: false };
}

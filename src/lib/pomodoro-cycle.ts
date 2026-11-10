// Цикл помодоро: фокус, перерыв и длинный перерыв после каждого N-го фокуса.
//
// Здесь только чистые функции: состояние таймера на входе, новое состояние на выходе.
// Стор вызывает их с `Date.now()`, а тесты с любым моментом, поэтому вся логика
// переходов, сброса счёта, заголовка вкладки и звонка проверяется без браузера.

import { minutesWord } from "./pomodoro.logic";
import {
  CUSTOM_PRESET,
  DEFAULT_PRESET_INDEX,
  MIN_LOGGED_SECONDS,
  PRESETS,
  clockOf,
  dayKey,
  type FocusSessionPayload,
  type Rhythm,
  type TimerPhase,
} from "./pomodoro";

export { CUSTOM_PRESET, isLongBreakRow, type Rhythm, type TimerPhase } from "./pomodoro";

/** Простой дольше часа начинает цикл заново. */
export const IDLE_RESET_MS = 60 * 60 * 1000;
/** Дольше двух минут звонок не звонит. Фаза, кончившаяся раньше, уже не озвучивается. */
export const RING_LIMIT_MS = 2 * 60 * 1000;
/** Такт звонка: удар колокольчиков, потом тишина до следующего. */
export const BELL_EVERY_MS = 4000;
/** При автостарте звонок звучит пару раз и не повторяется. */
const AUTO_RINGS = 2;

export const PHASE_LABEL: Record<TimerPhase, string> = {
  focus: "Фокус",
  break: "Перерыв",
  long: "Длинный перерыв",
};

// ─────────────────────────── Ритм ───────────────────────────

// Готовые ритмы без подписей. Объекты созданы один раз: селектор стора возвращает
// ту же ссылку, и React не перерисовывает подписчиков на каждом тике.
const PRESET_RHYTHMS: Rhythm[] = PRESETS.map(({ focus, brk, long, every }) => ({ focus, brk, long, every }));

export const RHYTHM_LIMITS: Record<keyof Rhythm, readonly [number, number]> = {
  focus: [5, 180],
  brk: [1, 60],
  long: [5, 90],
  every: [2, 10],
};

const RHYTHM_KEYS: Array<keyof Rhythm> = ["focus", "brk", "long", "every"];

function limitError(key: keyof Rhythm): string {
  const [low, high] = RHYTHM_LIMITS[key];
  return key === "every" ? `От ${low} до ${high}` : `От ${low} до ${high} мин`;
}

function inLimits(key: keyof Rhythm, value: unknown): value is number {
  const [low, high] = RHYTHM_LIMITS[key];
  return typeof value === "number" && Number.isInteger(value) && value >= low && value <= high;
}

/** Ритм, которому можно верить: всё в границах и длинный перерыв не короче обычного. */
export function isRhythm(value: unknown): value is Rhythm {
  if (!value || typeof value !== "object") return false;
  const rhythm = value as Record<string, unknown>;
  return RHYTHM_KEYS.every((key) => inLimits(key, rhythm[key])) && (rhythm.long as number) >= (rhythm.brk as number);
}

export type RhythmDraft = Record<keyof Rhythm, string>;
export type RhythmErrors = Partial<Record<keyof Rhythm, string>>;

/** Проверяет поля «Своего» ритма. Ошибка стоит у того поля, которое надо поправить. */
export function checkRhythm(draft: RhythmDraft): { rhythm: Rhythm | null; errors: RhythmErrors } {
  const errors: RhythmErrors = {};
  const values: Partial<Rhythm> = {};
  for (const key of RHYTHM_KEYS) {
    const text = draft[key].trim();
    const value = /^\d{1,4}$/.test(text) ? Number(text) : Number.NaN;
    if (inLimits(key, value)) values[key] = value;
    else errors[key] = limitError(key);
  }
  if (!errors.brk && !errors.long && (values.long as number) < (values.brk as number)) {
    errors.long = "Не короче перерыва";
  }
  if (Object.keys(errors).length) return { rhythm: null, errors };
  return { rhythm: values as Rhythm, errors };
}

/** Ритм, по которому идёт таймер. Испорченное «Своё» не роняет таймер. */
export function rhythmOf(presetIdx: number, custom: Rhythm | null): Rhythm {
  if (presetIdx === CUSTOM_PRESET && isRhythm(custom)) return custom;
  return PRESET_RHYTHMS[presetIdx] ?? PRESET_RHYTHMS[DEFAULT_PRESET_INDEX];
}

export function rhythmLabel(rhythm: Rhythm): string {
  return `${rhythm.focus}/${rhythm.brk}/${rhythm.long}`;
}

/** «Фокус 25 мин, перерыв 5, длинный 15 после 4 сессий»: подсказка на кнопке ритма. */
export function rhythmHint(rhythm: Rhythm): string {
  return `Фокус ${rhythm.focus} мин, перерыв ${rhythm.brk}, длинный ${rhythm.long} после ${rhythm.every} сессий`;
}

export function phaseSeconds(rhythm: Rhythm, phase: TimerPhase): number {
  const minutes = phase === "focus" ? rhythm.focus : phase === "break" ? rhythm.brk : rhythm.long;
  return minutes * 60;
}

// ─────────────────────────── Состояние ───────────────────────────

/** Фаза кончилась: звонок, уведомление и мигающий заголовок. */
export interface Alarm {
  /** Что теперь: перерыв, длинный перерыв или фокус. */
  next: TimerPhase;
  /** Когда кончилась прошлая фаза, epoch ms. От него, а не от «сейчас», считается звонок. */
  at: number;
  /** Следующая фаза пошла сама: звонок короткий и клика не ждёт. */
  auto: boolean;
}

export interface TimerCore {
  phase: TimerPhase;
  running: boolean;
  /** Момент окончания текущей фазы, epoch ms. Заполнен, только когда идёт отсчёт. */
  endsAt: number | null;
  /** Остаток, пока отсчёт стоит, секунды. */
  remainingWhenPaused: number;
  /**
   * Ритм, по которому идёт текущая фаза. Задаётся, когда фаза начинается с нуля: начатая
   * доходит в своей длине и пишется в лог со своим ритмом, даже если его поменяли посередине.
   */
  phaseRhythm: Rhythm;
  /** Когда фаза началась. `null`, пока её не запускали: она нетронутая. */
  phaseStartedAt: number | null;
  /** Сколько фокусов цикла дошли до конца сами. Пропущенные и сброшенные не в счёт. */
  done: number;
  /** С какого момента таймер стоит. От него считается простой. */
  idleSince: number | null;
  alarm: Alarm | null;
}

export interface AutoStart {
  autoBreak: boolean;
  autoFocus: boolean;
}

export function freshCore(rhythm: Rhythm): TimerCore {
  return {
    phase: "focus",
    running: false,
    endsAt: null,
    remainingWhenPaused: phaseSeconds(rhythm, "focus"),
    phaseRhythm: rhythm,
    phaseStartedAt: null,
    done: 0,
    idleSince: null,
    alarm: null,
  };
}

/** Длина текущей фазы в секундах: по ритму, с которым она началась. */
export function plannedOf(core: Pick<TimerCore, "phase" | "phaseRhythm">): number {
  return phaseSeconds(core.phaseRhythm, core.phase);
}

/** Остаток текущей фазы в секундах. */
export function remainingOf(core: TimerCore, now: number): number {
  if (core.running && core.endsAt !== null) return Math.max(0, Math.ceil((core.endsAt - now) / 1000));
  return core.remainingWhenPaused;
}

/** Простой: дольше часа или уже другой день. */
export function isIdleStale(idleSince: number, now: number): boolean {
  return now - idleSince > IDLE_RESET_MS || dayKey(new Date(idleSince)) !== dayKey(new Date(now));
}

/**
 * После простоя цикл начинается заново: счёт в ноль, звонок забыт, а нетронутый перерыв
 * уступает место фокусу. Начатую фазу не трогаем: её ещё можно доделать.
 */
export function settleIdle(core: TimerCore, rhythm: Rhythm, now: number): TimerCore {
  if (core.running || core.idleSince === null || !isIdleStale(core.idleSince, now)) return core;
  const toFocus = core.phaseStartedAt === null && core.phase !== "focus";
  if (core.done === 0 && core.alarm === null && !toFocus) return core;
  return {
    ...core,
    done: 0,
    alarm: null,
    ...(toFocus
      ? { phase: "focus" as const, remainingWhenPaused: phaseSeconds(rhythm, "focus"), phaseRhythm: rhythm }
      : {}),
  };
}

export function startCore(core: TimerCore, rhythm: Rhythm, now: number): TimerCore {
  if (core.running) return core;
  const settled = settleIdle(core, rhythm, now);
  return {
    ...settled,
    running: true,
    endsAt: now + settled.remainingWhenPaused * 1000,
    phaseStartedAt: settled.phaseStartedAt ?? now,
    idleSince: null,
    alarm: null,
  };
}

export function pauseCore(core: TimerCore, now: number): TimerCore {
  if (!core.running) return core;
  return {
    ...core,
    running: false,
    endsAt: null,
    remainingWhenPaused: remainingOf(core, now),
    idleSince: now,
    alarm: null,
  };
}

/** «Сбросить»: фаза с начала, уже по текущему ритму. Сброшенный фокус не засчитывается и не пишется. */
export function resetCore(core: TimerCore, rhythm: Rhythm, now: number): TimerCore {
  return {
    ...core,
    running: false,
    endsAt: null,
    remainingWhenPaused: phaseSeconds(rhythm, core.phase),
    phaseRhythm: rhythm,
    phaseStartedAt: null,
    idleSince: now,
    alarm: null,
  };
}

export function dismissCore(core: TimerCore): TimerCore {
  return core.alarm ? { ...core, alarm: null } : core;
}

/**
 * Конец фазы. `natural` — дошла до нуля сама, иначе ученик нажал «Дальше».
 *
 * Засчитывается только фокус, дошедший до конца сам, и только он может привести
 * к длинному перерыву. Следующая фаза по умолчанию ждёт клика,
 * а с автостартом идёт от настоящего конца прошлой, даже если тик пришёл с опозданием.
 * Фаза, кончившаяся давно (вкладка была закрыта), сама уже не стартует.
 */
export function finishCore(
  core: TimerCore,
  rhythm: Rhythm,
  auto: AutoStart,
  now: number,
  natural: boolean,
): { core: TimerCore; log: FocusSessionPayload | null } {
  const planned = plannedOf(core);
  const remaining = natural ? 0 : remainingOf(core, now);
  const worked = Math.min(planned, Math.max(0, planned - remaining));

  const log: FocusSessionPayload | null =
    worked >= MIN_LOGGED_SECONDS
      ? {
          kind: core.phase === "focus" ? "focus" : "break",
          started_at: new Date(core.phaseStartedAt ?? now).toISOString(),
          seconds: Math.round(worked),
          planned_seconds: planned,
          // Ритм той же фазы: по паре длины и перерыва история отличает длинный перерыв.
          preset_focus_min: core.phaseRhythm.focus,
          preset_break_min: core.phaseRhythm.brk,
        }
      : null;

  let done = core.done;
  let next: TimerPhase;
  if (core.phase === "focus") {
    if (natural) done += 1;
    next = natural && done >= rhythm.every ? "long" : "break";
  } else {
    if (core.phase === "long") done = 0;
    next = "focus";
  }

  const nextPlanned = phaseSeconds(rhythm, next);
  const after = { ...core, phase: next, done, remainingWhenPaused: nextPlanned, phaseRhythm: rhythm };

  if (!natural) {
    return {
      core: { ...after, running: false, endsAt: null, phaseStartedAt: null, idleSince: now, alarm: null },
      log,
    };
  }

  const endedAt = core.endsAt ?? now;
  const fresh = now - endedAt < RING_LIMIT_MS;
  const autoStart = fresh && (next === "focus" ? auto.autoFocus : auto.autoBreak);

  if (autoStart) {
    return {
      core: {
        ...after,
        running: true,
        endsAt: endedAt + nextPlanned * 1000,
        phaseStartedAt: endedAt,
        idleSince: null,
        alarm: { next, at: endedAt, auto: true },
      },
      log,
    };
  }

  return {
    core: {
      ...after,
      running: false,
      endsAt: null,
      phaseStartedAt: null,
      idleSince: endedAt,
      alarm: { next, at: endedAt, auto: false },
    },
    log,
  };
}

/** Секундный тик: закончить фазу, если время вышло, и прибрать простой и старый звонок. */
export function advanceCore(
  core: TimerCore,
  rhythm: Rhythm,
  auto: AutoStart,
  now: number,
): { core: TimerCore; log: FocusSessionPayload | null } {
  if (core.running && core.endsAt !== null && now >= core.endsAt) {
    return finishCore(core, rhythm, auto, now, true);
  }
  let next = settleIdle(core, rhythm, now);
  if (next.alarm?.auto && now - next.alarm.at > RING_LIMIT_MS) next = { ...next, alarm: null };
  return { core: next, log: null };
}

/**
 * Ритм поменялся. Нетронутая фаза сразу получает новую длину, а начатая доходит в своей:
 * новый ритм начнётся со следующей фазы. Так выбор ритма посреди фокуса его не обрывает
 * и не урезает записанное время.
 *
 * Счёт не трогаем: туда и обратно по ритмам прогресс не теряется. Если сделано уже не
 * меньше нового цикла, длинный перерыв даст следующий фокус, дошедший до конца.
 */
export function replanCore(core: TimerCore, rhythm: Rhythm): TimerCore {
  if (core.running || core.phaseStartedAt !== null) return core;
  const remaining = phaseSeconds(rhythm, core.phase);
  if (core.phaseRhythm === rhythm && core.remainingWhenPaused === remaining) return core;
  return { ...core, phaseRhythm: rhythm, remainingWhenPaused: remaining };
}

/**
 * Нетронутая фаза становится фокусом: кнопка «Фокус на N мин» на главной обещает фокус.
 * Ждущий длинный перерыв при этом пропущен целиком, и цикл начинается заново.
 */
export function focusCore(core: TimerCore, rhythm: Rhythm, now: number): TimerCore {
  if (core.running || core.phaseStartedAt !== null) return core;
  const settled = settleIdle(core, rhythm, now);
  return {
    ...settled,
    phase: "focus",
    done: settled.phase === "long" ? 0 : settled.done,
    remainingWhenPaused: phaseSeconds(rhythm, "focus"),
    phaseRhythm: rhythm,
    alarm: null,
  };
}

// ─────────────────────────── Хранение ───────────────────────────

/**
 * Сохранённое до длинных перерывов (версия 0). Счёт тогда копился без сброса, поэтому
 * цикл начинается с нуля; звонка и простоя в старом сохранении не было.
 */
export function migrateSaved(persisted: unknown, version: number): Record<string, unknown> {
  const state = { ...((persisted && typeof persisted === "object" ? persisted : {}) as Record<string, unknown>) };
  if (version < 1) {
    delete state.cycles;
    state.done = 0;
    state.idleSince = null;
    state.alarm = null;
  }
  return state;
}

/**
 * Сохранённое поверх начального состояния. Ритма фазы в старом сохранении нет, а
 * испорченное хранилище не должно сломать отсчёт: тогда фаза идёт по выбранному ритму.
 * Смотрим именно на сохранённое: в начальном состоянии лежит ритм по умолчанию.
 */
export function mergeSaved<T extends { presetIdx: number; custom: Rhythm | null; phaseRhythm: Rhythm }>(
  persisted: unknown,
  current: T,
): T {
  const saved = (persisted && typeof persisted === "object" ? persisted : {}) as Partial<T>;
  const merged = { ...current, ...saved };
  if (!isRhythm(saved.phaseRhythm)) merged.phaseRhythm = rhythmOf(merged.presetIdx, merged.custom);
  return merged;
}

// ─────────────────────────── Показ ───────────────────────────

export type CycleDot = "done" | "now" | "todo";

/** «сессия», «сессии», «сессий». */
export function sessionsWord(count: number): string {
  const hundred = count % 100;
  const ten = hundred % 10;
  if (hundred > 10 && hundred < 20) return "сессий";
  if (ten === 1) return "сессия";
  if (ten >= 2 && ten <= 4) return "сессии";
  return "сессий";
}

/** Где ученик в цикле: точка на фокус, текущий отмечен. */
export function cycleDots(phase: TimerPhase, done: number, every: number): { dots: CycleDot[]; label: string } {
  // Вне длинного перерыва сделано не больше, чем на одну сессию меньше цикла: иначе
  // был бы уже длинный. Испорченный счёт не покажет «ещё 0».
  const filled = phase === "long" ? every : Math.min(done, every - 1);
  const dots = Array.from({ length: every }, (_, index): CycleDot =>
    index < filled ? "done" : phase === "focus" && index === filled ? "now" : "todo",
  );
  if (phase === "long") return { dots, label: "Длинный перерыв" };
  const left = every - filled;
  return { dots, label: `Ещё ${left} ${sessionsWord(left)} до длинного перерыва` };
}

/** Зов, когда фаза кончилась: на вкладке, на кнопке и в плашке. */
export function alarmTitle(next: TimerPhase): string {
  if (next === "focus") return "Пора работать!";
  return next === "long" ? "Пора на длинный перерыв!" : "Пора на перерыв!";
}

/**
 * Заголовок вкладки: «24:13 · Фокус», на паузе с пометкой, а когда фаза кончилась и ждёт
 * клика, мигает зов. Без таймера обычный заголовок страницы.
 */
export function tabTitle({
  phase,
  remaining,
  running,
  started,
  alarm,
  base,
  blink,
}: {
  phase: TimerPhase;
  remaining: number;
  running: boolean;
  /** Фаза начата: идёт или стоит на паузе посередине. */
  started: boolean;
  alarm: Alarm | null;
  /** Заголовок страницы без таймера. */
  base: string;
  /** Половина мигания, в которой виден зов. */
  blink: boolean;
}): string {
  if (alarm && !alarm.auto) return blink ? alarmTitle(alarm.next) : base;
  const clock = `${clockOf(remaining)} · ${PHASE_LABEL[phase]}`;
  if (running) return clock;
  if (started) return `⏸ ${clock}`;
  return base;
}

/** Текст системного уведомления. Название сессии, если есть, идёт второй строкой. */
export function alarmNotice(next: TimerPhase, rhythm: Rhythm, name: string): { title: string; body: string } {
  const minutes = Math.round(phaseSeconds(rhythm, next) / 60);
  const length = `${minutes} ${minutesWord(minutes)}`;
  const title =
    next === "focus"
      ? "Перерыв закончился, пора работать"
      : next === "long"
        ? `Пора на длинный перерыв: ${length}`
        : `Пора на перерыв: ${length}`;
  return { title, body: name.trim() };
}

/**
 * Показывать ли уведомление о конце фазы. Отметка общая для всех вкладок и переживает
 * перезагрузку, поэтому одно и то же «Пора на перерыв» не придёт дважды.
 */
export function shouldNotify(alarm: Alarm | null, notifiedAt: number | null, now: number): boolean {
  return alarm !== null && alarm.at !== notifiedAt && now - alarm.at < RING_LIMIT_MS;
}

/**
 * Сколько ударов звонка ещё поставить. Ждущая фаза зовёт каждые несколько секунд, но не
 * дольше двух минут от конца, поэтому давно кончившаяся фаза молчит. Автостарт звенит пару раз.
 */
export function ringBursts(alarm: Alarm, now: number): number {
  const age = Math.max(0, now - alarm.at);
  if (age >= RING_LIMIT_MS) return 0;
  if (alarm.auto) return AUTO_RINGS;
  return Math.ceil((RING_LIMIT_MS - age) / BELL_EVERY_MS);
}

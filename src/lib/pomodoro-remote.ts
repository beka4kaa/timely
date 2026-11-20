// Идущий таймер на всех устройствах ученика: что уходит на сервер и что с него берётся.
//
// На сервер идёт только сам таймер (фаза, когда кончится, остаток на паузе, ритм, звонок)
// и название сессии. Звук, громкость, очередь сессий и тик у каждого устройства свои.
// С сервера берётся только целое состояние: испорченная запись не должна сломать таймер.

import type { Rhythm, TimerPhase } from "./pomodoro";
import { isRhythm, type Alarm, type Run, type TimerCore } from "./pomodoro-cycle";

export interface TimerSnapshot extends TimerCore {
  /** Индекс в `PRESETS` или `CUSTOM_PRESET`. */
  presetIdx: number;
  custom: Rhythm | null;
  /** Над чем работаешь. */
  name: string;
}

const NAME_LIMIT = 120;
const PHASES: readonly TimerPhase[] = ["focus", "break", "long"];

/** Общая часть состояния, ключи всегда в одном порядке: так снимки сравниваются строкой. */
export function timerSnapshot(state: TimerCore & { presetIdx: number; custom: Rhythm | null }, name: string): TimerSnapshot {
  return {
    presetIdx: state.presetIdx,
    custom: state.custom,
    phase: state.phase,
    running: state.running,
    endsAt: state.endsAt,
    remainingWhenPaused: state.remainingWhenPaused,
    phaseRhythm: state.phaseRhythm,
    phaseStartedAt: state.phaseStartedAt,
    done: state.done,
    idleSince: state.idleSince,
    alarm: state.alarm,
    runs: state.runs ?? [],
    name: name.trim().slice(0, NAME_LIMIT),
  };
}

export function sameTimer(a: TimerSnapshot, b: TimerSnapshot): boolean {
  return JSON.stringify(timerSnapshot(a, a.name)) === JSON.stringify(timerSnapshot(b, b.name));
}

const isMoment = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const isMomentOrNull = (value: unknown): value is number | null => value === null || isMoment(value);
const isPhase = (value: unknown): value is TimerPhase => PHASES.includes(value as TimerPhase);

function isAlarm(value: unknown): value is Alarm | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const alarm = value as Record<string, unknown>;
  return isPhase(alarm.next) && isMoment(alarm.at) && typeof alarm.auto === "boolean";
}

/** Отрезки работы фазы. У таймера с прошлой версией приложения их нет вовсе: это не порча. */
function isRuns(value: unknown): value is Run[] | undefined {
  if (value === undefined) return true;
  return (
    Array.isArray(value) &&
    value.every((run) => Array.isArray(run) && run.length === 2 && isMoment(run[0]) && isMoment(run[1]) && run[1] > run[0])
  );
}

/** Состояние с сервера, если оно целое; иначе `null`, и таймер остаётся как был. */
export function remoteTimer(raw: unknown): TimerSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Record<string, unknown>;
  const valid =
    Number.isInteger(data.presetIdx) &&
    (data.custom === null || isRhythm(data.custom)) &&
    isPhase(data.phase) &&
    typeof data.running === "boolean" &&
    isMomentOrNull(data.endsAt) &&
    (!data.running || data.endsAt !== null) &&
    isMoment(data.remainingWhenPaused) &&
    isRhythm(data.phaseRhythm) &&
    isMomentOrNull(data.phaseStartedAt) &&
    Number.isInteger(data.done) &&
    (data.done as number) >= 0 &&
    isMomentOrNull(data.idleSince) &&
    isAlarm(data.alarm) &&
    isRuns(data.runs) &&
    (data.name === undefined || typeof data.name === "string");
  if (!valid) return null;
  return timerSnapshot(data as unknown as TimerSnapshot, typeof data.name === "string" ? data.name : "");
}

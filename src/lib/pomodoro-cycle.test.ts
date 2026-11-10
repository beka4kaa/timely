import assert from "node:assert/strict";
import test from "node:test";

import {
  BELL_EVERY_MS,
  CUSTOM_PRESET,
  IDLE_RESET_MS,
  RING_LIMIT_MS,
  advanceCore,
  alarmNotice,
  alarmTitle,
  checkRhythm,
  cycleDots,
  dismissCore,
  finishCore,
  focusCore,
  freshCore,
  isIdleStale,
  isLongBreakRow,
  mergeSaved,
  migrateSaved,
  pauseCore,
  phaseSeconds,
  plannedOf,
  remainingOf,
  replanCore,
  resetCore,
  rhythmLabel,
  rhythmOf,
  ringBursts,
  settleIdle,
  shouldNotify,
  startCore,
  tabTitle,
  type Rhythm,
  type TimerCore,
} from "./pomodoro-cycle";
import { PRESETS, DEFAULT_PRESET_INDEX } from "./pomodoro";

// Вторник, 10 ноября 2026, 15:00 по местному времени: тесты не зависят от пояса машины.
const T0 = new Date(2026, 10, 10, 15, 0, 0).getTime();
const MIN = 60_000;

const CLASSIC: Rhythm = { focus: 25, brk: 5, long: 15, every: 4 };
const MANUAL = { autoBreak: false, autoFocus: false };
const AUTO = { autoBreak: true, autoFocus: true };

/** Фокус шёл и сам дошёл до нуля ровно сейчас. */
function focusEndingAt(at: number, overrides: Partial<TimerCore> = {}): TimerCore {
  return {
    ...freshCore(CLASSIC),
    running: true,
    endsAt: at,
    phaseStartedAt: at - 25 * MIN,
    ...overrides,
  };
}

/** Проходит фазу до конца и возвращает состояние после неё. */
function runOut(core: TimerCore, rhythm: Rhythm = CLASSIC, auto = MANUAL): TimerCore {
  const started = startCore(core, rhythm, T0);
  const end = started.endsAt ?? T0;
  return advanceCore(started, rhythm, auto, end).core;
}

// ─────────────────────────── Ритмы ───────────────────────────

test("старые ритмы на месте и в том же порядке, у каждого есть длинный перерыв", () => {
  assert.deepEqual(
    PRESETS.map((preset) => [preset.focus, preset.brk]),
    [
      [25, 5],
      [50, 10],
      [60, 10],
      [90, 20],
      [45, 15],
    ],
  );
  for (const preset of PRESETS) {
    assert.ok(preset.long >= preset.brk, `${preset.focus}/${preset.brk}: длинный не короче обычного`);
    assert.ok(preset.every >= 2 && preset.every <= 10);
  }
  assert.deepEqual(rhythmOf(0, null), { focus: 25, brk: 5, long: 15, every: 4 });
  assert.deepEqual(rhythmOf(1, null), { focus: 50, brk: 10, long: 30, every: 3 });
  assert.deepEqual(rhythmOf(3, null), { focus: 90, brk: 20, long: 30, every: 2 });
});

test("свой ритм берётся, только когда выбран и он правильный", () => {
  const mine: Rhythm = { focus: 40, brk: 8, long: 20, every: 3 };
  assert.deepEqual(rhythmOf(CUSTOM_PRESET, mine), mine);
  // Своё выбрано, но значений нет или они испорчены в хранилище: обычный ритм по умолчанию.
  const fallback = rhythmOf(DEFAULT_PRESET_INDEX, null);
  assert.deepEqual(rhythmOf(CUSTOM_PRESET, null), fallback);
  assert.deepEqual(rhythmOf(CUSTOM_PRESET, { focus: 0, brk: 8, long: 20, every: 3 }), fallback);
  // Пресет выбран: своё лежит про запас и не мешает.
  assert.deepEqual(rhythmOf(0, mine), rhythmOf(0, null));
  // Неизвестный индекс не роняет таймер.
  assert.deepEqual(rhythmOf(42, null), fallback);
});

test("ритм в селекторах стора: одна и та же ссылка, чтобы React не перерисовывал по кругу", () => {
  const mine: Rhythm = { focus: 40, brk: 8, long: 20, every: 3 };
  assert.equal(rhythmOf(CUSTOM_PRESET, mine), mine);
  assert.equal(rhythmOf(2, mine), rhythmOf(2, null));
});

test("подпись ритма: три числа через косую черту", () => {
  assert.equal(rhythmLabel({ focus: 50, brk: 10, long: 30, every: 3 }), "50/10/30");
});

test("длина фазы в секундах", () => {
  assert.equal(phaseSeconds(CLASSIC, "focus"), 25 * 60);
  assert.equal(phaseSeconds(CLASSIC, "break"), 5 * 60);
  assert.equal(phaseSeconds(CLASSIC, "long"), 15 * 60);
});

// ─────────────────────── Свои значения ───────────────────────

const draft = (focus: string, brk: string, long: string, every: string) => ({ focus, brk, long, every });

test("свои значения: правильные превращаются в ритм", () => {
  assert.deepEqual(checkRhythm(draft("40", "8", "20", "3")), {
    rhythm: { focus: 40, brk: 8, long: 20, every: 3 },
    errors: {},
  });
  assert.deepEqual(checkRhythm(draft(" 45 ", "15", "30", "2")).rhythm, { focus: 45, brk: 15, long: 30, every: 2 });
});

test("свои значения: границы включительно", () => {
  assert.ok(checkRhythm(draft("5", "1", "5", "2")).rhythm);
  assert.ok(checkRhythm(draft("180", "60", "90", "10")).rhythm);
});

test("свои значения: за границами ошибка у своего поля", () => {
  const result = checkRhythm(draft("4", "61", "91", "1"));
  assert.equal(result.rhythm, null);
  assert.deepEqual(result.errors, {
    focus: "От 5 до 180 мин",
    brk: "От 1 до 60 мин",
    long: "От 5 до 90 мин",
    every: "От 2 до 10",
  });
  assert.deepEqual(checkRhythm(draft("181", "0", "4", "11")).errors, {
    focus: "От 5 до 180 мин",
    brk: "От 1 до 60 мин",
    long: "От 5 до 90 мин",
    every: "От 2 до 10",
  });
});

test("свои значения: только целые числа", () => {
  for (const bad of ["", " ", "2.5", "25,5", "-5", "1e2", "abc", "25 мин"]) {
    const result = checkRhythm(draft(bad, "5", "15", "4"));
    assert.equal(result.rhythm, null, `«${bad}» не число минут`);
    assert.equal(result.errors.focus, "От 5 до 180 мин");
  }
});

test("свои значения: длинный перерыв не короче обычного", () => {
  const result = checkRhythm(draft("50", "30", "20", "3"));
  assert.equal(result.rhythm, null);
  assert.deepEqual(result.errors, { long: "Не короче перерыва" });
  assert.ok(checkRhythm(draft("50", "20", "20", "3")).rhythm, "равный обычному можно");
});

// ─────────────────────────── Цикл ───────────────────────────

test("фокус дошёл до нуля: счёт растёт, дальше перерыв", () => {
  const { core, log } = advanceCore(focusEndingAt(T0), CLASSIC, MANUAL, T0);
  assert.equal(core.phase, "break");
  assert.equal(core.done, 1);
  assert.equal(core.running, false);
  assert.equal(core.remainingWhenPaused, 5 * 60);
  assert.ok(log);
  assert.equal(log.kind, "focus");
  assert.equal(log.seconds, 25 * 60);
  assert.equal(log.planned_seconds, 25 * 60);
});

test("каждый N-й завершённый фокус ведёт на длинный перерыв", () => {
  let core = freshCore(CLASSIC);
  const phases: string[] = [];
  for (let step = 0; step < 10; step += 1) {
    core = runOut(core);
    phases.push(core.phase);
  }
  assert.deepEqual(phases, [
    "break", "focus",
    "break", "focus",
    "break", "focus",
    "long", "focus",
    "break", "focus",
  ]);
});

test("после длинного перерыва счёт обнуляется", () => {
  let core = freshCore(CLASSIC);
  for (let step = 0; step < 7; step += 1) core = runOut(core);
  assert.equal(core.phase, "long");
  assert.equal(core.done, 4);
  core = runOut(core);
  assert.equal(core.phase, "focus");
  assert.equal(core.done, 0);
});

test("длинный перерыв пишется в лог как перерыв: тьютор считает только фокус", () => {
  const core: TimerCore = {
    ...freshCore(CLASSIC),
    phase: "long",
    done: 4,
    running: true,
    endsAt: T0,
    phaseStartedAt: T0 - 15 * MIN,
  };
  const { log } = advanceCore(core, CLASSIC, MANUAL, T0);
  assert.ok(log);
  assert.equal(log.kind, "break");
  assert.equal(log.planned_seconds, 15 * 60);
  assert.equal(log.preset_break_min, 5);
  assert.ok(isLongBreakRow({ kind: log.kind, planned_seconds: log.planned_seconds, preset_break_min: log.preset_break_min }));
  assert.ok(!isLongBreakRow({ kind: "break", planned_seconds: 5 * 60, preset_break_min: 5 }));
  assert.ok(!isLongBreakRow({ kind: "focus", planned_seconds: 25 * 60, preset_break_min: 5 }));
});

test("пропущенный фокус не считается, но отработанное время пишется", () => {
  const running = startCore(freshCore(CLASSIC), CLASSIC, T0);
  const { core, log } = finishCore(running, CLASSIC, MANUAL, T0 + 10 * MIN, false);
  assert.equal(core.phase, "break");
  assert.equal(core.done, 0);
  assert.equal(core.running, false);
  assert.equal(core.alarm, null, "сам нажал «Дальше», звонить незачем");
  assert.ok(log);
  assert.equal(log.seconds, 10 * 60);
});

test("пропуск на последнем фокусе цикла не даёт длинного перерыва", () => {
  const core: TimerCore = { ...startCore(freshCore(CLASSIC), CLASSIC, T0), done: 3 };
  const after = finishCore(core, CLASSIC, MANUAL, T0 + 5 * MIN, false).core;
  assert.equal(after.phase, "break");
  assert.equal(after.done, 3);
});

test("пропуск никогда не ведёт на длинный перерыв, даже если счёт уже набран", () => {
  const core: TimerCore = { ...startCore(freshCore(CLASSIC), CLASSIC, T0), done: 4 };
  assert.equal(finishCore(core, CLASSIC, MANUAL, T0 + MIN, false).core.phase, "break");
});

test("сброс фокуса не считается и не пишется", () => {
  const running = startCore({ ...freshCore(CLASSIC), done: 2 }, CLASSIC, T0);
  const after = resetCore(running, CLASSIC, T0 + 10 * MIN);
  assert.equal(after.done, 2);
  assert.equal(after.phase, "focus");
  assert.equal(after.running, false);
  assert.equal(after.remainingWhenPaused, 25 * 60);
  assert.equal(after.phaseStartedAt, null);
});

test("пропуск длинного перерыва тоже начинает новый цикл", () => {
  const core: TimerCore = { ...freshCore(CLASSIC), phase: "long", done: 4, remainingWhenPaused: 15 * 60 };
  const after = finishCore(core, CLASSIC, MANUAL, T0, false).core;
  assert.equal(after.phase, "focus");
  assert.equal(after.done, 0);
});

test("пауза и продолжение не мешают фокусу засчитаться", () => {
  let core = startCore(freshCore(CLASSIC), CLASSIC, T0);
  core = pauseCore(core, T0 + 10 * MIN);
  assert.equal(core.remainingWhenPaused, 15 * 60);
  core = startCore(core, CLASSIC, T0 + 20 * MIN);
  assert.equal(core.endsAt, T0 + 35 * MIN);
  const { core: after, log } = advanceCore(core, CLASSIC, MANUAL, T0 + 35 * MIN);
  assert.equal(after.done, 1);
  assert.equal(log?.started_at, new Date(T0).toISOString());
});

// ──────────────────────── Переходы ────────────────────────

test("по умолчанию следующая фаза ждёт клика, а звонок зовёт", () => {
  const { core } = advanceCore(focusEndingAt(T0), CLASSIC, MANUAL, T0 + 400);
  assert.equal(core.running, false);
  assert.equal(core.phaseStartedAt, null);
  assert.deepEqual(core.alarm, { next: "break", at: T0, auto: false });
  assert.equal(core.idleSince, T0, "простой считается с конца фазы");
});

test("сам начинать перерыв: перерыв идёт от настоящего конца фокуса", () => {
  const { core } = advanceCore(focusEndingAt(T0), CLASSIC, { autoBreak: true, autoFocus: false }, T0 + 1500);
  assert.equal(core.phase, "break");
  assert.equal(core.running, true);
  assert.equal(core.phaseStartedAt, T0);
  assert.equal(core.endsAt, T0 + 5 * MIN);
  assert.deepEqual(core.alarm, { next: "break", at: T0, auto: true });
});

test("сам начинать фокус не трогает начало перерыва", () => {
  const { core } = advanceCore(focusEndingAt(T0), CLASSIC, { autoBreak: false, autoFocus: true }, T0);
  assert.equal(core.running, false);
  const breakEnd = startCore(core, CLASSIC, T0 + MIN);
  const after = advanceCore(breakEnd, CLASSIC, { autoBreak: false, autoFocus: true }, T0 + 6 * MIN).core;
  assert.equal(after.phase, "focus");
  assert.equal(after.running, true);
  assert.deepEqual(after.alarm, { next: "focus", at: T0 + 6 * MIN, auto: true });
});

test("фаза кончилась давно, пока вкладка была закрыта: без автостарта", () => {
  const late = T0 + RING_LIMIT_MS + 1000;
  const { core } = advanceCore(focusEndingAt(T0), CLASSIC, AUTO, late);
  assert.equal(core.phase, "break");
  assert.equal(core.running, false);
  assert.deepEqual(core.alarm, { next: "break", at: T0, auto: false });
});

test("автостартный звонок со временем исчезает сам", () => {
  const { core } = advanceCore(focusEndingAt(T0), CLASSIC, AUTO, T0);
  assert.ok(core.alarm);
  const still = advanceCore(core, CLASSIC, AUTO, T0 + RING_LIMIT_MS - 1000).core;
  assert.ok(still.alarm);
  const gone = advanceCore(still, CLASSIC, AUTO, T0 + RING_LIMIT_MS + 1000).core;
  assert.equal(gone.alarm, null);
  assert.equal(gone.running, true);
});

test("любое действие глушит звонок", () => {
  const ringing = advanceCore(focusEndingAt(T0), CLASSIC, MANUAL, T0).core;
  assert.ok(ringing.alarm);
  assert.equal(dismissCore(ringing).alarm, null);
  assert.equal(dismissCore(ringing).phase, "break", "«Тихо» не начинает перерыв");
  assert.equal(startCore(ringing, CLASSIC, T0 + 1000).alarm, null);
  assert.equal(finishCore(ringing, CLASSIC, MANUAL, T0 + 1000, false).core.alarm, null);
  const autoRinging = advanceCore(focusEndingAt(T0), CLASSIC, AUTO, T0).core;
  assert.equal(pauseCore(autoRinging, T0 + 1000).alarm, null);
});

test("тот же самый объект, когда менять нечего", () => {
  const idle = freshCore(CLASSIC);
  assert.equal(dismissCore(idle), idle);
  assert.equal(advanceCore(idle, CLASSIC, MANUAL, T0).core, idle);
  const running = startCore(idle, CLASSIC, T0);
  assert.equal(advanceCore(running, CLASSIC, MANUAL, T0 + 1000).core, running);
  assert.equal(startCore(running, CLASSIC, T0 + 2000), running);
});

// ──────────────────────── Сброс счёта ────────────────────────

test("простой дольше часа обнуляет счёт и возвращает к фокусу", () => {
  const waiting = advanceCore(focusEndingAt(T0, { done: 2 }), CLASSIC, MANUAL, T0).core;
  assert.equal(waiting.done, 3);
  assert.equal(settleIdle(waiting, CLASSIC, T0 + IDLE_RESET_MS), waiting, "ровно час ещё не простой");
  const settled = settleIdle(waiting, CLASSIC, T0 + IDLE_RESET_MS + 1000);
  assert.equal(settled.done, 0);
  assert.equal(settled.alarm, null);
  assert.equal(settled.phase, "focus");
  assert.equal(settled.remainingWhenPaused, 25 * 60);
});

test("простой проверяется и на тике, и при старте", () => {
  const waiting = advanceCore(focusEndingAt(T0, { done: 1 }), CLASSIC, MANUAL, T0).core;
  const later = T0 + IDLE_RESET_MS + MIN;
  assert.equal(advanceCore(waiting, CLASSIC, MANUAL, later).core.done, 0);
  const started = startCore(waiting, CLASSIC, later);
  assert.equal(started.done, 0);
  assert.equal(started.phase, "focus");
  assert.equal(started.endsAt, later + 25 * MIN);
});

test("на следующий день счёт начинается заново", () => {
  const evening = new Date(2026, 10, 10, 23, 50).getTime();
  const night = new Date(2026, 10, 11, 0, 10).getTime();
  assert.ok(isIdleStale(evening, night));
  assert.ok(!isIdleStale(evening, evening + 5 * MIN), "23:55 ещё тот же день");
  const paused = pauseCore(startCore({ ...freshCore(CLASSIC), done: 2 }, CLASSIC, evening - 5 * MIN), evening);
  const settled = settleIdle(paused, CLASSIC, night);
  assert.equal(settled.done, 0);
  // Начатый и поставленный на паузу фокус не пропадает: его ещё можно доделать.
  assert.equal(settled.phase, "focus");
  assert.equal(settled.remainingWhenPaused, 20 * 60);
  assert.equal(settled.phaseStartedAt, evening - 5 * MIN);
});

test("идущий таймер через полночь счёт не теряет", () => {
  const evening = new Date(2026, 10, 10, 23, 50).getTime();
  const running = startCore({ ...freshCore(CLASSIC), done: 2 }, CLASSIC, evening);
  const { core } = advanceCore(running, CLASSIC, MANUAL, evening + 25 * MIN);
  assert.equal(core.done, 3);
});

test("короткий простой счёт не трогает", () => {
  const waiting = advanceCore(focusEndingAt(T0, { done: 1 }), CLASSIC, MANUAL, T0).core;
  assert.equal(settleIdle(waiting, CLASSIC, T0 + 30 * MIN), waiting);
});

// ──────────────────────── Смена ритма ────────────────────────

const DEEP = rhythmOf(1, null);

test("смена ритма до старта сразу меняет длину фазы", () => {
  const after = replanCore(freshCore(CLASSIC), DEEP);
  assert.equal(after.remainingWhenPaused, 50 * 60);
  assert.equal(plannedOf(after), 50 * 60);
});

test("смена ритма у ждущей фазы тоже сразу", () => {
  const waiting = advanceCore(focusEndingAt(T0), CLASSIC, MANUAL, T0).core;
  const after = replanCore(waiting, DEEP);
  assert.equal(after.phase, "break");
  assert.equal(plannedOf(after), 10 * 60);
  assert.equal(after.remainingWhenPaused, 10 * 60);
});

test("идущая фаза доходит в своей длине, новый ритм со следующей", () => {
  const running = startCore(freshCore(DEEP), DEEP, T0);
  const after = replanCore(running, CLASSIC);
  assert.equal(after, running, "ничего не меняется посреди фазы");
  assert.equal(remainingOf(after, T0 + 10 * MIN), 40 * 60);
  const { core: next, log } = advanceCore(after, CLASSIC, MANUAL, T0 + 50 * MIN);
  assert.equal(log?.planned_seconds, 50 * 60);
  assert.equal(log?.seconds, 50 * 60);
  // Ритм в логе тот же, по которому шла фаза, иначе история спутала бы перерывы.
  assert.equal(log?.preset_focus_min, 50);
  assert.equal(log?.preset_break_min, 10);
  assert.equal(next.phase, "break");
  assert.equal(next.remainingWhenPaused, 5 * 60, "перерыв уже по новому ритму");
});

test("перерыв, начатый в одном ритме и законченный в другом, в истории не путается", () => {
  const marathon = rhythmOf(3, null);
  // Обычные 10 минут из 50/10/30, посреди переключили на 25/5/15: всё ещё обычный перерыв.
  const shortBreak: TimerCore = { ...freshCore(DEEP), phase: "break", remainingWhenPaused: 10 * 60 };
  const shortRun = replanCore(startCore(shortBreak, DEEP, T0), CLASSIC);
  const shortLog = advanceCore(shortRun, CLASSIC, MANUAL, T0 + 10 * MIN).log;
  assert.ok(shortLog);
  assert.equal(shortLog.planned_seconds, 10 * 60);
  assert.equal(isLongBreakRow(shortLog), false);
  // Длинные 15 минут из 25/5/15, посреди переключили на 90/20/30: всё ещё длинный.
  const longBreak: TimerCore = { ...freshCore(CLASSIC), phase: "long", done: 4, remainingWhenPaused: 15 * 60 };
  const longRun = replanCore(startCore(longBreak, CLASSIC, T0), marathon);
  const longLog = advanceCore(longRun, marathon, MANUAL, T0 + 15 * MIN).log;
  assert.ok(longLog);
  assert.equal(longLog.planned_seconds, 15 * 60);
  assert.equal(isLongBreakRow(longLog), true);
});

test("заглянуть в «Своё» посреди фокуса не обрывает его", () => {
  // Своё 25 минут, а идёт 30-я минута 50-минутного фокуса.
  const running = startCore(freshCore(DEEP), DEEP, T0);
  const after = replanCore(running, CLASSIC);
  const { core, log } = advanceCore(after, CLASSIC, MANUAL, T0 + 30 * MIN);
  assert.equal(log, null);
  assert.equal(core.running, true);
  assert.equal(remainingOf(core, T0 + 30 * MIN), 20 * 60);
  assert.equal(core.done, 0);
});

test("пауза посреди фазы тоже сохраняет её длину", () => {
  const paused = pauseCore(startCore(freshCore(DEEP), DEEP, T0), T0 + 30 * MIN);
  const after = replanCore(paused, CLASSIC);
  assert.equal(after.remainingWhenPaused, 20 * 60);
  assert.equal(plannedOf(after), 50 * 60);
});

test("смена ритма счёт не теряет, а пропущенный фокус длинный перерыв не получит", () => {
  // Два фокуса в 25/5/15 каждые 4, потом 90/20/30 каждые 2.
  const marathon = rhythmOf(3, null);
  const running = startCore({ ...freshCore(CLASSIC), done: 2 }, CLASSIC, T0);
  const switched = replanCore(running, marathon);
  assert.equal(switched.done, 2);
  assert.deepEqual(cycleDots(switched.phase, switched.done, marathon.every).dots, ["done", "now"]);
  const skipped = finishCore(switched, marathon, MANUAL, T0 + 2 * MIN, false).core;
  assert.equal(skipped.phase, "break");
  const natural = advanceCore({ ...switched, endsAt: T0 + 25 * MIN }, marathon, MANUAL, T0 + 25 * MIN).core;
  assert.equal(natural.phase, "long");
});

test("туда и обратно по ритмам прогресс цикла на месте", () => {
  const marathon = rhythmOf(3, null);
  const waiting = { ...freshCore(CLASSIC), done: 3 };
  const back = replanCore(replanCore(waiting, marathon), CLASSIC);
  assert.equal(back.done, 3);
  assert.equal(cycleDots(back.phase, back.done, CLASSIC.every).label, "Ещё 1 сессия до длинного перерыва");
});

test("на длинном перерыве счёт при смене ритма не трогается", () => {
  const long: TimerCore = { ...freshCore(CLASSIC), phase: "long", done: 4, remainingWhenPaused: 15 * 60 };
  assert.equal(replanCore(long, rhythmOf(3, null)).done, 4);
});

test("«Фокус на N мин» с главной: ждущий длинный перерыв пропускается целиком", () => {
  const waitingLong: TimerCore = { ...freshCore(CLASSIC), phase: "long", done: 4, remainingWhenPaused: 15 * 60, alarm: { next: "long", at: T0, auto: false } };
  const focus = focusCore(waitingLong, CLASSIC, T0 + 1000);
  assert.equal(focus.phase, "focus");
  assert.equal(focus.done, 0);
  assert.equal(focus.alarm, null);
  assert.equal(focus.remainingWhenPaused, 25 * 60);
  const waitingBreak: TimerCore = { ...waitingLong, phase: "break", done: 2, remainingWhenPaused: 5 * 60 };
  assert.equal(focusCore(waitingBreak, CLASSIC, T0 + 1000).done, 2);
  const running = startCore(freshCore(CLASSIC), CLASSIC, T0);
  assert.equal(focusCore(running, CLASSIC, T0 + 1000), running, "идущую фазу не трогает");
});

// ──────────────────────── Где я в цикле ────────────────────────

test("точки цикла: сделанные, текущая и оставшиеся", () => {
  assert.deepEqual(cycleDots("focus", 2, 4), {
    dots: ["done", "done", "now", "todo"],
    label: "Ещё 2 сессии до длинного перерыва",
  });
  assert.deepEqual(cycleDots("break", 3, 4), {
    dots: ["done", "done", "done", "todo"],
    label: "Ещё 1 сессия до длинного перерыва",
  });
  assert.deepEqual(cycleDots("long", 4, 4), {
    dots: ["done", "done", "done", "done"],
    label: "Длинный перерыв",
  });
  assert.deepEqual(cycleDots("focus", 0, 2).dots, ["now", "todo"]);
  assert.deepEqual(cycleDots("focus", 5, 5).dots, ["done", "done", "done", "done", "now"], "сделано больше нужного после смены ритма");
  assert.equal(cycleDots("break", 0, 5).label, "Ещё 5 сессий до длинного перерыва");
  // Счёт больше нужного (испорченное хранилище): «ещё 0» не показываем.
  assert.equal(cycleDots("break", 4, 4).label, "Ещё 1 сессия до длинного перерыва");
});

// ──────────────────────── Вкладка ────────────────────────

const base = "Помодоро | Timely";
const title = (overrides: Partial<Parameters<typeof tabTitle>[0]>) =>
  tabTitle({ phase: "focus", remaining: 24 * 60 + 13, running: true, started: true, alarm: null, base, blink: true, ...overrides });

test("заголовок вкладки: отсчёт и название фазы", () => {
  assert.equal(title({}), "24:13 · Фокус");
  assert.equal(title({ phase: "break", remaining: 4 * 60 + 59 }), "04:59 · Перерыв");
  assert.equal(title({ phase: "long", remaining: 14 * 60 + 59 }), "14:59 · Длинный перерыв");
  assert.equal(title({ remaining: 90 * 60 }), "90:00 · Фокус");
});

test("заголовок вкладки: пауза помечена", () => {
  assert.equal(title({ running: false }), "⏸ 24:13 · Фокус");
});

test("заголовок вкладки: без таймера обычный", () => {
  assert.equal(title({ running: false, started: false }), base);
});

test("заголовок вкладки: фаза кончилась, мигает зов", () => {
  const alarm = { next: "break" as const, at: T0, auto: false };
  assert.equal(title({ running: false, started: false, alarm, blink: true }), "Пора на перерыв!");
  assert.equal(title({ running: false, started: false, alarm, blink: false }), base);
  assert.equal(title({ running: false, started: false, alarm: { ...alarm, next: "long" } }), "Пора на длинный перерыв!");
  assert.equal(title({ running: false, started: false, alarm: { ...alarm, next: "focus" } }), "Пора работать!");
  // Следующая фаза уже пошла сама: показываем её отсчёт, а не мигание.
  assert.equal(title({ phase: "break", remaining: 299, alarm: { ...alarm, auto: true } }), "04:59 · Перерыв");
});

test("зов в заголовке и на кнопке один и тот же", () => {
  assert.equal(alarmTitle("break"), "Пора на перерыв!");
  assert.equal(alarmTitle("long"), "Пора на длинный перерыв!");
  assert.equal(alarmTitle("focus"), "Пора работать!");
});

// ──────────────────────── Уведомления ────────────────────────

test("тексты уведомлений", () => {
  const deep: Rhythm = { focus: 50, brk: 10, long: 30, every: 3 };
  assert.deepEqual(alarmNotice("break", deep, ""), { title: "Пора на перерыв: 10 минут", body: "" });
  assert.deepEqual(alarmNotice("long", deep, ""), { title: "Пора на длинный перерыв: 30 минут", body: "" });
  assert.deepEqual(alarmNotice("focus", deep, ""), { title: "Перерыв закончился, пора работать", body: "" });
  assert.equal(alarmNotice("break", deep, "  Алгебра, §12 ").body, "Алгебра, §12");
});

test("уведомления склоняют минуты", () => {
  const one: Rhythm = { focus: 25, brk: 1, long: 21, every: 4 };
  assert.equal(alarmNotice("break", one, "").title, "Пора на перерыв: 1 минута");
  assert.equal(alarmNotice("long", one, "").title, "Пора на длинный перерыв: 21 минута");
  assert.equal(alarmNotice("break", { ...one, brk: 3 }, "").title, "Пора на перерыв: 3 минуты");
});

// ──────────────────────── Звонок ────────────────────────

test("звонок повторяется до двух минут и задним числом не звучит", () => {
  const alarm = { next: "break" as const, at: T0, auto: false };
  assert.equal(ringBursts(alarm, T0), Math.ceil(RING_LIMIT_MS / BELL_EVERY_MS));
  assert.equal(ringBursts(alarm, T0 + RING_LIMIT_MS - BELL_EVERY_MS / 2), 1);
  assert.equal(ringBursts(alarm, T0 + RING_LIMIT_MS), 0);
  assert.equal(ringBursts(alarm, T0 + 30 * MIN), 0, "кончилась давно: тишина");
});

test("уведомление о конце фазы одно: вторая вкладка и перезагрузка его не повторяют", () => {
  const alarm = { next: "break" as const, at: T0, auto: false };
  assert.equal(shouldNotify(alarm, null, T0 + 500), true);
  assert.equal(shouldNotify(alarm, T0, T0 + 500), false, "уже показано");
  assert.equal(shouldNotify(alarm, T0 - 60 * MIN, T0 + 500), true, "показано было прошлое");
  assert.equal(shouldNotify(alarm, null, T0 + RING_LIMIT_MS), false, "кончилась давно");
  assert.equal(shouldNotify(null, null, T0), false);
});

test("при автостарте звонок звучит пару раз", () => {
  const alarm = { next: "focus" as const, at: T0, auto: true };
  assert.equal(ringBursts(alarm, T0), 2);
  assert.equal(ringBursts(alarm, T0 + 10_000), 2);
  assert.equal(ringBursts(alarm, T0 + RING_LIMIT_MS + 1), 0);
});

// ──────────────────────── Хранение ────────────────────────

test("старое сохранение (до длинных перерывов) переживает обновление", () => {
  // Шёл перерыв 90/20, в очереди неотправленная сессия, счёт тогда копился без сброса.
  const old = {
    presetIdx: 3,
    phase: "break",
    running: true,
    endsAt: T0 + 5 * MIN,
    remainingWhenPaused: 20 * 60,
    phaseStartedAt: T0 - 15 * MIN,
    cycles: 7,
    pending: [{ localId: "a1" }],
  };
  const current = { ...freshCore(DEEP), presetIdx: 1, custom: null, pending: [] as unknown[] };
  const merged = mergeSaved(migrateSaved(old, 0), current);
  assert.deepEqual(merged.phaseRhythm, rhythmOf(3, null), "фаза идёт по своему ритму, а не по ритму по умолчанию");
  assert.equal(plannedOf(merged), 20 * 60);
  assert.equal(merged.running, true);
  assert.equal(merged.endsAt, T0 + 5 * MIN);
  assert.equal(merged.done, 0);
  assert.equal(merged.alarm, null);
  assert.equal("cycles" in merged, false);
  assert.deepEqual(merged.pending, [{ localId: "a1" }]);
});

test("испорченный ритм фазы в хранилище чинится выбранным ритмом", () => {
  const current = { ...freshCore(CLASSIC), presetIdx: 0, custom: null };
  const mine: Rhythm = { focus: 40, brk: 8, long: 20, every: 3 };
  const merged = mergeSaved({ presetIdx: CUSTOM_PRESET, custom: mine, phaseRhythm: { focus: 0 } }, current);
  assert.deepEqual(merged.phaseRhythm, mine);
  assert.deepEqual(mergeSaved(undefined, current).phaseRhythm, CLASSIC, "без сохранения всё по умолчанию");
  const saved = { presetIdx: 0, custom: null, phaseRhythm: DEEP };
  assert.deepEqual(mergeSaved(saved, current).phaseRhythm, DEEP, "правильный снимок не трогаем");
});

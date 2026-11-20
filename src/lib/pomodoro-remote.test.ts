import assert from "node:assert/strict";
import { test } from "node:test";

import { remoteTimer, sameTimer, timerSnapshot, type TimerSnapshot } from "./pomodoro-remote";

const rhythm = { focus: 50, brk: 10, long: 30, every: 4 };

const running: TimerSnapshot = {
  presetIdx: 1,
  custom: null,
  phase: "focus",
  running: true,
  endsAt: 1795080000000,
  remainingWhenPaused: 3000,
  phaseRhythm: rhythm,
  phaseStartedAt: 1795077000000,
  done: 2,
  idleSince: null,
  alarm: null,
  runs: [[1795076000000, 1795076600000]],
  name: "Физика",
};

test("в общее состояние идёт только таймер и название, а не звук, очередь и тик", () => {
  const local = {
    ...running,
    sound: true,
    volume: 0.4,
    pending: [{ localId: "x" }],
    nowTs: 1795078000000,
    leader: true,
    notifiedAt: 5,
  };
  assert.deepEqual(timerSnapshot(local, "Физика"), running);
});

test("одинаковые таймеры равны, сдвиг конца — уже другой", () => {
  assert.ok(sameTimer(running, { ...running }));
  assert.ok(!sameTimer(running, { ...running, endsAt: running.endsAt! + 1000 }));
  assert.ok(!sameTimer(running, { ...running, name: "Алгебра" }));
});

test("с сервера берётся только целое состояние", () => {
  assert.deepEqual(remoteTimer(running), running);
  assert.deepEqual(remoteTimer({ ...running, name: "  Физика  " }), running);
  assert.equal(remoteTimer(null), null);
  assert.equal(remoteTimer({ ...running, phase: "nap" }), null);
  assert.equal(remoteTimer({ ...running, endsAt: null }), null); // идёт, но неизвестно до когда
  assert.equal(remoteTimer({ ...running, phaseRhythm: { focus: "50" } }), null);
  assert.equal(remoteTimer({ ...running, alarm: { next: "break" } }), null);
  assert.equal(remoteTimer({ ...running, done: -1 }), null);
});

test("пауза и звонок с сервера принимаются", () => {
  const paused = { ...running, running: false, endsAt: null, remainingWhenPaused: 1200, idleSince: 1795078500000 };
  assert.deepEqual(remoteTimer(paused), paused);
  const ringing = { ...paused, phase: "break" as const, alarm: { next: "break" as const, at: 1795080000000, auto: false } };
  assert.deepEqual(remoteTimer(ringing), ringing);
});

test("старая запись без названия читается с пустым названием", () => {
  const { name: _name, ...withoutName } = running;
  assert.deepEqual(remoteTimer(withoutName), { ...running, name: "" });
});

test("отрезки фазы идут на другие устройства, а таймер со старой версией без них не считается порченым", () => {
  const sent = timerSnapshot(running, running.name);
  assert.deepEqual(sent.runs, running.runs);
  const { runs: _runs, ...withoutRuns } = running;
  assert.deepEqual(remoteTimer(withoutRuns)?.runs, []);
  assert.equal(remoteTimer({ ...running, runs: [[5, 3]] }), null);
  assert.equal(remoteTimer({ ...running, runs: "вчера" }), null);
});

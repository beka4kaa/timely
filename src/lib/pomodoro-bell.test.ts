import assert from "node:assert/strict";
import test from "node:test";

import { BELL_BURST_SECONDS, bellSamples } from "./pomodoro-bell";
import { BELL_EVERY_MS } from "./pomodoro-cycle";

// Ушами звонок в тесте не услышать, поэтому проверяем то, что слышно и без ушей:
// он громкий, не клиппует, не щёлкает и укладывается в свой такт.

const RATE = 48_000;
const samples = bellSamples(RATE);

function peak(from: number, to: number): number {
  let max = 0;
  for (let index = from; index < to; index += 1) max = Math.max(max, Math.abs(samples[index]));
  return max;
}

function rms(from: number, to: number): number {
  let sum = 0;
  for (let index = from; index < to; index += 1) sum += samples[index] * samples[index];
  return Math.sqrt(sum / (to - from));
}

test("звонок длится свою долю такта и между звонками есть тишина", () => {
  assert.equal(samples.length, Math.round(BELL_BURST_SECONDS * RATE));
  assert.ok(BELL_BURST_SECONDS * 1000 < BELL_EVERY_MS * 0.6);
});

test("звонок громкий, но не выходит за предел", () => {
  const top = peak(0, samples.length);
  assert.ok(top <= 1, `пик ${top}`);
  assert.ok(top >= 0.85, `пик ${top}`);
  // Средняя громкость звучащей части: колокольчик, а не короткий щелчок.
  const body = rms(0, Math.round(1.2 * RATE));
  assert.ok(body >= 0.28, `rms ${body}`);
});

test("звонок начинается сразу и затихает к концу без щелчка", () => {
  assert.ok(peak(0, Math.round(0.03 * RATE)) > 0.3, "удар сразу, без паузы перед ним");
  assert.ok(Math.abs(samples[0]) < 0.05, "первый отсчёт без ступеньки");
  assert.ok(peak(samples.length - Math.round(0.02 * RATE), samples.length) < 0.02, "хвост затих");
  assert.ok(Math.abs(samples[samples.length - 1]) < 0.005);
});

test("звонок одинаковый на любой частоте дискретизации", () => {
  const low = bellSamples(44_100);
  assert.equal(low.length, Math.round(BELL_BURST_SECONDS * 44_100));
  let max = 0;
  for (let index = 0; index < low.length; index += 1) max = Math.max(max, Math.abs(low[index]));
  assert.ok(max <= 1 && max >= 0.85);
});

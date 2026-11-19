import assert from "node:assert/strict";
import test from "node:test";

import {
  BELL_BURST_SECONDS,
  BELL_SOUNDS,
  DEFAULT_BELL,
  bellPhrase,
  bellSamples,
  bellSoundOf,
  soundSamples,
  type BellTone,
} from "./pomodoro-bell";
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

// ── Выбор звука: спокойные звуки и прежний будильник ──

const TONES: BellTone[] = ["chime", "bowl", "marimba", "harp", "alarm"];

function stats(data: Float32Array, from = 0, to = data.length) {
  let max = 0;
  let sum = 0;
  for (let index = from; index < to; index += 1) {
    const value = data[index];
    if (Number.isNaN(value)) throw new Error("NaN в звуке");
    max = Math.max(max, Math.abs(value));
    sum += value * value;
  }
  return { peak: max, rms: Math.sqrt(sum / Math.max(1, to - from)) };
}

for (const tone of TONES) {
  test(`звук «${tone}» укладывается в такт, не клиппует и не щёлкает`, () => {
    const data = soundSamples(tone, RATE);
    assert.ok(data.length / RATE <= (BELL_EVERY_MS / 1000) * 0.6, `длина ${data.length / RATE} с`);
    const all = stats(data);
    assert.ok(all.peak <= 1 && all.peak >= 0.5, `пик ${all.peak}`);
    assert.ok(Math.abs(data[0]) < 0.05, "первый отсчёт без ступеньки");
    assert.ok(stats(data, 0, Math.round(0.12 * RATE)).peak > 0.1, "звук начинается сразу");
    assert.ok(stats(data, data.length - Math.round(0.02 * RATE)).peak < 0.02, "хвост затих");
    assert.ok(Math.abs(data[data.length - 1]) < 0.005);
  });
}

test("спокойные звуки тише и мягче будильника", () => {
  const alarm = stats(soundSamples("alarm", RATE)).rms;
  for (const tone of TONES.filter((item) => item !== "alarm")) {
    const calm = stats(soundSamples(tone, RATE)).rms;
    assert.ok(calm < alarm * 0.75, `${tone}: ${calm} против ${alarm}`);
  }
});

test("звук считается одинаково при каждом вызове: в арфе шум с постоянным зерном", () => {
  assert.deepEqual(soundSamples("harp", 44_100), soundSamples("harp", 44_100));
});

test("будильник — тот же звонок, что был раньше", () => {
  assert.deepEqual(soundSamples("alarm", RATE), bellSamples(RATE));
});

test("список звуков: по умолчанию колокольчик, незнакомое значение становится им", () => {
  const keys = BELL_SOUNDS.map((sound) => sound.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(DEFAULT_BELL, "chime");
  assert.ok(keys.includes("voice") && keys.includes("alarm"));
  assert.equal(bellSoundOf("bowl"), "bowl");
  assert.equal(bellSoundOf("гонг"), "chime");
  assert.equal(bellSoundOf(undefined), "chime");
});

test("голос говорит, что кончилось и что дальше", () => {
  assert.match(bellPhrase("break"), /^Блок закончился/);
  assert.match(bellPhrase("long"), /длинный перерыв/);
  assert.match(bellPhrase("focus"), /^Перерыв закончился/);
});

// Звонок помодоро: громкий и звонкий, как у механического будильника.
//
// Два колокольчика разной высоты, молоточек бьёт по ним по очереди, около 26 ударов
// в секунду. Звук считается здесь же, в коде: ни файлов, ни внешних адресов. Один удар
// звонка длится полторы секунды, дальше тишина до следующего такта.
//
// Браузер даёт играть звук только после клика, поэтому `unlockBell` вызывается в
// обработчике «Начать». После этого звонок звучит и на свёрнутой вкладке.

import { BELL_EVERY_MS } from "./pomodoro-cycle";

export const BELL_BURST_SECONDS = 1.6;

/** Молоточек бьёт каждый колокольчик 13 раз в секунду, второй со сдвигом в полтакта. */
const STRIKE_PERIOD = 1 / 13;
const STRIKE_ATTACK = 0.0015;
const STRIKE_DECAY = 0.04;
/** Последние доли секунды молоточек молчит, и колокольчики затихают сами. */
const RING_OUT = 0.28;
const FADE_OUT = 0.03;
const BELLS = [
  { freq: 1975.5, offset: 0 },
  { freq: 2349.3, offset: STRIKE_PERIOD / 2 },
];
/** Основной тон и негармонический обертон металлического колокольчика. */
const PARTIALS: Array<[ratio: number, amplitude: number]> = [
  [1, 1],
  [2.76, 0.4],
];
/** Мягкое насыщение делает звонок плотнее и громче на слух, не поднимая пик. */
const DRIVE = 1.6;
const PEAK = 0.92;

/** Один звонок, отсчёты от -1 до 1. Чистая функция: её проверяют тесты. */
export function bellSamples(sampleRate: number): Float32Array {
  const length = Math.round(BELL_BURST_SECONDS * sampleRate);
  const out = new Float32Array(length);
  const strikeTime = BELL_BURST_SECONDS - RING_OUT;

  let raw = 0;
  for (let index = 0; index < length; index += 1) {
    const time = index / sampleRate;
    let value = 0;
    for (const bell of BELLS) {
      const local = time - bell.offset;
      if (local < 0) continue;
      const strikes = Math.floor((strikeTime - bell.offset) / STRIKE_PERIOD) + 1;
      const strike = Math.min(Math.floor(local / STRIKE_PERIOD), strikes - 1);
      const since = local - strike * STRIKE_PERIOD;
      const envelope = Math.min(1, since / STRIKE_ATTACK) * Math.exp(-since / STRIKE_DECAY);
      for (const [ratio, amplitude] of PARTIALS) {
        value += amplitude * envelope * Math.sin(2 * Math.PI * bell.freq * ratio * time);
      }
    }
    out[index] = value;
    raw = Math.max(raw, Math.abs(value));
  }

  const norm = Math.tanh(DRIVE);
  const fadeFrom = length - Math.round(FADE_OUT * sampleRate);
  let peak = 0;
  for (let index = 0; index < length; index += 1) {
    let value = Math.tanh((DRIVE * out[index]) / (raw || 1)) / norm;
    if (index >= fadeFrom) value *= 0.5 + 0.5 * Math.cos((Math.PI * (index - fadeFrom)) / (length - fadeFrom));
    out[index] = value;
    peak = Math.max(peak, Math.abs(value));
  }
  const scale = peak ? PEAK / peak : 0;
  for (let index = 0; index < length; index += 1) out[index] *= scale;
  return out;
}

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;
let buffer: AudioBuffer | null = null;

function contextClass(): AudioContextClass | null {
  if (typeof window === "undefined") return null;
  const legacy = (window as unknown as { webkitAudioContext?: AudioContextClass }).webkitAudioContext;
  return window.AudioContext ?? legacy ?? null;
}

/** Ученик уже нажимал что-то на странице: только тогда браузер разрешит звук без клика. */
function hadGesture(): boolean {
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation ? activation.hasBeenActive : true;
}

/** Звук уже разблокирован: звонок сможет зазвучать без нового клика. */
export function bellUnlocked(): boolean {
  return context?.state === "running";
}

/**
 * Разблокирует звук. Звать прямо в обработчике клика: Safari разрешает звук только
 * изнутри жеста, поэтому там же проигрывается пустой отсчёт.
 */
export function unlockBell(): void {
  const Context = contextClass();
  if (!Context) return;
  try {
    context ??= new Context();
    if (context.state !== "running") void context.resume().catch(() => undefined);
    const silent = context.createBufferSource();
    silent.buffer = context.createBuffer(1, 1, context.sampleRate);
    silent.connect(context.destination);
    silent.start(0);
  } catch {
    // Без звука таймер всё равно работает: остаются заголовок и уведомление.
  }
}

/**
 * Ставит `bursts` звонков с шагом в такт и возвращает функцию, которая их глушит.
 * Все удары сразу ложатся на часы звука, поэтому звонок не опаздывает, даже если
 * свёрнутая вкладка получает тики редко.
 */
export function ringBell(volume: number, bursts: number): () => void {
  const silence = () => undefined;
  if (bursts <= 0 || volume <= 0) return silence;
  const Context = contextClass();
  if (!Context) return silence;
  try {
    if (!context) {
      if (!hadGesture()) return silence;
      context = new Context();
    }
    const ctx = context;
    if (ctx.state !== "running") void ctx.resume().catch(() => undefined);
    if (!buffer || buffer.sampleRate !== ctx.sampleRate) {
      const samples = bellSamples(ctx.sampleRate);
      const fresh = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      fresh.getChannelData(0).set(samples);
      buffer = fresh;
    }

    const gain = ctx.createGain();
    // Громкость на слух растёт не линейно: квадрат даёт ползунку ровный ход.
    gain.gain.value = Math.min(1, volume) ** 2;
    gain.connect(ctx.destination);

    const start = ctx.currentTime + 0.03;
    const sources: AudioBufferSourceNode[] = [];
    for (let index = 0; index < bursts; index += 1) {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(gain);
      source.start(start + (index * BELL_EVERY_MS) / 1000);
      sources.push(source);
    }

    return () => {
      for (const source of sources) {
        try {
          source.stop();
        } catch {
          // Уже доиграл.
        }
      }
      gain.disconnect();
    };
  } catch {
    return silence;
  }
}

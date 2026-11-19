// Звонок помодоро: на выбор спокойные звуки или прежний механический будильник.
//
// Все звуки считаются здесь же, в коде: ни файлов, ни внешних адресов, ни лицензий.
// Рецепты — из навыка ui-sound-design (колокольчик через негармонические обертоны,
// одна общая AudioContext, громкость никогда не уводится в ноль). Каждый звук укладывается
// в такт звонка (`BELL_EVERY_MS`) и повторяется, пока не нажмёшь куда угодно на странице.
//
// Браузер даёт играть звук только после клика, поэтому `unlockBell` вызывается в
// обработчике «Начать». После этого звонок звучит и на свёрнутой вкладке.

import { getLocale, msg, t } from "./i18n";
import type { TimerPhase } from "./pomodoro";
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

// ─────────────────────────── Выбор звука ───────────────────────────

/** Звуки, которые считаются в отсчёты. Голос — это колокольчик плюс фраза. */
export type BellTone = "chime" | "bowl" | "marimba" | "harp" | "alarm";
export type BellSound = BellTone | "voice";

export const BELL_SOUNDS: { key: BellSound; name: string; note: string }[] = [
  { key: "chime", name: msg("Колокольчик"), note: msg("Мягкий двойной звон") },
  { key: "bowl", name: msg("Поющая чаша"), note: msg("Низкий тёплый звук") },
  { key: "marimba", name: msg("Маримба"), note: msg("Три деревянные ноты вверх") },
  { key: "harp", name: msg("Арфа"), note: msg("Перебор струн") },
  { key: "voice", name: msg("Голос"), note: msg("Скажет, что блок закончился") },
  { key: "alarm", name: msg("Будильник"), note: msg("Громкий звонок, как раньше") },
];

export const DEFAULT_BELL: BellSound = "chime";

export function bellSoundOf(raw: unknown): BellSound {
  return BELL_SOUNDS.find((sound) => sound.key === raw)?.key ?? DEFAULT_BELL;
}

/** Что скажет голос, когда фаза кончилась. `next` — что начинается теперь. */
export function bellPhrase(next: TimerPhase): string {
  if (next === "focus") return t("Перерыв закончился. Пора продолжать.");
  return next === "long"
    ? t("Блок закончился. Время на длинный перерыв.")
    : t("Блок закончился. Время отдохнуть.");
}

/** Обертон: во сколько раз выше основного тона, громкость и время затухания в секундах. */
type Partial = [ratio: number, amplitude: number, decay: number];

/** Добавляет в `out` один удар: сумма обертонов с быстрой атакой и затуханием. */
function strike(out: Float32Array, rate: number, at: number, freq: number, partials: Partial[], attack: number) {
  const from = Math.round(at * rate);
  for (let index = from; index < out.length; index += 1) {
    const time = (index - from) / rate;
    const rise = Math.min(1, time / attack);
    let value = 0;
    for (const [ratio, amplitude, decay] of partials) {
      value += amplitude * Math.exp(-time / decay) * Math.sin(2 * Math.PI * freq * ratio * time);
    }
    out[index] += rise * value;
  }
}

/** Пик до `peak`, мягкое начало и затухание в ноль: без щелчков на стыках. */
function finish(out: Float32Array, rate: number, peak: number, fadeOut: number): Float32Array {
  let max = 0;
  for (let index = 0; index < out.length; index += 1) max = Math.max(max, Math.abs(out[index]));
  const scale = max ? peak / max : 0;
  const fadeIn = Math.max(1, Math.round(0.003 * rate));
  const fadeFrom = out.length - Math.round(fadeOut * rate);
  for (let index = 0; index < out.length; index += 1) {
    let value = out[index] * scale;
    if (index < fadeIn) value *= index / fadeIn;
    if (index >= fadeFrom) value *= 0.5 + 0.5 * Math.cos((Math.PI * (index - fadeFrom)) / (out.length - fadeFrom));
    out[index] = value;
  }
  return out;
}

/** Колокольчик: два удара на квинту вверх, обертоны маленького колокола. */
function chimeSamples(rate: number): Float32Array {
  const out = new Float32Array(Math.round(2.2 * rate));
  const bell: Partial[] = [
    [1, 1, 0.9],
    [2, 0.45, 0.55],
    [3, 0.22, 0.35],
    [4.16, 0.14, 0.22],
    [5.43, 0.08, 0.15],
  ];
  strike(out, rate, 0, 783.99, bell, 0.004);
  strike(out, rate, 0.32, 1174.66, bell, 0.004);
  return finish(out, rate, 0.78, 0.3);
}

/** Поющая чаша: низкий тон, каждый обертон из двух близких частот — отсюда мягкие волны. */
function bowlSamples(rate: number): Float32Array {
  const out = new Float32Array(Math.round(2.3 * rate));
  const modes: Partial[] = [
    [1, 1, 1.6],
    [2.71, 0.5, 0.9],
    [5.15, 0.2, 0.5],
  ];
  const base = 293.66;
  for (const [ratio, amplitude, decay] of modes) {
    // Две частоты на 1,5 Гц врозь: громкость обертона медленно дышит.
    strike(out, rate, 0, base, [[ratio, amplitude / 2, decay]], 0.025);
    strike(out, rate, 0, base + 1.5 / ratio, [[ratio, amplitude / 2, decay]], 0.025);
  }
  return finish(out, rate, 0.72, 0.35);
}

/** Маримба: до, ми, соль снизу вверх; у деревянного бруска второй тон почти в четыре раза выше. */
function marimbaSamples(rate: number): Float32Array {
  const out = new Float32Array(Math.round(1.8 * rate));
  const bar: Partial[] = [
    [1, 1, 0.45],
    [3.93, 0.22, 0.1],
    [9.2, 0.05, 0.035],
  ];
  [523.25, 659.25, 783.99].forEach((freq, index) => strike(out, rate, index * 0.14, freq, bar, 0.002));
  return finish(out, rate, 0.75, 0.25);
}

/** Шум с постоянным зерном: звук одинаковый при каждом вызове, а тесты стабильны. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Арфа: перебор ля мажора, каждая струна — щипок по Карплусу — Стронгу. */
function harpSamples(rate: number): Float32Array {
  const out = new Float32Array(Math.round(2.2 * rate));
  [440, 554.37, 659.25, 880].forEach((freq, note) => {
    const period = Math.max(2, Math.round(rate / freq));
    const random = seeded(note + 7);
    // Сглаженный шум вместо резкого: щипок мягче, без скрежета.
    const line = new Float32Array(period);
    let previous = 0;
    for (let index = 0; index < period; index += 1) {
      const noise = random() * 2 - 1;
      previous = 0.5 * (previous + noise);
      line[index] = previous;
    }
    const from = Math.round(note * 0.11 * rate);
    let cursor = 0;
    for (let index = from; index < out.length; index += 1) {
      const next = (cursor + 1) % period;
      const value = line[cursor];
      line[cursor] = 0.996 * 0.5 * (line[cursor] + line[next]);
      out[index] += value * (1 - note * 0.12);
      cursor = next;
    }
  });
  return finish(out, rate, 0.7, 0.3);
}

/** Отсчёты звука от -1 до 1. Чистая функция: её проверяют тесты. */
export function soundSamples(tone: BellTone, rate: number): Float32Array {
  switch (tone) {
    case "bowl":
      return bowlSamples(rate);
    case "marimba":
      return marimbaSamples(rate);
    case "harp":
      return harpSamples(rate);
    case "alarm":
      return bellSamples(rate);
    default:
      return chimeSamples(rate);
  }
}

type AudioContextClass = typeof AudioContext;

let context: AudioContext | null = null;
/** Посчитанные звуки: каждый считается один раз на частоту дискретизации. */
const buffers = new Map<BellTone, AudioBuffer>();

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

/** Фраза голосом браузера. Где синтеза речи нет, остаётся только колокольчик. */
function speak(text: string, volume: number): () => void {
  const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
  if (!synth || typeof SpeechSynthesisUtterance === "undefined") return () => undefined;
  try {
    const utterance = new SpeechSynthesisUtterance(text);
    const speechLang = getLocale() === "en" ? "en" : "ru";
    utterance.lang = speechLang === "en" ? "en-US" : "ru-RU";
    const voice = synth.getVoices().find((item) => item.lang.toLowerCase().startsWith(speechLang));
    if (voice) utterance.voice = voice;
    utterance.volume = Math.min(1, volume);
    utterance.rate = 0.95;
    synth.cancel();
    synth.speak(utterance);
    return () => synth.cancel();
  } catch {
    return () => undefined;
  }
}

/**
 * Ставит `bursts` звонков с шагом в такт и возвращает функцию, которая их глушит.
 * Все удары сразу ложатся на часы звука, поэтому звонок не опаздывает, даже если
 * свёрнутая вкладка получает тики редко. Голос говорит фразу один раз, дальше звенит
 * тихий колокольчик.
 */
export function ringBell(
  volume: number,
  bursts: number,
  sound: BellSound = DEFAULT_BELL,
  next: TimerPhase = "break",
): () => void {
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
    const tone: BellTone = sound === "voice" ? "chime" : sound;
    let buffer = buffers.get(tone);
    if (!buffer || buffer.sampleRate !== ctx.sampleRate) {
      const samples = soundSamples(tone, ctx.sampleRate);
      buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
      buffer.getChannelData(0).set(samples);
      buffers.set(tone, buffer);
    }

    const gain = ctx.createGain();
    // Громкость на слух растёт не линейно: квадрат даёт ползунку ровный ход. Под голос
    // колокольчик тише, чтобы не перекрывать слова.
    gain.gain.value = Math.min(1, volume) ** 2 * (sound === "voice" ? 0.5 : 1);
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

    // Фраза после первого удара колокольчика, чтобы слова не тонули в звоне.
    let hush: () => void = silence;
    const timer = sound === "voice" ? window.setTimeout(() => (hush = speak(bellPhrase(next), volume)), 700) : null;

    return () => {
      if (timer !== null) window.clearTimeout(timer);
      hush();
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

const HUSH_EVENTS = ["click", "keydown"] as const;

/**
 * Звонок глушит любое нажатие или клавиша на странице: отдельной кнопки «Тихо» нет.
 *
 * Слушаем в фазе перехвата, а `onHush` зовём уже после события. Так кнопка под курсором
 * («Начать» перерыв) успевает сработать, а обработчик, остановивший всплытие, не мешает.
 * Несколько событий подряд глушат один раз. Возвращает отписку; она же отменяет ещё не
 * случившееся `onHush`.
 */
export function listenForHush(target: EventTarget, onHush: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const hush = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      onHush();
    }, 0);
  };
  // Объект, а не `true`: так отписка снимает слушатель везде, в том числе в Node, где идут тесты.
  const capture = { capture: true };
  for (const type of HUSH_EVENTS) target.addEventListener(type, hush, capture);
  return () => {
    for (const type of HUSH_EVENTS) target.removeEventListener(type, hush, capture);
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
}

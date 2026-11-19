"use client";

// Озвучка ответов голосом браузера. Читает один ответ за раз: новый останавливает прежний.
//
// Длинный текст режется на фразы: Chrome обрывает одну длинную реплику секунд через
// пятнадцать. Где синтеза речи нет, кнопки «Озвучить» нет.

import { useSyncExternalStore } from "react";

let speaking: string | null = null;
const listeners = new Set<() => void>();

function notify(next: string | null) {
  speaking = next;
  listeners.forEach((listener) => listener());
}

export function speechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Фразы не длиннее ~220 знаков: по концу предложения, иначе по запятой или пробелу. */
function phrases(text: string): string[] {
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?…])\s+|\n+/)) {
    let rest = sentence.trim();
    while (rest.length > 220) {
      const cut = Math.max(rest.lastIndexOf(", ", 220), rest.lastIndexOf(" ", 220));
      const at = cut > 60 ? cut + 1 : 220;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

export function stopSpeaking(): void {
  if (!speechSupported()) return;
  window.speechSynthesis.cancel();
  if (speaking !== null) notify(null);
}

/** Читает `text` вслух. `id` — чей это ответ: по нему кнопка понимает, что читают её. */
export function speak(id: string, text: string): void {
  if (!speechSupported()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const parts = phrases(text);
  if (!parts.length) return notify(null);
  const voice = synth.getVoices().find((item) => item.lang.toLowerCase().startsWith("ru"));
  parts.forEach((part, index) => {
    const utterance = new SpeechSynthesisUtterance(part);
    utterance.lang = "ru-RU";
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    if (index === parts.length - 1) {
      utterance.onend = () => {
        if (speaking === id) notify(null);
      };
    }
    utterance.onerror = () => {
      if (speaking === id) notify(null);
    };
    synth.speak(utterance);
  });
  notify(id);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Читает ли сейчас ответ с этим `id`. */
export function useSpeaking(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => speaking === id,
    () => false,
  );
}

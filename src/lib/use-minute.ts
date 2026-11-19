"use client";

// Текущее время с точностью до минуты, одно на всю страницу: подписи «5 минут назад»
// обновляются сами, а таймер один, сколько бы сообщений ни было на экране.

import { useSyncExternalStore } from "react";

let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((item) => item());
    }, 60_000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** `0` на сервере и до первой отрисовки: подпись времени появляется только в браузере. */
export function useMinute(): number {
  return useSyncExternalStore(
    subscribe,
    () => now || (now = Date.now()),
    () => 0,
  );
}

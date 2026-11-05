"use client";

// Какое предложение помощника сейчас на экране.
//
// Мини-окно живёт в layout, а сетка на странице: общего родителя у них, кроме всего
// дашборда, нет. Окно кладёт сюда изменения, которые ждут ответа, а сетка рисует их
// предпросмотром. Больше ничего здесь не хранится: само предложение остаётся в окне.

import { useSyncExternalStore } from "react";

import type { ScheduleDiff } from "@/lib/studyplan-api";

let current: ScheduleDiff | null = null;
const listeners = new Set<() => void>();

export function setPlanPreview(diff: ScheduleDiff | null) {
  if (current === diff) return;
  current = diff;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePlanPreview(): ScheduleDiff | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
}

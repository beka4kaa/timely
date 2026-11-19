"use client"

// Память демо в браузере: язык тура, шаг тура при смене языка и день, на который данные гостя уже собраны.
// Отдельно от тура, чтобы страница входа не тянула его код.

import type { DemoLang } from "@/lib/demo-mode"
import { getLocale } from "@/lib/i18n"

/** Тур, прерванный сменой языка: с какого шага продолжить после перезагрузки. */
export const DEMO_TOUR_RESUME_KEY = "timely.demo.tour-at"
/** День, на который данные гостя уже собраны в этой вкладке. */
export const DEMO_FRESH_KEY = "timely.demo.fresh"

export function readStore(store: "local" | "session", key: string): string | null {
  try {
    return (store === "local" ? window.localStorage : window.sessionStorage).getItem(key)
  } catch {
    return null
  }
}

export function writeStore(store: "local" | "session", key: string, value: string) {
  try {
    ;(store === "local" ? window.localStorage : window.sessionStorage).setItem(key, value)
  } catch {
    // Приватный режим: без памяти, просто спросим ещё раз.
  }
}

export function todayKey(): string {
  return new Date().toDateString()
}

/**
 * Язык тура — язык всего кабинета. При первом заходе его берёт из браузера
 * src/lib/demo-mock/install.ts, дальше он живёт в куке.
 */
export function savedDemoLang(): DemoLang {
  return getLocale()
}

export function markDemoFresh() {
  writeStore("session", DEMO_FRESH_KEY, todayKey())
}

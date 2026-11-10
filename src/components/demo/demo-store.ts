"use client"

// Память демо в браузере: язык тура и день, на который данные гостя уже собраны.
// Отдельно от тура, чтобы страница входа не тянула его код.

import { pickDemoLang, type DemoLang } from "@/lib/demo-mode"

export const DEMO_LANG_KEY = "timely.demo.lang"
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

export function savedDemoLang(): DemoLang {
  const saved = readStore("local", DEMO_LANG_KEY)
  if (saved === "ru" || saved === "en") return saved
  return pickDemoLang(typeof navigator === "undefined" ? undefined : navigator.languages)
}

export function markDemoFresh() {
  writeStore("session", DEMO_FRESH_KEY, todayKey())
}

"use client"

import { BACKEND_URL } from "@/lib/api-utils"
import { authFetch } from "@/lib/auth-fetch"

export type DemoStartResult = { ok: boolean; seeded: boolean }

export class DemoStartError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "DemoStartError"
  }
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Almaty"
  } catch {
    return "Asia/Almaty"
  }
}

/**
 * Собирает гостю его копию аккаунта или освежает её на новый день.
 *
 * Бэкенд идемпотентен: повторный вызов в тот же день ничего не меняет и отвечает
 * `seeded: false`. Зона браузера нужна, чтобы блок учёбы шёл «сейчас» по часам
 * самого гостя, а не по Алматы.
 */
export async function startDemo(): Promise<DemoStartResult> {
  const response = await authFetch(`${BACKEND_URL}/api/demo/start/`, {
    method: "POST",
    body: JSON.stringify({ tz: browserTimeZone() }),
  })
  if (!response.ok) {
    let message = ""
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === "string") message = body.error
    } catch {
      // Не JSON: хватит кода ответа.
    }
    throw new DemoStartError(response.status, message || `HTTP ${response.status}`)
  }
  return (await response.json()) as DemoStartResult
}

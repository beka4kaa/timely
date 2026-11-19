// Текст разговора, которым делятся кнопкой сверху. Публичной ссылки на чат нет: переписка
// ученика уходит только туда, куда он сам её отправит.

import { chatTitle } from "./chat-title";

export interface ShareTurn {
  role: string;
  content: string;
  error?: string;
}

export function chatShareText(title: string | null | undefined, turns: ShareTurn[]): string {
  const lines = turns
    .filter((turn) => !turn.error && turn.content.trim())
    .map((turn) => `${turn.role === "user" ? "Я" : "Timely"}: ${turn.content.trim()}`);
  return [chatTitle(title), ...lines].join("\n\n");
}

/** Есть ли чем делиться: хотя бы одна реплика без ошибки. */
export function canShareChat(turns: ShareTurn[]): boolean {
  return turns.some((turn) => !turn.error && turn.content.trim());
}

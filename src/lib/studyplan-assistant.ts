// Транспорт помощника по расписанию.
//
// Отделено от `studyplan-chat.ts`, потому что тот обязан оставаться чистым:
// тестируемый модуль в этом репозитории не может импортировать `@/`-значения.

"use client";

import { BACKEND_URL } from "@/lib/api-utils";
import { authFetch } from "@/lib/auth-fetch";
import { readSse } from "@/lib/sse";
import {
  applyAssistantEvent,
  initialAssistantState,
  type AssistantState,
} from "@/lib/studyplan-chat";

export interface AssistantTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * Отправить просьбу и проиграть поток.
 *
 * `onUpdate` вызывается на каждом событии — панель показывает стадии, пока
 * помощник работает. Молчание в боковой панели на двадцать секунд выглядит как
 * поломка, а не как работа.
 */
export async function askAssistant(
  input: {
    message: string;
    scheduleId: string;
    history: AssistantTurn[];
    signal?: AbortSignal;
  },
  onUpdate: (state: AssistantState) => void,
): Promise<AssistantState> {
  let state: AssistantState = { ...initialAssistantState, status: "thinking" };
  onUpdate(state);

  const response = await authFetch(`${BACKEND_URL}/api/studyplan/chat/stream/`, {
    method: "POST",
    body: JSON.stringify({
      message: input.message,
      schedule_id: input.scheduleId,
      history: input.history,
    }),
    signal: input.signal,
  });

  if (!response.ok) {
    // Отказ до открытия потока приходит обычным телом с кодом — например,
    // когда помощник не настроен вовсе.
    let message = `Помощник недоступен (${response.status})`;
    try {
      const body = await response.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      /* тело не JSON — остаётся общий текст */
    }
    state = { ...state, status: "error", error: message };
    onUpdate(state);
    return state;
  }

  for await (const event of readSse(response)) {
    state = applyAssistantEvent(state, event);
    onUpdate(state);
  }

  // Поток оборвался, не сказав `done`: сеть, редеплой, закрытая вкладка.
  // Панель не должна остаться в «думаю» навсегда.
  if (state.status === "thinking") {
    state = {
      ...state,
      status: state.answer || state.revision ? "done" : "error",
      error: state.answer || state.revision ? null : "Соединение прервалось.",
    };
    onUpdate(state);
  }
  return state;
}

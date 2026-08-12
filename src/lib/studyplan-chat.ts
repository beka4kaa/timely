// Помощник по расписанию: чистый разбор потока событий.
//
// Здесь живут правила, которые легко нарушить незаметно: предложение обязано
// доехать до экрана даже если модель промолчала, а ошибка посреди потока не
// должна оставить панель висеть в «думаю».
//
// Ни одного значимого импорта: в этом репозитории тестируемый модуль не может
// тянуть `@/`-зависимости — ts-node в `node --test` их не разрешает, и тест
// молча не запускается. Типовые импорты стираются компилятором и потому можно.

import type { ScheduleRevision } from "@/lib/studyplan-api";

/** Событие потока. Своё объявление, а не импорт из `sse.ts`: тот модуль
 *  тянет за собой работу с сетью, а этот обязан оставаться чистым. */
export interface AssistantSseEvent {
  event: string;
  data: Record<string, unknown>;
}

export interface ParsedCommitment {
  title: string;
  kind: string;
  weekday?: number;
  weekday_name?: string;
  start_time?: string;
  duration_minutes?: number;
  valid_from?: string | null;
  valid_until?: string | null;
  start_at?: string;
  end_at?: string;
}

export type AssistantStatus = "idle" | "thinking" | "done" | "error";

export interface AssistantState {
  status: AssistantStatus;
  /** Инструменты, которые помощник успел вызвать, по порядку. */
  stages: string[];
  answer: string;
  revision: ScheduleRevision | null;
  commitments: ParsedCommitment[] | null;
  error: string | null;
  /**
   * Машинный код отказа, если бэкенд его назвал.
   *
   * `assistant_not_configured` — модель не задана в окружении бэкенда. Это не
   * поломка и не вина ученика, поэтому панель рисует такой случай спокойно, а
   * не красной строкой.
   */
  errorCode: string | null;
}

export const initialAssistantState: AssistantState = {
  status: "idle",
  stages: [],
  answer: "",
  revision: null,
  commitments: null,
  error: null,
  errorCode: null,
};

/** Человеческие названия инструментов: «get_schedule» ученику ничего не говорит. */
const STAGE_LABELS: Record<string, string> = {
  get_schedule: "Смотрю расписание",
  list_courses: "Смотрю программы",
  add_course_to_schedule: "Ставлю программу в календарь",
  find_free_slots: "Ищу свободные окна",
  explain_schedule: "Разбираю день",
  propose_move_blocks: "Готовлю перенос",
  propose_load_reduction: "Разгружаю день",
  propose_recovery_plan: "Собираю план догона",
  propose_fixed_commitments: "Записываю занятость",
};

export function stageLabel(tool: string): string {
  return STAGE_LABELS[tool] ?? "Работаю";
}

/** Завершить запрос, упавший до финального SSE-события. */
export function failAssistantRequest(
  state: AssistantState,
  error: unknown,
): AssistantState {
  const aborted =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError";

  return {
    ...state,
    status: "error",
    error: aborted
      ? "Запрос отменён. Можно попробовать ещё раз."
      : "Связаться с помощником не получилось. Попробуй ещё раз.",
    errorCode: null,
  };
}

/**
 * Применить одно событие потока.
 *
 * Чистая функция: то же состояние на том же входе. Ошибка переводит панель в
 * `error` и НЕ стирает уже полученное предложение — ревизия к этому моменту
 * уже создана на сервере, и прятать её значило бы потерять готовое изменение
 * из-за сбоя на последнем шаге.
 */
export function applyAssistantEvent(
  state: AssistantState,
  event: AssistantSseEvent,
): AssistantState {
  switch (event.event) {
    case "stage": {
      const tool = typeof event.data.tool === "string" ? event.data.tool : "";
      if (!tool) return state;
      return { ...state, status: "thinking", stages: [...state.stages, tool] };
    }
    case "revision":
      return {
        ...state,
        status: "thinking",
        revision: event.data as unknown as ScheduleRevision,
      };
    case "commitments": {
      const items = Array.isArray(event.data.items)
        ? (event.data.items as ParsedCommitment[])
        : null;
      return { ...state, status: "thinking", commitments: items };
    }
    case "content": {
      const text = typeof event.data.text === "string" ? event.data.text : "";
      return { ...state, status: "thinking", answer: text };
    }
    case "done":
      return { ...state, status: "done" };
    case "error":
      return {
        ...state,
        status: "error",
        error:
          typeof event.data.error === "string"
            ? event.data.error
            : "Помощник не смог ответить.",
        errorCode:
          typeof event.data.code === "string" ? event.data.code : state.errorCode,
      };
    default:
      return state;
  }
}

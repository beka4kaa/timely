// Помощник по расписанию: чистый разбор потока событий.
//
// Здесь живут правила, которые легко нарушить незаметно: предложение обязано
// доехать до экрана даже если модель промолчала, а ошибка посреди потока не
// должна оставить панель висеть в «думаю».
//
// Ни одного значимого импорта: в этом репозитории тестируемый модуль не может
// тянуть `@/`-зависимости — ts-node в `node --test` их не разрешает, и тест
// молча не запускается. Типовые импорты стираются компилятором и потому можно.

import type { AssistantProposal } from "@/components/chat/assistant-proposal";
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

/**
 * Окно недельного ритма, предложенное помощником.
 *
 * Занятия могут стоять ТОЛЬКО внутри таких окон, поэтому просьба «занимайся со
 * мной с 9:00 до 12:00» решается здесь, а не переносом занятий: за пределы
 * ритма они всё равно не выйдут.
 */
export interface ParsedStudyWindow {
  weekday: number;
  weekday_name: string;
  start_time: string;
  duration_minutes: number;
}

export interface ProposedStudyWindows {
  windows: ParsedStudyWindow[];
  /** `true` — прежний ритм заменяется целиком, `false` — окна добавляются. */
  replace: boolean;
  current: ParsedStudyWindow[];
}

export type AssistantStatus = "idle" | "thinking" | "done" | "error";

export interface AssistantState {
  status: AssistantStatus;
  /** Инструменты, которые помощник успел вызвать, по порядку. */
  stages: string[];
  answer: string;
  revision: ScheduleRevision | null;
  commitments: ParsedCommitment[] | null;
  studyWindows: ProposedStudyWindows | null;
  /** Что он предлагает в делах вне расписания: привычки, цели, темы, задания. */
  proposals: AssistantProposal[];
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
  studyWindows: null,
  proposals: [],
  error: null,
  errorCode: null,
};

/** Человеческие названия инструментов: «get_schedule» ученику ничего не говорит. */
const STAGE_LABELS: Record<string, string> = {
  get_schedule: "Смотрю расписание",
  list_courses: "Смотрю программы",
  find_free_slots: "Ищу свободные окна",
  explain_schedule: "Разбираю день",
  propose_move_blocks: "Готовлю перенос",
  propose_load_reduction: "Разгружаю день",
  propose_recovery_plan: "Собираю план догона",
  propose_fixed_commitments: "Записываю занятость",
  propose_study_windows: "Подбираю время занятий",
  propose_study_plan: "Готовлю предмет и занятия",
  propose_block_changes: "Готовлю изменение занятий",
  propose_commitment_removal: "Готовлю изменение занятости",
  propose_goal_change: "Готовлю изменение цели",
  propose_habit_change: "Готовлю изменение привычки",
  propose_topic_change: "Готовлю изменение темы",
  propose_subject_change: "Готовлю изменение предмета",
  open_my_affairs: "Смотрю твои дела",
  get_diary: "Смотрю дневник",
  list_habits: "Смотрю привычки",
  list_goals: "Смотрю цели",
  list_review_topics: "Смотрю темы",
  get_focus_stats: "Смотрю помодоро",
  propose_new_habit: "Готовлю предложение",
  propose_habit_schedule: "Готовлю предложение",
  propose_mark_habit: "Готовлю предложение",
  propose_new_goal: "Готовлю предложение",
  propose_goal_progress: "Готовлю предложение",
  propose_new_topics: "Готовлю предложение",
  propose_mark_homework: "Готовлю предложение",
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
    case "study_windows": {
      const windows = Array.isArray(event.data.windows)
        ? (event.data.windows as ParsedStudyWindow[])
        : null;
      if (!windows || windows.length === 0) return state;
      return {
        ...state,
        status: "thinking",
        studyWindows: {
          windows,
          replace: event.data.replace === true,
          current: Array.isArray(event.data.current)
            ? (event.data.current as ParsedStudyWindow[])
            : [],
        },
      };
    }
    case "proposal":
      return {
        ...state,
        status: "thinking",
        proposals: [...state.proposals, event.data as unknown as AssistantProposal],
      };
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

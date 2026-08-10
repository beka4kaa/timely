// Состояние мастера «Курс по книге» — ОДИН сеанс добавления, живущий в памяти.
//
// Раньше шаг и идентификаторы сохранялись в localStorage, чтобы «вернуть
// человека туда, где он был». На практике это означало, что заход на
// /curriculum молча уводил на страницу давно построенной программы: сеанс с
// прошлой недели восстанавливался и сам себя доигрывал до редиректа. Адрес
// раздела обязан показывать раздел.
//
// Незаконченная работа при этом не теряется, потому что она не здесь: цель,
// книга и программа лежат на сервере с первого же шага и видны в каталоге.
// Сеанс мастера — это только «где сейчас курсор», и переживать перезагрузку
// ему незачем.

"use client";

import { create } from "zustand";

import {
  type CoursePlan,
  type CurriculumDocument,
  CurriculumApiError,
  type GeneratePlanResponse,
  type IngestionState,
  type LearningGoal,
  type PlanIssue,
  type ReviewFinding,
  approvePlan,
  confirmGoal,
  createGoal,
  generatePlan,
  getIngestionState,
  normalizeGoal,
  startIngestion,
  updateGoal,
  uploadDocument,
} from "@/lib/curriculum-api";
import { isTerminal } from "@/lib/curriculum-progress";

/**
 * Сколько ждать генерацию плана.
 *
 * Клиент — САМЫЙ ВНЕШНИЙ слой, и он обязан ждать дольше всех остальных. Порядок,
 * который должен соблюдаться сверху вниз:
 *
 *     клиент 420 с  >  gunicorn 360 с  >  дедлайн генерации 300 с  >  модель 180 с
 *
 * Равные значения — худший вариант: клиент обрывает запрос ровно тогда, когда
 * сервер ещё мог ответить, и ученик видит ошибку вместо готового плана.
 *
 * Бэкенд теперь сам укладывается в свой дедлайн и деградирует по нему, пропуская
 * починку и рецензию (см. `CURRICULUM_PLAN_DEADLINE_SECONDS`). Но обрыв запроса
 * на клиенте по-прежнему НЕ отменяет работу на сервере, и повторное нажатие
 * плодит дубли планов. Настоящее решение — «задача + опрос», как у обработки
 * учебника (см. ROADMAP, Фаза 4b).
 *
 * Запрос идёт напрямую в BACKEND_URL, минуя Next-прокси (см. `curriculum-api.ts`),
 * поэтому `proxyTimeout` из next.config.js в этой цепочке не участвует.
 */
const PLAN_TIMEOUT_MS = 420_000;

export type WizardStep =
  | "goal"
  | "goal_confirm"
  | "upload"
  | "processing"
  | "planning"
  | "plan_review"
  | "done";

export const STEP_ORDER: readonly WizardStep[] = [
  "goal",
  "goal_confirm",
  "upload",
  "processing",
  "planning",
  "plan_review",
  "done",
];

export interface WizardError {
  code: string;
  message: string;
}

interface CurriculumState {
  step: WizardStep;

  goalId: string | null;
  goal: LearningGoal | null;

  documentId: string | null;
  document: CurriculumDocument | null;
  ingestion: IngestionState | null;
  uploadProgress: number;

  planId: string | null;
  plan: CoursePlan | null;
  coverageRatio: number | null;
  planWarnings: string[];
  planIssues: PlanIssue[];
  reviewFindings: ReviewFinding[];

  busy: boolean;
  error: WizardError | null;

  setStep: (step: WizardStep) => void;
  clearError: () => void;
  reset: () => void;

  /** Новый предмет с нуля. */
  startNewSubject: () => void;
  /** Ещё одна книга к уже существующему предмету. */
  addBookToSubject: (goalId: string) => void;
  /** Вернуться к подтверждению разбора цели. */
  openSubjectSetup: (goal: LearningGoal) => void;
  /** Открыть подробный прогресс обработки книги. */
  openBookProgress: (
    goalId: string | null,
    document: CurriculumDocument,
  ) => void;

  submitGoal: (text: string) => Promise<void>;
  saveGoalDetails: (
    patch: Parameters<typeof updateGoal>[1],
    edits: Parameters<typeof confirmGoal>[1],
  ) => Promise<void>;

  upload: (file: File, title?: string) => Promise<void>;
  refreshIngestion: () => Promise<IngestionState | null>;
  restartIngestion: () => Promise<void>;

  requestPlan: () => Promise<void>;
  approve: () => Promise<void>;
}

const INITIAL = {
  step: "goal" as WizardStep,
  goalId: null,
  goal: null,
  documentId: null,
  document: null,
  ingestion: null,
  uploadProgress: 0,
  planId: null,
  plan: null,
  coverageRatio: null,
  planWarnings: [] as string[],
  planIssues: [] as PlanIssue[],
  reviewFindings: [] as ReviewFinding[],
  busy: false,
  error: null as WizardError | null,
};

function toWizardError(error: unknown): WizardError {
  if (error instanceof CurriculumApiError) {
    return { code: error.code || String(error.status), message: error.message };
  }
  // Прерывание по таймауту прилетает как DOMException, и её `message` — это
  // «signal is aborted without reason»: по-английски и бессмысленно для ученика.
  if (isAbortError(error)) {
    return {
      code: "timeout",
      message:
        "Модель не ответила за семь минут. Обычно помогает повторить попытку.",
    };
  }
  // Сетевой сбой fetch тоже даёт бесполезное «Failed to fetch».
  if (error instanceof TypeError) {
    return {
      code: "network",
      message: "Не удалось связаться с сервером. Проверьте соединение.",
    };
  }
  if (error instanceof Error)
    return { code: "unexpected", message: error.message };
  return { code: "unexpected", message: "Что-то пошло не так." };
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export const useCurriculumStore = create<CurriculumState>()((set, get) => ({
  ...INITIAL,

  setStep: (step) => set({ step, error: null }),
  clearError: () => set({ error: null }),
  reset: () => set({ ...INITIAL }),

  startNewSubject: () => set({ ...INITIAL }),

  /**
   * Мастер для уже существующего предмета.
   *
   * Цель не создаётся заново и не переспрашивается — она уже подтверждена,
   * поэтому вход сразу на шаг загрузки. Всё, что осталось от предыдущей
   * книги (документ, прогресс обработки, план), обнуляется: иначе мастер
   * покажет чужой прогресс, пока не придёт первый ответ сервера.
   */
  addBookToSubject: (goalId) =>
    set({
      ...INITIAL,
      goalId,
      step: "upload",
    }),

  // Объект цели передаётся из каталога, а не запрашивается заново: он там
  // уже загружен, и лишний round-trip дал бы пустой экран на его время.
  openSubjectSetup: (goal) =>
    set({
      ...INITIAL,
      goalId: goal.id,
      goal,
      step: "goal_confirm",
    }),

  // Шаг выбирается по состоянию книги, а не задаётся вызывающим: у готовой
  // книги следующее осмысленное действие — построить программу, у
  // остальных — смотреть обработку. Держать это знание в двух местах
  // значит однажды показать экран ожидания над готовой книгой.
  openBookProgress: (goalId, document) =>
    set({
      ...INITIAL,
      goalId,
      documentId: document.id,
      document,
      step: document.ingestion_status === "ready" ? "planning" : "processing",
    }),

  submitGoal: async (text) => {
    set({ busy: true, error: null });
    try {
      const created = await createGoal(text);
      // Нормализация может не удаться (нет сети до модели) — это не повод
      // ронять сценарий: ученик просто заполнит предмет сам.
      const normalized = await normalizeGoal(created.id).catch(() => created);
      set({
        goalId: normalized.id,
        goal: normalized,
        step: "goal_confirm",
        busy: false,
      });
    } catch (error) {
      set({ busy: false, error: toWizardError(error) });
    }
  },

  saveGoalDetails: async (patch, edits) => {
    const goalId = get().goalId;
    if (!goalId) return;
    set({ busy: true, error: null });
    try {
      await updateGoal(goalId, patch);
      const goal = await confirmGoal(goalId, edits);
      set({ goal, step: "upload", busy: false });
    } catch (error) {
      set({ busy: false, error: toWizardError(error) });
    }
  },

  upload: async (file, title) => {
    set({ busy: true, error: null, uploadProgress: 0 });
    try {
      const { document } = await uploadDocument(file, {
        title,
        // Предмет проставляется здесь, а не отдельным запросом после
        // загрузки: иначе книга успевала бы показаться в каталоге как
        // «ничья», а при обрыве связи такой и осталась бы.
        goalId: get().goalId,
        onProgress: (fraction) => set({ uploadProgress: fraction }),
      });
      // Постановка в обработку отвечает сразу: прогресс забирается опросом.
      await startIngestion(document.id);
      set({
        documentId: document.id,
        document,
        step: "processing",
        busy: false,
        uploadProgress: 1,
      });
      await get().refreshIngestion();
    } catch (error) {
      set({ busy: false, uploadProgress: 0, error: toWizardError(error) });
    }
  },

  /**
   * Один опрос статуса. Планировщик интервалов живёт в компоненте — стор не
   * должен владеть таймерами, иначе их нельзя остановить при размонтировании.
   *
   * Ошибку сети наверх пробрасываем: экран ожидания сам решает, показывать ли
   * «связь потеряна» или молча повторить.
   */
  refreshIngestion: async () => {
    const documentId = get().documentId;
    if (!documentId) return null;
    const state = await getIngestionState(documentId);
    set((current) => ({
      ingestion: state,
      document: current.document
        ? { ...current.document, ingestion_status: state.ingestion_status }
        : current.document,
    }));
    if (
      isTerminal(state.ingestion_status) &&
      state.ingestion_status === "ready"
    ) {
      set({ step: "planning" });
    }
    return state;
  },

  restartIngestion: async () => {
    const documentId = get().documentId;
    if (!documentId) return;
    set({ busy: true, error: null });
    try {
      await startIngestion(documentId);
      set({ busy: false });
      await get().refreshIngestion();
    } catch (error) {
      set({ busy: false, error: toWizardError(error) });
    }
  },

  requestPlan: async () => {
    const { goalId, documentId } = get();
    if (!goalId || !documentId) return;

    set({ busy: true, error: null, planIssues: [] });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PLAN_TIMEOUT_MS);
    try {
      const result: GeneratePlanResponse = await generatePlan(
        goalId,
        documentId,
        controller.signal,
      );
      set({
        planId: result.plan.id,
        plan: result.plan,
        coverageRatio: result.coverage_ratio,
        planWarnings: result.warnings || [],
        reviewFindings: result.review_findings || [],
        step: "plan_review",
        busy: false,
      });
    } catch (error) {
      // Отказ валидатора — это не поломка, а результат: показываем претензии
      // и оставляем человека на шаге генерации с кнопкой «попробовать снова».
      const issues = error instanceof CurriculumApiError ? error.issues : [];
      set({ busy: false, planIssues: issues, error: toWizardError(error) });
    } finally {
      clearTimeout(timer);
    }
  },

  approve: async () => {
    const planId = get().planId;
    if (!planId) return;
    set({ busy: true, error: null });
    try {
      const { plan } = await approvePlan(planId);
      set({ plan, step: "done", busy: false });
    } catch (error) {
      set({ busy: false, error: toWizardError(error) });
    }
  },
}));

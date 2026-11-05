// Загрузка всего, что нужно странице программы.
//
// Страница НЕ читает состояние мастера. Причина конкретная: в сторе лежит `planId`
// последнего мастера, и он может относиться к другой программе. По вставленной ссылке
// страница на один кадр показала бы чужой курс: худший возможный сбой для экрана, весь
// смысл которого в достоверности.
//
// Мост к мастеру односторонний и под защитой: замечания рецензента берутся оттуда, только
// если `store.planId` совпадает с тем, что в адресе.

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type CoursePlan,
  type CoursePlanSummary,
  type CurriculumDocument,
  CurriculumApiError,
  type DocumentSectionRef,
  type LearningGoal,
  type StudyMaterial,
  approvePlan,
  getDocument,
  getGoal,
  getPlan,
  getSections,
  listMaterials,
  listPlans,
} from "@/lib/curriculum-api";
import { useCurriculumStore } from "@/stores/curriculum-store";

import { type PlanProgress, loadPlanProgress } from "./use-course-progress";

export type PlanPageErrorKind = "not_found" | "forbidden" | "network";

export interface PlanPageReady {
  state: "ready";
  plan: CoursePlan;
  /** Каждый из контекстных запросов деградирует независимо: план важнее контекста. */
  document: CurriculumDocument | null;
  /** Источник без файла, если программа посчитана по нему. */
  material: StudyMaterial | null;
  goal: LearningGoal | null;
  sections: DocumentSectionRef[];
  /** Расписание и пройденное. `null`: расписания у программы нет. */
  progress: PlanProgress | null;
  /** Расписания не ответили: про пройденное страница просто молчит, а не врёт, что его нет. */
  progressFailed: boolean;
  /** Курсы этого же предмета, для переключателя в шапке. */
  siblings: CoursePlanSummary[];
  /** Что-то из контекста не доехало: страница говорит об этом вслух. */
  degraded: boolean;
}

export type PlanPageData =
  | { state: "loading" }
  | { state: "error"; kind: PlanPageErrorKind; message: string }
  | PlanPageReady;

function classify(error: unknown): { kind: PlanPageErrorKind; message: string } {
  if (error instanceof CurriculumApiError) {
    if (error.status === 404) {
      return {
        kind: "not_found",
        message: "Такой программы нет. Возможно, её удалили или построили заново.",
      };
    }
    if (error.status === 401 || error.status === 403) {
      // Не винить ссылку в проблеме доступа: ссылка рабочая, аккаунт другой.
      return {
        kind: "forbidden",
        message: "Эта программа принадлежит другому аккаунту.",
      };
    }
  }
  return {
    kind: "network",
    message: "Не получилось загрузить программу. Проверь интернет и попробуй ещё раз.",
  };
}

export function usePlanPageData(planId: string) {
  const [data, setData] = useState<PlanPageData>({ state: "loading" });
  // Счётчик перезагрузок вместо подавляющего комментария к exhaustive-deps.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setData({ state: "loading" });

    void (async () => {
      try {
        // План фатален: без него страницы нет.
        const plan = await getPlan(planId);
        const [document, goal, sections, material, progress, plans] = await Promise.all([
          plan.document ? getDocument(plan.document).catch(() => null) : null,
          plan.goal ? getGoal(plan.goal).catch(() => null) : null,
          plan.document ? getSections(plan.document).catch(() => null) : null,
          plan.material
            ? listMaterials()
                .then((items) => items.find((item) => item.id === plan.material) ?? null)
                .catch(() => null)
            : null,
          loadPlanProgress(planId).catch(() => "failed" as const),
          listPlans().catch(() => [] as CoursePlanSummary[]),
        ]);
        if (cancelled) return;
        setData({
          state: "ready",
          plan,
          document,
          material,
          goal,
          sections: sections ?? [],
          progress: progress === "failed" ? null : progress,
          progressFailed: progress === "failed",
          siblings: plans.filter((item) => item.goal === plan.goal),
          // Книги могло не быть вовсе: это не сбой, а программа по другому источнику.
          degraded: Boolean(plan.document) && (document === null || sections === null),
        });
      } catch (error) {
        if (cancelled) return;
        setData({ state: "error", ...classify(error) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [planId, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const setPlan = useCallback((plan: CoursePlan) => {
    setData((current) => (current.state === "ready" ? { ...current, plan } : current));
  }, []);

  /** Срок живёт на цели: после смены темпа страница должна показать новый. */
  const setDeadline = useCallback((date: string | null) => {
    setData((current) =>
      current.state === "ready" && current.goal
        ? { ...current, goal: { ...current.goal, desired_finish_date: date } }
        : current,
    );
  }, []);

  return { data, reload, setPlan, setDeadline };
}

/**
 * Замечания рецензента только для программы, которую ты только что построил.
 *
 * `coverage_ratio`, `warnings` и `review_findings` живут в ответе генерации;
 * `GET /plans/{id}/` их не возвращает, поэтому по холодной ссылке их структурно нет.
 */
export function useGenerationContext(planId: string) {
  const matches = useCurriculumStore((s) => s.planId === planId);
  const findings = useCurriculumStore((s) => s.reviewFindings);
  const warnings = useCurriculumStore((s) => s.planWarnings);
  return {
    fromGeneration: matches,
    reviewFindings: matches ? findings : [],
    planWarnings: matches ? warnings : [],
  };
}

/**
 * Утверждение программы.
 *
 * Ходим в API напрямую, а состояние мастера подтягиваем следом, и только если речь об
 * одной и той же программе. Иначе утверждение по ссылке переписало бы чужой мастер.
 */
export function useApprovePlan(planId: string, onApproved: (plan: CoursePlan) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const approve = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { plan } = await approvePlan(planId);
      onApproved(plan);
      if (useCurriculumStore.getState().planId === planId) {
        useCurriculumStore.setState({ plan, step: "done" });
      }
    } catch (cause) {
      setError(
        cause instanceof CurriculumApiError
          ? cause.message
          : "Не получилось подтвердить программу. Попробуй ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }, [planId, onApproved]);

  return { approve, busy, error };
}

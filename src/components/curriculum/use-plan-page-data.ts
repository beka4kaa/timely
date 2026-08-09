// Загрузка всего, что нужно странице программы.
//
// Страница НЕ читает состояние мастера. Причина конкретная: в localStorage
// лежит `planId` последнего мастера, и он может относиться к другой программе.
// По вставленной ссылке страница на один кадр показала бы чужой курс — худший
// возможный сбой для экрана, весь смысл которого в достоверности.
//
// Мост к мастеру односторонний и под защитой: замечания рецензента берутся
// оттуда, только если `store.planId` совпадает с тем, что в адресе. Пришёл из
// генерации — видишь замечания; пришёл по ссылке — не видишь, и страница об
// этом говорит.

"use client";

import { useCallback, useEffect, useState } from "react";

import {
  type CoursePlan,
  type CurriculumDocument,
  CurriculumApiError,
  type DocumentSectionRef,
  type LearningGoal,
  approvePlan,
  getDocument,
  getGoal,
  getPlan,
  getSections,
} from "@/lib/curriculum-api";
import { useCurriculumStore } from "@/stores/curriculum-store";

export type PlanPageErrorKind = "not_found" | "forbidden" | "network";

export interface PlanPageReady {
  state: "ready";
  plan: CoursePlan;
  /** Каждый из трёх деградирует независимо: план важнее контекста. */
  document: CurriculumDocument | null;
  goal: LearningGoal | null;
  sections: DocumentSectionRef[];
  /** Что-то из контекста не доехало — страница говорит об этом вслух. */
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
        message: "Такой программы нет. Возможно, её удалили или начали заново.",
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
    message: "Не удалось загрузить программу. Проверьте соединение.",
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
        const [document, goal, sections] = await Promise.all([
          plan.document ? getDocument(plan.document).catch(() => null) : null,
          plan.goal ? getGoal(plan.goal).catch(() => null) : null,
          plan.document ? getSections(plan.document).catch(() => null) : null,
        ]);
        if (cancelled) return;
        setData({
          state: "ready",
          plan,
          document,
          goal,
          sections: sections ?? [],
          degraded: document === null || sections === null,
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
    setData((current) =>
      current.state === "ready" ? { ...current, plan } : current,
    );
  }, []);

  return { data, reload, setPlan };
}

/**
 * Замечания рецензента — только для программы, которую ты только что построил.
 *
 * `coverage_ratio`, `warnings` и `review_findings` живут в ответе генерации;
 * `GET /plans/{id}/` их не возвращает, поэтому по холодной ссылке их
 * структурно нет.
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
 * Ходим в API напрямую, а состояние мастера подтягиваем следом — и только если
 * речь об одной и той же программе. Иначе утверждение по ссылке переписало бы
 * чужой мастер.
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
          : "Не удалось утвердить программу. Попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }, [planId, onApproved]);

  return { approve, busy, error };
}

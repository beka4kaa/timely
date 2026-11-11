// Мастер добавления: цель → учебник → обработка → программа.
//
// Компонент тонкий: он выбирает шаг и показывает общие для всех шагов вещи: полоску
// шагов и ошибку. Вся логика живёт в сторе, вся арифметика в `lib/curriculum-progress`.
//
// Готовой программы здесь нет: она живёт на своём адресе, потому что это экран, на
// который возвращаются каждый день, и на него нужна ссылка.

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { GoalConfirmStep, GoalStep } from "@/components/curriculum/goal-steps";
import { IngestionProgress } from "@/components/curriculum/ingestion-progress";
import { PlanGenerationStep } from "@/components/curriculum/plan-review";
import { UploadStep } from "@/components/curriculum/upload-step";
import { Icon } from "@/components/shell/icons";
import { type WizardStep, useCurriculumStore } from "@/stores/curriculum-store";

/** Крупные вехи для полоски вверху. Внутренние шаги в неё не выносим. */
const RAIL: { key: string; label: string; steps: WizardStep[] }[] = [
  { key: "goal", label: "Цель", steps: ["goal", "goal_confirm"] },
  { key: "book", label: "Учебник", steps: ["upload", "processing"] },
  { key: "plan", label: "Программа", steps: ["planning", "plan_review", "done"] },
];

export function CurriculumWizard({ onClose }: { onClose?: () => void } = {}) {
  const router = useRouter();
  const step = useCurriculumStore((s) => s.step);
  const planId = useCurriculumStore((s) => s.planId);
  const error = useCurriculumStore((s) => s.error);
  const clearError = useCurriculumStore((s) => s.clearError);
  const reset = useCurriculumStore((s) => s.reset);

  // Готовая программа показывается на своём адресе.
  const readyToRedirect = planId && (step === "plan_review" || step === "done");
  useEffect(() => {
    if (readyToRedirect) router.replace(`/dashboard/curriculum/plan/${planId}`);
  }, [readyToRedirect, planId, router]);

  if (readyToRedirect) {
    return (
      <div className="content view cur-page">
        <p className="lede wz-wait" role="status">
          Открываю программу…
        </p>
      </div>
    );
  }

  const close = onClose
    ? () => {
        reset();
        onClose();
      }
    : undefined;

  const activeRail = RAIL.findIndex((item) => item.steps.includes(step));
  // Ошибку генерации показывает сам экран генерации: дублировать её сверху не нужно.
  const showBanner = error && step !== "planning";

  return (
    <div className="content view cur-page">
      <div className="wz-top">
        {onClose ? (
          <button
            type="button"
            className="back"
            // Сеанс сбрасывается вместе с уходом: он нужен ровно до возвращения на
            // стеллаж, где то же самое видно с сервера.
            onClick={close}
          >
            Курсы и книги
          </button>
        ) : (
          <span />
        )}

        <ol className="wz-rail" aria-label="Шаги">
          {RAIL.map((item, index) => (
            <li
              key={item.key}
              className={index < activeRail ? "is-done" : undefined}
              aria-current={index === activeRail ? "step" : undefined}
            >
              {index < activeRail ? <Icon name="check" /> : null}
              {item.label}
            </li>
          ))}
        </ol>
      </div>

      {showBanner ? (
        <div className="cur-alert is-bad" role="alert">
          <span>{error.message}</span>
          <button type="button" className="icon-btn" onClick={clearError} aria-label="Скрыть ошибку">
            <Icon name="x" />
          </button>
        </div>
      ) : null}

      {step === "goal" ? <GoalStep /> : null}
      {step === "goal_confirm" ? <GoalConfirmStep /> : null}
      {step === "upload" ? <UploadStep /> : null}
      {step === "processing" ? <IngestionProgress /> : null}
      {step === "planning" ? <PlanGenerationStep onClose={close} /> : null}

      {step !== "goal" ? (
        <p className="wz-again">
          <button type="button" className="btn btn-text" onClick={reset}>
            Начать заново
          </button>
        </p>
      ) : null}
    </div>
  );
}

"use client";

import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type PlanningPopoverState =
  | "idle"
  | "loading"
  | "question"
  | "answering"
  | "complete"
  | "error"
  | "fallback";

export interface PlanningQuestionPopoverProps {
  step: number;
  totalSteps?: number;
  eyebrow?: string;
  question: string;
  description?: string;
  state?: PlanningPopoverState;
  notice?: string;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** Always-visible bypass: skips the rest of the intake and opens the plain chat. */
  onSkip?: () => void;
}

export function PlanningProgressDots({
  step,
  totalSteps = 4,
}: {
  step: number;
  totalSteps?: number;
}) {
  const visibleTotal = Math.min(4, Math.max(1, totalSteps));
  const activeStep = Math.min(visibleTotal, Math.max(1, step));

  return (
    <div
      className="flex items-center gap-1.5"
      role="progressbar"
      aria-label={`Шаг ${activeStep} из ${visibleTotal}`}
      aria-valuemin={1}
      aria-valuemax={visibleTotal}
      aria-valuenow={activeStep}
    >
      {Array.from({ length: visibleTotal }, (_, index) => {
        const dotStep = index + 1;
        const isCurrent = dotStep === activeStep;
        const isComplete = dotStep < activeStep;
        return (
          <span
            key={dotStep}
            aria-hidden="true"
            className={`h-1.5 rounded-full transition-[width,background-color,opacity] duration-200 ${
              isCurrent
                ? "w-5 bg-[#9c6b31]"
                : isComplete
                  ? "w-1.5 bg-[#c79a61]"
                  : "w-1.5 bg-[#d9d3ca]"
            }`}
          />
        );
      })}
    </div>
  );
}

export function PlanningQuestionPopover({
  step,
  totalSteps = 4,
  eyebrow = "Настройка урока",
  question,
  description,
  state = "question",
  notice,
  children,
  footer,
  className = "",
  onSkip,
}: PlanningQuestionPopoverProps) {
  const isLoading = state === "loading";

  return (
    <section
      data-state={state}
      aria-busy={isLoading}
      aria-live="polite"
      className={`planning-popover-enter rounded-[20px] border border-[#d9d3c9] bg-[#fbfaf7]/98 p-4 shadow-[0_18px_54px_rgba(62,50,37,0.12)] backdrop-blur-xl max-sm:fixed max-sm:inset-x-3 max-sm:top-[calc(50%+24px)] max-sm:z-[150] max-sm:max-h-[calc(100dvh-72px)] max-sm:w-auto max-sm:-translate-y-1/2 max-sm:overflow-y-auto sm:relative ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#9b7548]">
          {eyebrow}
        </span>
        <div className="flex items-center gap-3">
          <PlanningProgressDots step={step} totalSteps={totalSteps} />
          {onSkip && (
            <button
              type="button"
              onClick={onSkip}
              className="whitespace-nowrap text-[10px] font-medium text-[#a49c8f] underline decoration-dotted underline-offset-2 outline-none transition-colors hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
            >
              Пропустить
            </button>
          )}
        </div>
      </div>

      <div className="mt-3">
        <h3 className="font-serif text-[19px] font-medium leading-[1.18] tracking-[-0.025em] text-[#39332d]">
          {question}
        </h3>
        {description && (
          <p className="mt-1.5 max-w-[390px] text-[11px] leading-relaxed text-[#8f887f]">
            {description}
          </p>
        )}
      </div>

      {notice && (
        <p className="mt-3 rounded-[10px] bg-[#f1ede6] px-2.5 py-2 text-[10px] text-[#7c746a]">
          {notice}
        </p>
      )}

      <div className="mt-4">
        {isLoading ? (
          <div className="flex min-h-24 items-center justify-center gap-2 text-[11px] text-[#8c857c]">
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
            Подбираю один полезный вопрос…
          </div>
        ) : (
          children
        )}
      </div>

      {footer && <div className="mt-4">{footer}</div>}
    </section>
  );
}

// Мастер «Курс по книге»: цель → учебник → обработка → программа.
//
// Компонент тонкий: он выбирает шаг и показывает общие для всех шагов вещи —
// полоску шагов и ошибку. Вся логика живёт в сторе, вся арифметика — в
// `lib/curriculum-progress`.
//
// Готовой программы здесь больше нет: она живёт на своём роуте, потому что это
// экран, на который возвращаются каждый день, и на него нужна ссылка.

"use client";

import { AlertTriangle, ArrowLeft, Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { GoalConfirmStep, GoalStep } from "@/components/curriculum/goal-steps";
import { IngestionProgress } from "@/components/curriculum/ingestion-progress";
import { PlanGenerationStep } from "@/components/curriculum/plan-review";
import { UploadStep } from "@/components/curriculum/upload-step";
import { type WizardStep, useCurriculumStore } from "@/stores/curriculum-store";
import { paperFocus } from "./paper";

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
  const hydrated = useCurriculumStore((s) => s.hydrated);
  const error = useCurriculumStore((s) => s.error);
  const clearError = useCurriculumStore((s) => s.clearError);
  const reset = useCurriculumStore((s) => s.reset);

  // `hydrateFromServer` зовёт `CurriculumSection` — она же выбирает, показать
  // мастер или каталог, и обязана знать состояние раньше. Второй вызов отсюда
  // означал бы удвоенный запрос за теми же тремя объектами.

  // Готовая программа показывается на своём роуте. Проверка `hydrated`
  // обязательна: без неё протухший `planId` из localStorage уводил бы на
  // несуществующую страницу и обратно — `hydrateFromServer` обнуляет его при
  // 404, но только после первого запроса.
  const readyToRedirect =
    hydrated && planId && (step === "plan_review" || step === "done");
  useEffect(() => {
    if (readyToRedirect) router.replace(`/dashboard/curriculum/plan/${planId}`);
  }, [readyToRedirect, planId, router]);

  if (!hydrated || readyToRedirect) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-[#a1978b]" />
      </div>
    );
  }

  const activeRail = RAIL.findIndex((item) => item.steps.includes(step));
  // Ошибку генерации показывает сам экран генерации — дублировать её сверху не
  // нужно, иначе одно и то же сообщение выводится дважды.
  const showBanner = error && step !== "planning";

  return (
    <div className="space-y-7">
      {onClose ? (
        <button
          type="button"
          onClick={() => {
            // Сеанс сбрасывается вместе с уходом: иначе каталог откроется, а
            // при следующем заходе `CurriculumSection` снова утащит в мастер по
            // сохранённым идентификаторам.
            reset();
            onClose();
          }}
          className={`${paperFocus} -mb-2 inline-flex items-center gap-1.5 rounded-full text-[12px] text-[#9b9186] underline-offset-4 hover:text-[#6f675e] hover:underline`}
        >
          <ArrowLeft className="h-3.5 w-3.5" />К предметам
        </button>
      ) : null}

      <ol className="flex items-center gap-2.5 text-[11px]">
        {RAIL.map((item, index) => (
          <li key={item.key} className="flex items-center gap-2.5">
            <span
              className={
                index === activeRail
                  ? "rounded-full border border-[#dec9ab] bg-[#fffaf1] px-3 py-1 text-[#8a5b24]"
                  : index < activeRail
                    ? "rounded-full px-3 py-1 text-[#7f776e]"
                    : "rounded-full px-3 py-1 text-[#b3a99c]"
              }
            >
              {item.label}
            </span>
            {index < RAIL.length - 1 && (
              <span className="h-px w-5 bg-[#ded8ce]" aria-hidden />
            )}
          </li>
        ))}
      </ol>

      {showBanner && (
        <div className="flex items-start gap-2.5 rounded-[14px] border border-[#e0c4c0] bg-[#fdf3f1] px-4 py-3 text-[13px] text-[#8c4b41]">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1 leading-5">{error.message}</span>
          <button
            type="button"
            onClick={clearError}
            aria-label="Скрыть ошибку"
            className={`${paperFocus} rounded-full p-0.5 text-[#b08b84] hover:text-[#8c4b41]`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {step === "goal" && <GoalStep />}
      {step === "goal_confirm" && <GoalConfirmStep />}
      {step === "upload" && <UploadStep />}
      {step === "processing" && <IngestionProgress />}
      {step === "planning" && <PlanGenerationStep />}

      {step !== "goal" && (
        <div className="border-t border-[#ded8ce] pt-5">
          <button
            type="button"
            onClick={reset}
            className={`${paperFocus} rounded-full text-[12px] text-[#9b9186] underline-offset-4 hover:text-[#6f675e] hover:underline`}
          >
            Начать заново
          </button>
        </div>
      )}
    </div>
  );
}

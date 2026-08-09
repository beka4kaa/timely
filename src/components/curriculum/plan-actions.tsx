// Действия над программой.
//
// У отклонённой программы кнопка утверждения СКРЫТА, а не заблокирована.
// Отключённая главная кнопка без объяснения читается как поломка интерфейса;
// её отсутствие вместе с текстом причины — как решение системы.

"use client";

import { Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CoursePlan } from "@/lib/curriculum-api";
import { useCurriculumStore } from "@/stores/curriculum-store";
import { formatPlanDate } from "@/lib/curriculum-forecast";
import { paperButton, paperPrimaryButton } from "./paper";

export function PlanActions({
  plan,
  canRegenerate,
  approving,
  approveError,
  onApprove,
}: {
  plan: CoursePlan;
  /** Перегенерация доступна только тому, кто пришёл из мастера. */
  canRegenerate: boolean;
  approving: boolean;
  approveError: string | null;
  onApprove: () => void;
}) {
  const router = useRouter();
  const requestPlan = useCurriculumStore((s) => s.requestPlan);
  const [regenerating, setRegenerating] = useState(false);

  const regenerate = async () => {
    setRegenerating(true);
    await requestPlan();
    const next = useCurriculumStore.getState().planId;
    setRegenerating(false);
    if (next && next !== plan.id) {
      router.replace(`/dashboard/curriculum/plan/${next}`);
    }
  };

  if (plan.status === "active") {
    return (
      <p className="flex items-center gap-2 text-[13px] text-[#5c7a52]">
        <Check className="h-4 w-4" />
        Программа активна
        {plan.created_at && (
          <span className="text-[#9b9186]">
            · построена {formatPlanDate(plan.created_at)}
          </span>
        )}
      </p>
    );
  }

  const approvable = plan.status !== "rejected" && plan.status !== "archived";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {approvable && (
          <button
            type="button"
            onClick={onApprove}
            disabled={approving}
            className={paperPrimaryButton}
          >
            {approving && <Loader2 className="h-4 w-4 animate-spin" />}
            Начать заниматься
          </button>
        )}
        {canRegenerate && (
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={regenerating || approving}
            className={paperButton}
          >
            {regenerating && <Loader2 className="h-4 w-4 animate-spin" />}
            Построить заново
          </button>
        )}
      </div>
      {approveError && (
        <p className="text-[12px] text-[#8c4b41]">{approveError}</p>
      )}
    </div>
  );
}

// Действия над программой.
//
// У отклонённой программы кнопка утверждения СКРЫТА, а не заблокирована.
// Отключённая главная кнопка без объяснения читается как поломка интерфейса;
// её отсутствие вместе с текстом причины — как решение системы.
//
// «Построить заново» раньше была доступна только тому, кто пришёл прямо из
// мастера, и звала ту же генерацию, что и он: прежняя программа при этом
// оставалась жить, и у одной книги накапливались одинаковые планы. Теперь это
// отдельное действие сервера, которое архивирует предыдущую версию, и оно
// доступно всегда — в том числе по холодной ссылке из каталога.

"use client";

import { Check, Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  type CoursePlan,
  generateMaterialPlan,
  rebuildPlan,
} from "@/lib/curriculum-api";
import { formatPlanDate } from "@/lib/curriculum-forecast";

import { PlanPaceDialog } from "./plan-pace";
import { PlanStructureEditor } from "./plan-structure-editor";
import { paperButton, paperPrimaryButton } from "./paper";

export function PlanActions({
  plan,
  approving,
  approveError,
  onApprove,
  onPlanChange,
}: {
  plan: CoursePlan;
  approving: boolean;
  approveError: string | null;
  onApprove: () => void;
  onPlanChange?: (plan: CoursePlan) => void;
}) {
  const router = useRouter();
  const [rebuilding, setRebuilding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rebuild = async () => {
    setRebuilding(true);
    setError(null);
    try {
      // У программы по источнику без файла пересборка своя: планировщику
      // нечего читать, зато пересчитать занятия по новым числам можно точно.
      const result = plan.material
        ? await generateMaterialPlan(plan.material)
        : await rebuildPlan(plan.id);
      // Новая программа живёт по своему адресу: прежний остаётся рабочей
      // ссылкой на архивную версию, поэтому переходим, а не подменяем данные.
      router.replace(`/dashboard/curriculum/plan/${result.plan.id}`);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не удалось построить программу заново.",
      );
    } finally {
      setRebuilding(false);
    }
  };

  const archived = plan.status === "archived";
  const approvable = plan.status !== "rejected" && !archived;
  // Состав подтверждённой программы не правится: по ней уже занимаются, и
  // версия защищена от изменения. Для неё остаётся «построить заново».
  const editable = !archived && plan.status !== "active";

  if (editing && onPlanChange) {
    return (
      <PlanStructureEditor
        plan={plan}
        onPlanChange={onPlanChange}
        onClose={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="space-y-3">
      {plan.status === "active" ? (
        <p className="flex items-center gap-2 text-[13px] text-[#5c7a52]">
          <Check className="h-4 w-4" />
          Программа активна
          {plan.created_at && (
            <span className="text-[#9b9186]">
              · построена {formatPlanDate(plan.created_at)}
            </span>
          )}
        </p>
      ) : null}

      {archived ? (
        <p className="text-[13px] text-[#8d857b]">
          Это прежняя версия программы — её вытеснила более новая.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {approvable && plan.status !== "active" && (
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

        {/* Темп меняет расписание, а не состав тем, поэтому доступен и на
            подтверждённой программе. */}
        {!archived && (
          <PlanPaceDialog plan={plan} onPlanChange={onPlanChange} />
        )}

        {editable && onPlanChange && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            disabled={rebuilding || approving}
            className={paperButton}
          >
            <Pencil className="h-4 w-4" />
            Править состав
          </button>
        )}

        {!archived && (
          <button
            type="button"
            onClick={() => void rebuild()}
            disabled={rebuilding || approving}
            className={paperButton}
          >
            {rebuilding && <Loader2 className="h-4 w-4 animate-spin" />}
            Построить заново
          </button>
        )}
      </div>

      {approveError && (
        <p className="text-[12px] text-[#8c4b41]">{approveError}</p>
      )}
      {error && <p className="text-[12px] text-[#8c4b41]">{error}</p>}
    </div>
  );
}

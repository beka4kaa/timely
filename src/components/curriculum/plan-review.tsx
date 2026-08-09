// Шаг генерации программы.
//
// Готовая программа живёт на роуте `/dashboard/curriculum/plan/[planId]`:
// экран, к которому возвращаются каждый день, обязан иметь адрес. Здесь
// остаётся только ожидание и разбор отказа валидатора.

"use client";

import { AlertTriangle, Loader2 } from "lucide-react";

import { useCurriculumStore } from "@/stores/curriculum-store";
import { paperPrimaryButton, paperStrip } from "./paper";

export function PlanGenerationStep() {
  const requestPlan = useCurriculumStore((s) => s.requestPlan);
  const busy = useCurriculumStore((s) => s.busy);
  const issues = useCurriculumStore((s) => s.planIssues);
  const error = useCurriculumStore((s) => s.error);
  const document = useCurriculumStore((s) => s.document);

  return (
    <section className="space-y-5">
      <header className="space-y-1.5">
        <h2 className="font-serif text-[22px] tracking-[-0.025em] text-[#302b26]">
          Учебник готов
        </h2>
        <p className="text-[13px] leading-6 text-[#7f776e]">
          {document?.title ?? "Документ"} разобран. Теперь построим программу по
          его разделам.
        </p>
      </header>

      {busy && (
        <div className={`${paperStrip} flex items-center gap-3 px-4 py-3.5 text-[13px]`}>
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#a1978b]" />
          <span className="text-[#7f776e]">
            Составляем программу — обычно это занимает 30–90 секунд.
          </span>
        </div>
      )}

      {!busy && error && (
        <div className="space-y-2.5 rounded-[14px] border border-[#e0cba8] bg-[#fdf6e8] px-4 py-3.5">
          <div className="flex items-start gap-2.5 text-[13px] text-[#8b6a2f]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span className="leading-5">{error.message}</span>
          </div>
          {issues.length > 0 && (
            <ul className="space-y-1 pl-7 text-[12px] leading-5 text-[#8b7a5e]">
              {issues.slice(0, 6).map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => void requestPlan()}
        disabled={busy}
        className={paperPrimaryButton}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {error ? "Попробовать снова" : "Построить программу"}
      </button>
    </section>
  );
}

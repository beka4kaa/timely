// Пограничные состояния страницы программы.
//
// Все — внутри `CoffeePageShell`: страница, потерявшая оправу, читается как
// сбой приложения, а не как ответ на конкретную ситуацию.

"use client";

import Link from "next/link";

import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";
import type { PlanPageErrorKind } from "./use-plan-page-data";
import { paperButton, paperCard, paperPrimaryButton } from "./paper";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <CoffeePageShell>
      {children}
    </CoffeePageShell>
  );
}

export function PlanPageSkeleton() {
  return (
    <Shell>
      <div className="space-y-4" aria-busy>
        <div className="h-[132px] animate-pulse rounded-[18px] border border-[#ded7cd] bg-[#f3efe8]" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <div className="h-24 animate-pulse rounded-[20px] border border-[#ddd7cd] bg-[#f3efe8]" />
            <div className="h-24 animate-pulse rounded-[20px] border border-[#ddd7cd] bg-[#f3efe8]" />
          </div>
          <div className="h-56 animate-pulse rounded-[20px] border border-[#ddd7cd] bg-[#f3efe8]" />
        </div>
      </div>
    </Shell>
  );
}

const TITLES: Record<PlanPageErrorKind, string> = {
  not_found: "Программа не найдена",
  forbidden: "Нет доступа к этой программе",
  network: "Программа не загрузилась",
};

export function PlanPageError({
  kind,
  message,
  onRetry,
}: {
  kind: PlanPageErrorKind;
  message: string;
  onRetry: () => void;
}) {
  return (
    <Shell>
      <div className={`${paperCard} max-w-xl p-6`}>
        <h2 className="font-serif text-[20px] tracking-[-0.02em] text-[#302b26]">
          {TITLES[kind]}
        </h2>
        <p className="mt-2 text-[13px] leading-6 text-[#7f776e]">{message}</p>

        <div className="mt-5 flex flex-wrap gap-3">
          {kind === "network" ? (
            <button type="button" onClick={onRetry} className={paperPrimaryButton}>
              Повторить
            </button>
          ) : (
            <Link href="/dashboard/curriculum" className={paperPrimaryButton}>
              Открыть курс по книге
            </Link>
          )}
          {kind === "network" && (
            <Link href="/dashboard/curriculum" className={paperButton}>
              К курсу по книге
            </Link>
          )}
        </div>
      </div>
    </Shell>
  );
}

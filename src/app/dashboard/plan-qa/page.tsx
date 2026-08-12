// Стенд календаря для разработки. В production роута нет.
//
// Живой «План» стоит за `FullAccessGate` и требует поднятого бэкенда с
// данными, поэтому посмотреть глазами пересечения, отменённое занятие или
// линию текущего времени иначе негде.

import { notFound } from "next/navigation";

import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";
import { PlanQaBoard } from "@/components/studyplan/plan-qa-board";

export const dynamic = "force-dynamic";

export default function PlanQaPage() {
  if (process.env.NODE_ENV === "production") notFound();

  return (
    <CoffeePageShell fillHeight maxWidthClassName="max-w-none">
      <PlanQaBoard />
    </CoffeePageShell>
  );
}

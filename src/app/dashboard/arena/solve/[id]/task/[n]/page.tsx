"use client";

// Одна задача контеста: условие на странице и ответ рядом. Открывается и в новой вкладке.

import { useParams } from "next/navigation";

import { ContestShell } from "@/components/arena/contest-shell";
import { ContestTask } from "@/components/arena/contest-task";

export default function ContestTaskPage() {
  const params = useParams<{ id: string; n: string }>();
  return (
    <ContestShell id={Number(params?.id)} tab="tasks" compact>
      {(contest, now, reload) => <ContestTask contest={contest} now={now} reload={reload} number={params?.n} />}
    </ContestShell>
  );
}

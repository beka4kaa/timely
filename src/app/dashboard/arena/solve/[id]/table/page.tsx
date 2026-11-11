"use client";

// Контест, вкладка «Таблица»: места, решённые задачи и баллы.

import { useParams } from "next/navigation";

import { ContestShell } from "@/components/arena/contest-shell";
import { ContestStandings } from "@/components/arena/contest-standings";

export default function ContestTablePage() {
  const params = useParams<{ id: string }>();
  return (
    <ContestShell id={Number(params?.id)} tab="table">
      {(contest) => <ContestStandings contest={contest} />}
    </ContestShell>
  );
}

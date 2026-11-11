"use client";

// Контест, вкладка «Все решения»: кто, какая задача, когда и вердикт. Ответов нет.

import { useParams } from "next/navigation";

import { ContestShell } from "@/components/arena/contest-shell";
import { ContestAttempts } from "@/components/arena/contest-standings";

export default function ContestAttemptsPage() {
  const params = useParams<{ id: string }>();
  return (
    <ContestShell id={Number(params?.id)} tab="attempts">
      {(contest) => <ContestAttempts contest={contest} />}
    </ContestShell>
  );
}

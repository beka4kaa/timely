"use client";

// Контест, вкладка «Задачи»: скачать условие, ввести ответ и сразу узнать вердикт.

import { useParams } from "next/navigation";

import { ContestShell } from "@/components/arena/contest-shell";
import { ContestTasks } from "@/components/arena/contest-tasks";

export default function ContestTasksPage() {
  const params = useParams<{ id: string }>();
  return (
    <ContestShell id={Number(params?.id)} tab="tasks">
      {(contest, _now, reload) => <ContestTasks contest={contest} reload={reload} />}
    </ContestShell>
  );
}

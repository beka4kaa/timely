// Экран ожидания обработки учебника.
//
// Обработка занимает от секунд до нескольких минут, и всё это время человек
// смотрит на экран, где формально ничего не происходит. Поэтому здесь три вещи,
// которые превращают ожидание в «работа идёт»: укрупнённые фазы вместо
// одиннадцати технических шагов, растущий секундомер и живые счётчики
// (страницы, разделы, фрагменты), которые заполняются по ходу.

"use client";

import {
  AlertTriangle,
  Check,
  Loader2,
  RefreshCw,
  WifiOff,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { useIngestionPolling } from "@/components/curriculum/use-ingestion-polling";
import {
  PHASES,
  formatElapsed,
  ingestionErrorMessage,
  ingestionWarningMessage,
  phaseIndexFor,
  phaseState,
} from "@/lib/curriculum-progress";
import { useCurriculumStore } from "@/stores/curriculum-store";
import { cn } from "@/lib/utils";

export function IngestionProgress() {
  const ingestion = useCurriculumStore((s) => s.ingestion);
  const document = useCurriculumStore((s) => s.document);
  const refreshIngestion = useCurriculumStore((s) => s.refreshIngestion);
  const restartIngestion = useCurriculumStore((s) => s.restartIngestion);
  const busy = useCurriculumStore((s) => s.busy);
  const [showDetails, setShowDetails] = useState(false);

  const status = ingestion?.ingestion_status ?? document?.ingestion_status ?? "uploaded";
  const failed = status === "failed";
  const done = status === "ready";

  const { elapsedMs, disconnected } = useIngestionPolling({
    enabled: !failed && !done,
    poll: refreshIngestion,
  });

  const currentPhase = phaseIndexFor(status);
  const stats = ingestion?.stats;
  const warnings = ingestion?.warnings ?? [];

  if (failed) {
    const job = ingestion?.job;
    return (
      <section className="space-y-5">
        <header className="space-y-2">
          <div className="flex items-center gap-2 text-red-500">
            <AlertTriangle className="h-5 w-5" />
            <h2 className="text-lg font-semibold">Обработать учебник не удалось</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            {ingestionErrorMessage(job?.error_code ?? "", job?.error_message ?? "")}
          </p>
        </header>
        <Button onClick={() => void restartIngestion()} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          Попробовать снова
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">Разбираем учебник</h2>
        <p className="text-sm text-muted-foreground">
          {document?.title ?? "Документ"} · идёт {formatElapsed(elapsedMs)}
        </p>
      </header>

      {disconnected && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <span className="text-muted-foreground">
            Связь с сервером потеряна — продолжаем попытки. Обработка при этом не
            прерывается.
          </span>
        </div>
      )}

      <ol className="space-y-3">
        {PHASES.map((phase, index) => {
          const state = phaseState(index, currentPhase);
          return (
            <li key={phase.key} className="flex items-center gap-3">
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs",
                  state === "done" && "border-emerald-500/40 bg-emerald-500/10",
                  state === "active" && "border-primary/50 bg-primary/10",
                  state === "pending" && "border-border text-muted-foreground",
                )}
              >
                {state === "done" ? (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                ) : state === "active" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  "text-sm",
                  state === "pending" ? "text-muted-foreground" : "font-medium",
                )}
              >
                {phase.label}
              </span>
            </li>
          );
        })}
      </ol>

      {stats && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Страниц" value={stats.pages} />
          <Stat label="Разделов" value={stats.sections} />
          <Stat label="Задач" value={stats.tasks} />
          <Stat label="Фрагментов" value={stats.chunks} />
        </dl>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-2">
          {warnings.map((code) => (
            <li
              key={code}
              className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-muted-foreground"
            >
              {ingestionWarningMessage(code)}
            </li>
          ))}
        </ul>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          {showDetails ? "Скрыть подробности" : "Подробности"}
        </button>
        {showDetails && (
          <div className="mt-3 space-y-1 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
            <p>
              Шаг {ingestion?.step_index ?? 0} из {ingestion?.step_total ?? 11} ·{" "}
              {ingestion?.step_label ?? status}
            </p>
            {(ingestion?.attempts ?? []).slice(-6).map((attempt, index) => (
              <p key={`${attempt.to_status}-${index}`}>
                {attempt.to_status} · {attempt.duration_ms} мс
                {attempt.succeeded ? "" : ` · ${attempt.error_code}`}
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

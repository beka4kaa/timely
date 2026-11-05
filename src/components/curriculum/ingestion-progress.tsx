// Экран ожидания обработки учебника.
//
// Обработка занимает от секунд до нескольких минут, и всё это время человек смотрит на
// экран, где формально ничего не происходит. Поэтому здесь то, что превращает ожидание в
// «работа идёт»: шаг из одиннадцати, укрупнённые фазы, растущий секундомер и живые
// счётчики (страницы, разделы, фрагменты), которые заполняются по ходу.

"use client";

import { useEffect, useState } from "react";

import { useIngestionPolling } from "@/components/curriculum/use-ingestion-polling";
import { coverAuthor, coverClass, coverTitle } from "@/lib/curriculum-cover";
import {
  PHASES,
  formatElapsed,
  ingestionErrorMessage,
  ingestionFailureTitle,
  ingestionWarningMessage,
  phaseIndexFor,
  phaseState,
} from "@/lib/curriculum-progress";
import { useCurriculumStore } from "@/stores/curriculum-store";

import { WizardHead } from "./wizard-head";

export function IngestionProgress() {
  const ingestion = useCurriculumStore((s) => s.ingestion);
  const document = useCurriculumStore((s) => s.document);
  const goal = useCurriculumStore((s) => s.goal);
  const refreshIngestion = useCurriculumStore((s) => s.refreshIngestion);
  const restartIngestion = useCurriculumStore((s) => s.restartIngestion);
  const busy = useCurriculumStore((s) => s.busy);
  const [showDetails, setShowDetails] = useState(false);

  const status = ingestion?.ingestion_status ?? document?.ingestion_status ?? "uploaded";
  const failed = status === "failed";
  const done = status === "ready";
  const stalled = Boolean(ingestion?.stalled || ingestion?.job?.error_code === "stalled");

  const { elapsedMs, disconnected } = useIngestionPolling({
    enabled: !failed && !done,
    poll: refreshIngestion,
  });

  // Опрос у упавшей книги не идёт, а причина отказа живёт только в её статусе. Пришли на этот
  // экран прямо с полки: спросим один раз, иначе вместо причины будет общая фраза.
  useEffect(() => {
    if (failed && !ingestion) void refreshIngestion().catch(() => null);
  }, [failed, ingestion, refreshIngestion]);

  const currentPhase = phaseIndexFor(status);
  const stats = ingestion?.stats;
  const warnings = ingestion?.warnings ?? [];
  const title = document ? coverTitle(document.title) : "Книга";

  if (failed) {
    const job = ingestion?.job;
    return (
      <>
        <WizardHead title={ingestionFailureTitle(stalled)}>
          {ingestionErrorMessage(stalled ? "stalled" : (job?.error_code ?? ""), job?.error_message ?? "")}
        </WizardHead>
        <div className="cur-acts">
          <button
            type="button"
            className="btn btn-main"
            onClick={() => void restartIngestion()}
            disabled={busy}
          >
            {busy ? "Запускаю…" : "Попробовать снова"}
          </button>
        </div>
      </>
    );
  }

  const stepIndex = ingestion?.step_index ?? 0;
  const stepTotal = ingestion?.step_total ?? 11;
  const percent = Math.round((ingestion?.progress ?? 0) * 100);

  return (
    <>
      <WizardHead title="Читаю учебник">
        «{title}», идёт {formatElapsed(elapsedMs)}
      </WizardHead>

      {disconnected ? (
        <p className="cur-alert is-bad" role="status">
          Связь с сервером потеряна, продолжаю пробовать. Сама обработка при этом не прерывается.
        </p>
      ) : null}

      <section className="card wz-sheet wz-reading">
        <div className="wz-cover" aria-hidden="true">
          <span
            className={`book reading ${coverClass(goal?.normalized_subject || title)} ${title.length > 20 ? "is-long" : ""}`}
          >
            <span className="cv-t">{title}</span>
            {document && coverAuthor(document.authors) ? <small>{coverAuthor(document.authors)}</small> : null}
            <i className="scan" />
          </span>
          <span className="plank" />
        </div>

        <div className="wz-reading-main">
          <p className="wz-step">
            {stepIndex > 0 ? (
              <>
                Шаг {stepIndex} из {stepTotal}
                {ingestion?.step_label ? <span className="muted"> {ingestion.step_label}</span> : null}
              </>
            ) : (
              "Готовлюсь к чтению"
            )}
          </p>
          <span
            className="tube"
            role="progressbar"
            aria-label="Сколько шагов пройдено"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            {percent > 0 ? <i style={{ width: `${percent}%` }} /> : null}
          </span>

          <ol className="wz-phases">
            {PHASES.map((phase, index) => {
              const state = phaseState(index, currentPhase);
              return (
                <li key={phase.key} className={state === "pending" ? "muted" : undefined}>
                  <span
                    className={`dot${state === "done" ? " done" : state === "active" ? " cur" : ""}`}
                    aria-hidden="true"
                  />
                  {phase.label}
                </li>
              );
            })}
          </ol>

          {stats ? (
            <dl className="wz-stats">
              <Stat label="Страниц" value={stats.pages} />
              <Stat label="Разделов" value={stats.sections} />
              <Stat label="Задач" value={stats.tasks} />
              <Stat label="Фрагментов" value={stats.chunks} />
            </dl>
          ) : null}

          {warnings.length > 0 ? (
            <ul className="wz-warnings">
              {warnings.map((code) => (
                <li key={code}>{ingestionWarningMessage(code)}</li>
              ))}
            </ul>
          ) : null}

          {(ingestion?.attempts ?? []).length > 0 ? (
            <div className="wz-details">
              <button type="button" className="link" onClick={() => setShowDetails((value) => !value)}>
                {showDetails ? "Скрыть подробности" : "Подробности"}
              </button>
              {showDetails ? (
                <ul className="muted">
                  {(ingestion?.attempts ?? []).slice(-6).map((attempt, index) => (
                    <li key={`${attempt.to_status}-${index}`}>
                      {attempt.to_status}, {attempt.duration_ms} мс
                      {attempt.succeeded ? "" : `, ${attempt.error_code}`}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dd className="num">{value}</dd>
      <dt className="muted">{label}</dt>
    </div>
  );
}

// Шаг генерации программы.
//
// Готовая программа живёт на своём адресе: экран, к которому возвращаются каждый день,
// обязан иметь ссылку. Здесь остаётся только ожидание и разбор отказа проверки.

"use client";

import { useEffect, useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { coverTitle } from "@/lib/curriculum-cover";
import {
  canRecognizeLater,
  ocrNotice,
  scansQuestion,
  unrecognizedScans,
} from "@/lib/curriculum-progress";
import { useCurriculumStore } from "@/stores/curriculum-store";

import { WizardHead } from "./wizard-head";

export function PlanGenerationStep({ onClose }: { onClose?: () => void } = {}) {
  const requestPlan = useCurriculumStore((s) => s.requestPlan);
  const restartIngestion = useCurriculumStore((s) => s.restartIngestion);
  const busy = useCurriculumStore((s) => s.busy);
  const issues = useCurriculumStore((s) => s.planIssues);
  const error = useCurriculumStore((s) => s.error);
  const document = useCurriculumStore((s) => s.document);
  const goalId = useCurriculumStore((s) => s.goalId);
  const ingestion = useCurriculumStore((s) => s.ingestion);
  const [asking, setAsking] = useState(false);

  // Свежая сводка лежит в статусе: ответ загрузки её не знает. С полки статуса нет, там список.
  const summary = ingestion?.ocr_summary ?? document?.ocr_summary;
  const missing = unrecognizedScans(summary);
  const mustAsk = canRecognizeLater(summary) && missing > 0;
  const notice = mustAsk ? null : ocrNotice(summary, { hasProgram: true });
  const question = mustAsk ? scansQuestion(missing, summary?.skipped === "quota" ? "quota" : "failed") : null;

  // Модель думает минуту-полторы: это как раз то ожидание, которое показывает маскот.
  useEffect(() => {
    if (!busy) return;
    mascot.thinkStart("Составляю программу");
    mascot.thought("Читаю оглавление и подбираю темы");
    return () => mascot.thinkEnd(useCurriculumStore.getState().error ? undefined : "Готово");
  }, [busy]);

  const title = document ? coverTitle(document.title) : "Книга";

  return (
    <>
      <WizardHead title="Учебник прочитан">
        {goalId
          ? `Книга «${title}» разобрана. Теперь составлю программу по её разделам.`
          : `Книга «${title}» загружена без предмета, поэтому программу не с чем связать. Загрузи её заново из карточки предмета.`}
      </WizardHead>

      {busy ? (
        <p className="wz-hint" role="status">
          Составляю программу, обычно это занимает 30–90 секунд.
        </p>
      ) : null}

      {!busy && notice ? <p className="wz-hint">{notice}</p> : null}

      {!busy && asking && question ? (
        <p className="wz-hint" role="status">
          {question.text}
        </p>
      ) : null}

      {!busy && error ? (
        <div className="cur-alert is-bad" role="alert">
          <div>
            {error.message}
            {issues.length > 0 ? (
              <ul className="cur-alert-list">
                {issues.slice(0, 6).map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {goalId ? (
        <div className="cur-acts">
          {asking && question ? (
            <>
              <button
                type="button"
                className="btn btn-main"
                onClick={() => void requestPlan()}
                disabled={busy}
              >
                {busy ? "Составляю…" : question.skip}
              </button>
              {summary?.skipped === "quota" ? (
                onClose ? (
                  <button type="button" className="btn btn-line" onClick={onClose} disabled={busy}>
                    Подождать
                  </button>
                ) : null
              ) : (
                <button
                  type="button"
                  className="btn btn-line"
                  onClick={() => void restartIngestion()}
                  disabled={busy}
                >
                  Обработать заново
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="btn btn-main"
              onClick={() => (mustAsk && !error ? setAsking(true) : void requestPlan())}
              disabled={busy}
            >
              {busy ? "Составляю…" : error ? "Попробовать снова" : "Составить программу"}
            </button>
          )}
        </div>
      ) : null}
    </>
  );
}

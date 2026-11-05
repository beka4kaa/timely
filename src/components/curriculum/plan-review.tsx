// Шаг генерации программы.
//
// Готовая программа живёт на своём адресе: экран, к которому возвращаются каждый день,
// обязан иметь ссылку. Здесь остаётся только ожидание и разбор отказа проверки.

"use client";

import { useEffect } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { coverTitle } from "@/lib/curriculum-cover";
import { useCurriculumStore } from "@/stores/curriculum-store";

import { WizardHead } from "./wizard-head";

export function PlanGenerationStep() {
  const requestPlan = useCurriculumStore((s) => s.requestPlan);
  const busy = useCurriculumStore((s) => s.busy);
  const issues = useCurriculumStore((s) => s.planIssues);
  const error = useCurriculumStore((s) => s.error);
  const document = useCurriculumStore((s) => s.document);
  const goalId = useCurriculumStore((s) => s.goalId);

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
          <button
            type="button"
            className="btn btn-main"
            onClick={() => void requestPlan()}
            disabled={busy}
          >
            {busy ? "Составляю…" : error ? "Попробовать снова" : "Составить программу"}
          </button>
        </div>
      ) : null}
    </>
  );
}

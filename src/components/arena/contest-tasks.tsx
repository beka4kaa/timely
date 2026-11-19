"use client";

// Вкладка «Задачи»: только задачи. До начала их нет, во время контеста у каждой строки
// ссылка на страницу задачи с условием, иконка скачивания PDF, поле ответа и «Проверить»,
// после конца правильный ответ, решение и разбор с тьютором.

import Link from "next/link";
import { useState } from "react";

import { useAskRail } from "@/contexts/ask-rail";
import { t } from "@/lib/i18n";
import { type Contest } from "@/lib/contest-api";
import { downloadContestPdf } from "@/lib/contest-pdf";
import { contestDate, reviewPrompt, taskPath, taskRows, type TaskRow } from "@/lib/contest-view";

import { TaskAnswer, TaskAnswerNote, useTaskAnswers } from "./task-answer";

function DownloadIcon() {
  return (
    <svg className="i" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M12 18v-6" />
      <path d="m9 15 3 3 3-3" />
    </svg>
  );
}

export function taskName(task: TaskRow): string {
  return task.title || t("Задача {number}", { number: task.number });
}

export function pdfName(task: TaskRow, kind: "statement" | "solution"): string {
  return `${kind === "statement" ? "zadacha" : "reshenie"}-${task.number}.pdf`;
}

export function ContestTasks({ contest, reload }: { contest: Contest; reload: () => void }) {
  const { prompt } = useAskRail();
  const answers = useTaskAnswers(contest, reload);
  const [fileNote, setFileNote] = useState<string | null>(null);

  if (contest.state === "upcoming") {
    return (
      <section className="ct-note card">
        <h2>{t("Задачи откроются в начале контеста")}</h2>
        <p>{contestDate(contest.start_time)}</p>
      </section>
    );
  }

  const rows = taskRows(contest);
  const ended = contest.state === "ended";

  async function download(task: TaskRow, kind: "statement" | "solution") {
    setFileNote(null);
    try {
      await downloadContestPdf(contest.id, task.id, kind, pdfName(task, kind));
    } catch {
      setFileNote(kind === "statement" ? t("Условие не скачалось. Попробуй ещё раз.") : t("Решение не скачалось. Попробуй ещё раз."));
    }
  }

  return (
    <>
      <ol className={`card cx-tasks${ended ? " is-past" : ""}`}>
        {rows.map((task) => {
          const { solved } = answers.view(task);
          return (
            <li key={task.id} className={`srow${solved ? " is-ok" : ""}`}>
              <span className="task-n">{task.number}</span>
              {task.has_statement ? (
                <button
                  className="dli"
                  type="button"
                  title={t("Скачать условие, PDF")}
                  aria-label={t("Скачать условие задачи {number}", { number: task.number })}
                  onClick={() => download(task, "statement")}
                >
                  <DownloadIcon />
                </button>
              ) : (
                <span className="dli" aria-hidden="true" />
              )}
              <Link className="nm nm-link" href={taskPath(contest.id, task.number)} title={t("Открыть задачу")}>
                {taskName(task)}
              </Link>
              <span className="pts">{solved ? `+${task.points}` : task.points}</span>
              <TaskAnswer task={task} answers={answers} ended={ended} onSolution={() => download(task, "solution")} />
              <TaskAnswerNote task={task} answers={answers} ended={ended} />
              {task.condition_text ? <p className="srow-text">{task.condition_text}</p> : null}
            </li>
          );
        })}
      </ol>
      {fileNote ? (
        <p className="small-note srow-file" role="alert">
          {fileNote}
        </p>
      ) : null}
      {ended && rows.length ? (
        <button
          className="btn btn-line cx-review"
          type="button"
          onClick={() => prompt({ target: "book", text: reviewPrompt(contest), send: true })}
        >
          {t("Разобрать с тьютором")}
        </button>
      ) : null}
    </>
  );
}

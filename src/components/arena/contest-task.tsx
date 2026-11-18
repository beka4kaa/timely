"use client";

// Страница одной задачи контеста: условие из PDF прямо на странице, рядом ответ.
// Её можно открыть в отдельной вкладке. После конца контеста тут же и решение.

import Link from "next/link";
import { useState } from "react";

import { type Contest } from "@/lib/contest-api";
import { downloadContestPdf, fetchContestPdf, type ContestPdfKind } from "@/lib/contest-pdf";
import { contestDate, countdown, ru, taskByNumber, taskPath, taskRows } from "@/lib/contest-view";

import { pdfName, taskName } from "./contest-tasks";
import { PdfView } from "./pdf-view";
import { TaskAnswer, TaskAnswerNote, useTaskAnswers } from "./task-answer";

function left(contest: Contest, now: Date): string {
  const parts = countdown(contest.end_time, now);
  return parts.map((part) => `${part.value} ${part.unit}`).join(" ");
}

export function ContestTask({
  contest,
  now,
  reload,
  number,
}: {
  contest: Contest;
  now: Date;
  reload: () => void;
  number: string | undefined;
}) {
  const answers = useTaskAnswers(contest, reload);
  const [kind, setKind] = useState<ContestPdfKind>("statement");
  const [fileNote, setFileNote] = useState<string | null>(null);

  if (contest.state === "upcoming") {
    return (
      <section className="ct-note card">
        <h2>Задачи откроются в начале контеста</h2>
        <p>{contestDate(contest.start_time)}</p>
      </section>
    );
  }

  const found = taskByNumber(taskRows(contest), number);
  if (!found) {
    return (
      <section className="ct-note card" role="alert">
        <h2>Такой задачи нет</h2>
        <p>
          <Link className="link" href={`/dashboard/arena/solve/${contest.id}`}>
            Все задачи контеста
          </Link>
        </p>
      </section>
    );
  }

  const { task, previous, next } = found;
  const ended = contest.state === "ended";
  const { solved } = answers.view(task);
  const showing: ContestPdfKind = ended && kind === "solution" && task.has_solution ? "solution" : "statement";
  const hasFile = showing === "solution" ? task.has_solution : task.has_statement;

  async function download() {
    setFileNote(null);
    try {
      await downloadContestPdf(contest.id, task.id, showing, pdfName(task, showing));
    } catch {
      setFileNote("Файл не скачался. Попробуй ещё раз.");
    }
  }

  return (
    <div className="cx-task">
      <header className="cx-task-head">
        <div>
          <h1>
            <span className="task-n">{task.number}</span>
            {taskName(task)}
          </h1>
          <p className="small-note">
            {solved ? `Решена, +${task.points}` : `${task.points} ${ru(task.points, "балл", "балла", "баллов")}`}
            {ended ? " · контест закончился" : ` · до конца ${left(contest, now)}`}
          </p>
        </div>
        {ended && task.has_solution ? (
          <div className="tabs cx-task-tabs" role="group" aria-label="Что показать">
            <button type="button" aria-pressed={showing === "statement"} onClick={() => setKind("statement")}>
              Условие
            </button>
            <button type="button" aria-pressed={showing === "solution"} onClick={() => setKind("solution")}>
              Решение
            </button>
          </div>
        ) : null}
      </header>

      <div className="cx-task-body">
        <section className="card cx-task-doc">
          {hasFile ? (
            <PdfView
              key={`${task.id}-${showing}`}
              label={showing === "solution" ? `Решение задачи ${task.number}` : `Условие задачи ${task.number}`}
              load={() => fetchContestPdf(contest.id, task.id, showing)}
            />
          ) : task.condition_text ? (
            <p className="cx-task-text">{task.condition_text}</p>
          ) : (
            <p className="small-note">У этой задачи нет условия в файле.</p>
          )}
        </section>

        <aside className="cx-task-side">
          <div className={`card cx-tasks cx-task-answer${ended ? " is-past" : ""}`}>
            <div className={`srow${solved ? " is-ok" : ""}`}>
              <TaskAnswer task={task} answers={answers} ended={ended} />
              <TaskAnswerNote task={task} answers={answers} ended={ended} />
            </div>
          </div>
          {hasFile ? (
            <button className="btn btn-line cx-task-dl" type="button" onClick={download}>
              Скачать PDF
            </button>
          ) : null}
          {fileNote ? (
            <p className="small-note srow-file" role="alert">
              {fileNote}
            </p>
          ) : null}
          <nav className="cx-task-nav" aria-label="Другие задачи">
            {previous ? (
              <Link className="btn btn-line" href={taskPath(contest.id, previous.number)}>
                ← Задача {previous.number}
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link className="btn btn-line" href={taskPath(contest.id, next.number)}>
                Задача {next.number} →
              </Link>
            ) : null}
          </nav>
        </aside>
      </div>
    </div>
  );
}

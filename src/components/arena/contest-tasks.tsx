"use client";

// Вкладка «Задачи»: только задачи. До начала их нет, во время контеста у каждой строки
// иконка скачивания PDF, поле ответа и «Проверить», после конца правильный ответ,
// решение и разбор с тьютором.

import { useState, type FormEvent } from "react";

import { useAskRail } from "@/contexts/ask-rail";
import { ContestApiError, answerTask, type Contest } from "@/lib/contest-api";
import { downloadContestPdf } from "@/lib/contest-pdf";
import { invalidateResources } from "@/lib/resource-cache";
import { answerErrorText, contestDate, reviewPrompt, taskRows, type TaskRow } from "@/lib/contest-view";

import { attemptsKey, contestKey, standingsKey } from "./contest-shell";

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

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function taskName(task: TaskRow): string {
  return task.title || `Задача ${task.number}`;
}

export function ContestTasks({ contest, reload }: { contest: Contest; reload: () => void }) {
  const { prompt } = useAskRail();
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [verdicts, setVerdicts] = useState<Record<number, boolean>>({});
  const [tries, setTries] = useState<Record<number, number>>({});
  const [fileNote, setFileNote] = useState<string | null>(null);

  if (contest.state === "upcoming") {
    return (
      <section className="ct-note card">
        <h2>Задачи откроются в начале контеста</h2>
        <p>{contestDate(contest.start_time)}</p>
      </section>
    );
  }

  const rows = taskRows(contest);
  const ended = contest.state === "ended";

  async function download(task: TaskRow, kind: "statement" | "solution") {
    setFileNote(null);
    try {
      await downloadContestPdf(contest.id, task.id, kind, `${kind === "statement" ? "zadacha" : "reshenie"}-${task.number}.pdf`);
    } catch {
      setFileNote(kind === "statement" ? "Условие не скачалось. Попробуй ещё раз." : "Решение не скачалось. Попробуй ещё раз.");
    }
  }

  async function check(event: FormEvent, task: TaskRow, text: string) {
    event.preventDefault();
    const answer = text.trim();
    if (!answer || busy !== null) return;
    setBusy(task.id);
    setNotes((current) => ({ ...current, [task.id]: "" }));
    try {
      const result = await answerTask(contest.id, task.id, answer);
      setVerdicts((current) => ({ ...current, [task.id]: result.correct }));
      setTries((current) => ({ ...current, [task.id]: result.attempt }));
      invalidateResources(standingsKey(contest.id));
      invalidateResources(attemptsKey(contest.id));
      if (result.correct) {
        invalidateResources("compete:submissions");
        invalidateResources(contestKey(contest.id));
      }
    } catch (error) {
      const code = error instanceof ContestApiError ? error.code : "error";
      if (code === "already_solved") {
        setVerdicts((current) => ({ ...current, [task.id]: true }));
        invalidateResources(contestKey(contest.id));
      } else {
        setNotes((current) => ({ ...current, [task.id]: answerErrorText(code) }));
        // Часы браузера ошиблись: контест уже закончился или ещё не начался.
        if (code === "not_running") reload();
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ol className={`card cx-tasks${ended ? " is-past" : ""}`}>
        {rows.map((task) => {
          const solved = Boolean(task.mine?.solved || verdicts[task.id]);
          const attempts = tries[task.id] ?? task.mine?.attempts ?? 0;
          const wrong = !solved && (verdicts[task.id] === false || attempts > 0);
          const value = values[task.id] ?? task.mine?.last_answer ?? "";
          return (
            <li key={task.id} className={`srow${solved ? " is-ok" : ""}`}>
              <span className="task-n">{task.number}</span>
              {task.has_statement ? (
                <button
                  className="dli"
                  type="button"
                  title="Скачать условие, PDF"
                  aria-label={`Скачать условие задачи ${task.number}`}
                  onClick={() => download(task, "statement")}
                >
                  <DownloadIcon />
                </button>
              ) : (
                <span className="dli" aria-hidden="true" />
              )}
              <span className="nm">{taskName(task)}</span>
              <span className="pts">{solved ? `+${task.points}` : task.points}</span>

              {ended ? (
                <span className="ans ans-past">
                  {solved ? (
                    <span className="verdict ok">
                      <CheckIcon />
                      Верно
                    </span>
                  ) : attempts > 0 ? (
                    <span className="verdict bad">Не решена</span>
                  ) : (
                    <span className="muted">Без ответа</span>
                  )}
                  {task.answer ? (
                    <span className="right-answer">
                      Ответ <b>{task.answer}</b>
                    </span>
                  ) : null}
                  {task.has_solution ? (
                    <button className="btn btn-line" type="button" onClick={() => download(task, "solution")}>
                      Решение
                    </button>
                  ) : null}
                </span>
              ) : (
                <form className="ans" onSubmit={(event) => check(event, task, value)}>
                  <input
                    className={`ans-in${solved ? " is-done" : wrong ? " is-bad" : ""}`}
                    value={value}
                    readOnly={solved}
                    maxLength={100}
                    placeholder="Ответ"
                    aria-label={`Ответ на задачу ${task.number}`}
                    onChange={(event) => setValues((current) => ({ ...current, [task.id]: event.target.value }))}
                  />
                  {solved ? (
                    <span className="verdict ok">
                      <CheckIcon />
                      Верно
                    </span>
                  ) : (
                    <button className="btn btn-main" type="submit" disabled={busy !== null || !value.trim()}>
                      {busy === task.id ? "Проверяю…" : "Проверить"}
                    </button>
                  )}
                </form>
              )}

              {notes[task.id] ? (
                <p className="srow-note is-error" role="alert">
                  {notes[task.id]}
                </p>
              ) : !ended && wrong ? (
                <p className="srow-note">
                  <span className="verdict bad">Неверно</span>, попытка {attempts}
                </p>
              ) : null}
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
          Разобрать с тьютором
        </button>
      ) : null}
    </>
  );
}

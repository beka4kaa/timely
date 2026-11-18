"use client";

// Ответ на задачу контеста: одно и то же в списке задач и на странице задачи.
// Состояние держит родитель через `useTaskAnswers`, а `TaskAnswer` рисует поле, вердикт
// и строку под ним для одной задачи.

import { useState, type FormEvent } from "react";

import { ContestApiError, answerTask, type Contest } from "@/lib/contest-api";
import { invalidateResources } from "@/lib/resource-cache";
import { answerErrorText, type TaskRow } from "@/lib/contest-view";

import { attemptsKey, contestKey, standingsKey } from "./contest-shell";

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export type TaskAnswers = ReturnType<typeof useTaskAnswers>;

export function useTaskAnswers(contest: Contest, reload: () => void) {
  const [values, setValues] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [verdicts, setVerdicts] = useState<Record<number, boolean>>({});
  const [tries, setTries] = useState<Record<number, number>>({});

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

  function view(task: TaskRow) {
    const solved = Boolean(task.mine?.solved || verdicts[task.id]);
    const attempts = tries[task.id] ?? task.mine?.attempts ?? 0;
    const wrong = !solved && (verdicts[task.id] === false || attempts > 0);
    const value = values[task.id] ?? task.mine?.last_answer ?? "";
    return { solved, attempts, wrong, value, note: notes[task.id] ?? "" };
  }

  function setValue(task: TaskRow, value: string) {
    setValues((current) => ({ ...current, [task.id]: value }));
  }

  return { busy, check, view, setValue };
}

/** Поле ответа и вердикт во время контеста; после конца — итог, ответ и кнопка решения. */
export function TaskAnswer({
  task,
  answers,
  ended,
  onSolution,
}: {
  task: TaskRow;
  answers: TaskAnswers;
  ended: boolean;
  /** Кнопка «Решение» в строке; на странице задачи её заменяет переключатель. */
  onSolution?: () => void;
}) {
  const { solved, attempts, wrong, value } = answers.view(task);

  if (ended) {
    return (
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
        {task.has_solution && onSolution ? (
          <button className="btn btn-line" type="button" onClick={onSolution}>
            Решение
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <form className="ans" onSubmit={(event) => answers.check(event, task, value)}>
      <input
        className={`ans-in${solved ? " is-done" : wrong ? " is-bad" : ""}`}
        value={value}
        readOnly={solved}
        maxLength={100}
        placeholder="Ответ"
        aria-label={`Ответ на задачу ${task.number}`}
        onChange={(event) => answers.setValue(task, event.target.value)}
      />
      {solved ? (
        <span className="verdict ok">
          <CheckIcon />
          Верно
        </span>
      ) : (
        <button className="btn btn-main" type="submit" disabled={answers.busy !== null || !value.trim()}>
          {answers.busy === task.id ? "Проверяю…" : "Проверить"}
        </button>
      )}
    </form>
  );
}

/** Строка под ответом: ошибка запроса или «Неверно, попытка N». */
export function TaskAnswerNote({ task, answers, ended }: { task: TaskRow; answers: TaskAnswers; ended: boolean }) {
  const { attempts, wrong, note } = answers.view(task);
  if (note) {
    return (
      <p className="srow-note is-error" role="alert">
        {note}
      </p>
    );
  }
  if (!ended && wrong) {
    return (
      <p className="srow-note">
        <span className="verdict bad">Неверно</span>, попытка {attempts}
      </p>
    );
  }
  return null;
}

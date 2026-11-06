"use client";

// Что получилось разобрать в строке ввода. Ничего не сохраняется, пока человек не нажмёт.

import type { ReactNode } from "react";

import { scheduleLabel, type HabitSchedule } from "./habit-schedule";
import { SchedulePicker } from "./schedule-picker";

export interface OfferAction {
  label: string;
  main?: boolean;
  disabled?: boolean;
  run: () => void;
}

export function AiOffer({ say, actions, children }: { say: string; actions: OfferAction[]; children?: ReactNode }) {
  return (
    <div className="ai-out card">
      <p className="q-say">{say}</p>
      {children}
      <div className="q-acts">
        {actions.map((action) => (
          <button
            key={action.label}
            className={`btn ${action.main ? "btn-main" : "btn-text"}`}
            type="button"
            disabled={action.disabled}
            onClick={action.run}
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AiThinking() {
  return (
    <div className="ai-out card" role="status">
      <p className="q-status shine">Думаю…</p>
    </div>
  );
}

/** Предпросмотр новой привычки: как она будет называться, как часто и к какой цели поведёт. */
export function HabitOffer({
  name,
  goalId,
  goals,
  schedule,
  actions,
  onGoal,
  onSchedule,
}: {
  name: string;
  goalId: string | null;
  goals: ReadonlyArray<{ id: string; title: string }>;
  schedule: HabitSchedule;
  actions: OfferAction[];
  onGoal: (goalId: string | null) => void;
  onSchedule: (schedule: HabitSchedule) => void;
}) {
  const goal = goals.find((row) => row.id === goalId);
  return (
    <AiOffer say={`Это привычка. Добавлю карточку${goal ? " и свяжу с целью:" : ":"}`} actions={actions}>
      <ul className="q-diff">
        <li>
          <span className="nm">{name}</span>
          <span className="chg">
            {scheduleLabel(schedule).toLowerCase()}
            {goal ? (
              <>
                {" → "}
                <b>{goal.title}</b>
              </>
            ) : null}
          </span>
        </li>
      </ul>
      <div className="gr-offer-when">
        <SchedulePicker value={schedule} onChange={onSchedule} />
      </div>
      {goals.length > 0 ? (
        <div className="gs-chips gr-offer-goals" role="group" aria-label="К какой цели ведёт привычка">
          {goals.map((row) => (
            <button
              key={row.id}
              className="gs-chip"
              type="button"
              aria-pressed={row.id === goalId}
              onClick={() => onGoal(row.id === goalId ? null : row.id)}
            >
              <span>{row.title}</span>
            </button>
          ))}
        </div>
      ) : null}
    </AiOffer>
  );
}

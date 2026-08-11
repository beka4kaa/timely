// Помощник по расписанию: «разгрузи среду», «я пропустил три дня».
//
// Отдельная маленькая панель, а не ещё один универсальный чат. Она умеет ровно
// одно — менять расписание, — и всё, что показывает, ведёт к одному решению:
// применить предложенное изменение или отказаться.
//
// Ключевое отличие от обычного чата: ответ помощника почти никогда не является
// конечным результатом. Результат — это diff, и он показывается отдельно от
// текста, потому что решение ученик принимает по нему, а не по формулировке.

"use client";

import { useCallback, useRef, useState } from "react";

import {
  paperButton,
  paperCaption,
  paperCard,
  paperFocus,
  paperPrimaryButton,
  paperTile,
} from "@/components/curriculum/paper";
import {
  type ScheduleRevision,
  confirmRevision,
  rejectRevision,
} from "@/lib/studyplan-api";
import { askAssistant, type AssistantTurn } from "@/lib/studyplan-assistant";
import {
  initialAssistantState,
  stageLabel,
  type AssistantState,
  type ParsedCommitment,
} from "@/lib/studyplan-chat";
import { durationLabel } from "@/lib/studyplan-visuals";

const EXAMPLES = [
  "Разгрузи среду",
  "Я пропустил три дня, восстанови план",
  "По вторникам с 16:00 секция на два часа",
];

interface AssistantPanelProps {
  scheduleId: string;
  timeZone: string;
  onApplied: () => void;
  onCommitments: (items: ParsedCommitment[]) => Promise<void>;
}

export function AssistantPanel({
  scheduleId,
  timeZone,
  onApplied,
  onCommitments,
}: AssistantPanelProps) {
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const [draft, setDraft] = useState("");
  const [applying, setApplying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || state.status === "thinking") return;

      setDraft("");
      setTurns((current) => [...current, { role: "user", content: message }]);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const history = turns.slice(-6);
      const final = await askAssistant(
        { message, scheduleId, history, signal: controller.signal },
        setState,
      );
      if (final.answer) {
        setTurns((current) => [
          ...current,
          { role: "assistant", content: final.answer },
        ]);
      }
    },
    [scheduleId, state.status, turns],
  );

  const decide = useCallback(
    async (revision: ScheduleRevision, accept: boolean) => {
      setApplying(true);
      try {
        if (accept) await confirmRevision(revision.id);
        else await rejectRevision(revision.id);
        setState((current) => ({ ...current, revision: null }));
        if (accept) onApplied();
      } catch (error) {
        setState((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof Error ? error.message : "Применить не получилось.",
        }));
      } finally {
        setApplying(false);
      }
    },
    [onApplied],
  );

  const acceptCommitments = useCallback(
    async (items: ParsedCommitment[]) => {
      setApplying(true);
      try {
        await onCommitments(items);
        setState((current) => ({ ...current, commitments: null }));
      } catch (error) {
        setState((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof Error ? error.message : "Записать не получилось.",
        }));
      } finally {
        setApplying(false);
      }
    },
    [onCommitments],
  );

  const thinking = state.status === "thinking";

  return (
    <div className={`${paperCard} flex flex-col gap-3 p-4`}>
      <div>
        <div className={paperCaption}>Помощник</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-[#7b7168]">
          Скажи, что изменилось, — я предложу, как переставить занятия. Ничего
          не поменяется, пока ты не подтвердишь.
        </p>
      </div>

      {turns.length === 0 && !thinking ? (
        <ul className="space-y-1.5">
          {EXAMPLES.map((example) => (
            <li key={example}>
              <button
                type="button"
                onClick={() => void send(example)}
                className={`${paperTile} ${paperFocus} w-full px-3 py-2 text-left text-[12.5px] text-[#5f584f] transition-colors hover:bg-[#fff8ec]`}
              >
                {example}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {turns.length > 0 ? (
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {turns.map((turn, index) => (
            <li
              key={`${turn.role}-${index}`}
              className={
                turn.role === "user"
                  ? "ml-6 rounded-[12px] bg-[#f2ece2] px-3 py-2 text-[13px] text-[#3d382f]"
                  : "mr-2 text-[13px] leading-relaxed text-[#4a443d]"
              }
            >
              {turn.content}
            </li>
          ))}
        </ul>
      ) : null}

      {thinking ? (
        <div className="space-y-1">
          {state.stages.map((tool, index) => (
            <div
              key={`${tool}-${index}`}
              className="flex items-center gap-2 text-[12px] text-[#7b7168]"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-[#c9a16c]" />
              {stageLabel(tool)}…
            </div>
          ))}
          {state.stages.length === 0 ? (
            <div className="text-[12px] text-[#7b7168]">Думаю…</div>
          ) : null}
        </div>
      ) : null}

      {state.revision ? (
        <RevisionCard
          revision={state.revision}
          timeZone={timeZone}
          busy={applying}
          onDecide={decide}
        />
      ) : null}

      {state.commitments && state.commitments.length > 0 ? (
        <CommitmentsCard
          items={state.commitments}
          busy={applying}
          onAccept={acceptCommitments}
          onDismiss={() =>
            setState((current) => ({ ...current, commitments: null }))
          }
        />
      ) : null}

      {state.status === "error" && state.error ? (
        <p className="text-[12.5px] text-[#a2543a]">{state.error}</p>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        className="flex items-center gap-2"
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Что изменилось?"
          disabled={thinking}
          className={`min-w-0 flex-1 rounded-full border border-[#d8d1c7] bg-[#fffdfa] px-3.5 py-2 text-[13px] text-[#312c27] placeholder:text-[#a89f93] disabled:opacity-60 ${paperFocus}`}
        />
        <button
          type="submit"
          className={paperPrimaryButton}
          disabled={thinking || draft.trim().length === 0}
        >
          Спросить
        </button>
      </form>
    </div>
  );
}

function RevisionCard({
  revision,
  timeZone,
  busy,
  onDecide,
}: {
  revision: ScheduleRevision;
  timeZone: string;
  busy: boolean;
  onDecide: (revision: ScheduleRevision, accept: boolean) => void;
}) {
  const moved = revision.diff?.moved ?? [];
  const shortened = revision.diff?.shortened ?? [];
  const format = (iso: string) =>
    new Intl.DateTimeFormat("ru-RU", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));

  return (
    <div className={`${paperTile} px-3 py-2.5`}>
      <div className={paperCaption}>Что изменится</div>

      {moved.length === 0 && shortened.length === 0 ? (
        <p className="mt-1 text-[12.5px] text-[#7b7168]">
          Помощник ничего не переносит.
        </p>
      ) : (
        <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-[#4a443d]">
          {moved.slice(0, 6).map((entry) => (
            <li key={`m-${entry.block_id}`}>
              <span className="font-medium">{entry.title}</span>
              <br />
              <span className="tabular-nums text-[#7b7168]">
                {format(entry.from.start_at)} → {format(entry.to.start_at)}
              </span>
            </li>
          ))}
          {moved.length > 6 ? (
            <li className="text-[#7b7168]">…и ещё {moved.length - 6}</li>
          ) : null}
          {shortened.map((entry) => (
            <li key={`s-${entry.block_id}`} className="text-[#7b7168]">
              {entry.title}: {durationLabel(entry.from.duration_minutes)} →{" "}
              {durationLabel(entry.to.duration_minutes)}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          className={paperPrimaryButton}
          disabled={busy}
          onClick={() => onDecide(revision, true)}
        >
          Применить
        </button>
        <button
          type="button"
          className={paperButton}
          disabled={busy}
          onClick={() => onDecide(revision, false)}
        >
          Не надо
        </button>
      </div>
    </div>
  );
}

function CommitmentsCard({
  items,
  busy,
  onAccept,
  onDismiss,
}: {
  items: ParsedCommitment[];
  busy: boolean;
  onAccept: (items: ParsedCommitment[]) => void;
  onDismiss: () => void;
}) {
  return (
    <div className={`${paperTile} px-3 py-2.5`}>
      <div className={paperCaption}>Записать как занятое время</div>
      <ul className="mt-1.5 space-y-1 text-[12.5px] leading-snug text-[#4a443d]">
        {items.map((item, index) => (
          <li key={`${item.title}-${index}`}>
            <span className="font-medium">{item.title}</span>{" "}
            <span className="text-[#7b7168]">
              {item.weekday_name
                ? `— ${item.weekday_name}, ${item.start_time}, ${durationLabel(
                    item.duration_minutes ?? 0,
                  )}`
                : "— разово"}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-[11.5px] leading-snug text-[#7b7168]">
        Планировщик перестанет ставить занятия в это время.
      </p>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          className={paperPrimaryButton}
          disabled={busy}
          onClick={() => onAccept(items)}
        >
          Записать
        </button>
        <button type="button" className={paperButton} disabled={busy} onClick={onDismiss}>
          Не надо
        </button>
      </div>
    </div>
  );
}

"use client";

// Панель справа в режиме помощника по расписанию.
//
// Раньше это была отдельная карточка в правой колонке «Плана», и на странице
// одновременно жили два разговора: помощник по календарю и чат по книге. Один
// угол экрана на двоих — ученику приходилось выбирать глазами, куда писать.
// Теперь разговор один, а панель на «Плане» умеет менять расписание.
//
// Скиллы менять расписание живут на бэкенде и сюда не переезжали: `askAssistant`
// бьёт в `/api/studyplan/chat/stream/`, там семь инструментов
// (`studyplan/tools.py`) и цикл «предложил → подтвердил → откатил». Правило
// оттуда же: помощник НЕ меняет календарь сам, он предлагает — применяет ученик.

import { useCallback, useEffect, useRef, useState } from "react";

import { Composer } from "@/components/chat/composer";
import { paperCaption, paperTile } from "@/components/curriculum/paper";
import { CommitmentsCard, RevisionCard } from "@/components/studyplan/revision-cards";
import { useActiveSchedule } from "@/contexts/active-schedule";
import {
  confirmRevision,
  rejectRevision,
  type ScheduleRevision,
} from "@/lib/studyplan-api";
import { askAssistant, type AssistantTurn } from "@/lib/studyplan-assistant";
import {
  initialAssistantState,
  stageLabel,
  type AssistantState,
  type ParsedCommitment,
} from "@/lib/studyplan-chat";
import { RailShell, railPillClass } from "./rail-shell";

const EXAMPLES = [
  "Разгрузи среду",
  "Я пропустил три дня, восстанови план",
  "По вторникам с 16:00 секция на два часа",
];

/** Сколько последних реплик уходит в контекст. Столько же было у панели. */
const HISTORY_LIMIT = 6;

export function ScheduleRail() {
  const { scheduleId, timeZone, notifyApplied, saveCommitments } =
    useActiveSchedule();
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const [applying, setApplying] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const thinking = state.status === "thinking";
  // `null` — расписаний несколько, а занятие не выбрано: непонятно, чью
  // программу двигать. Пустая строка — расписаний нет вовсе, и это НЕ помеха:
  // бэкенд возьмёт последнее неархивное сам.
  const ready = scheduleId !== null;

  // Сменилось расписание — разговор начинается заново: реплики про среду в
  // одной программе ничего не значат для другой.
  useEffect(() => {
    abortRef.current?.abort();
    setTurns([]);
    setState(initialAssistantState);
  }, [scheduleId]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [turns, state.stages, state.revision, state.commitments]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || thinking || !ready) return;

      setTurns((current) => [...current, { role: "user", content: message }]);

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const history = turns.slice(-HISTORY_LIMIT);
      const final = await askAssistant(
        { message, scheduleId: scheduleId ?? "", history, signal: controller.signal },
        setState,
      );
      if (final.answer) {
        setTurns((current) => [
          ...current,
          { role: "assistant", content: final.answer },
        ]);
      }
      // Постановка программы в календарь — единственный инструмент, который
      // пишет в расписание сразу, а не отдаёт ревизию с кнопкой «Применить».
      // Без этой перерисовки ученик услышал бы «готово», глядя на пустую
      // неделю.
      if (final.stages.includes("add_course_to_schedule")) notifyApplied();
    },
    [notifyApplied, ready, scheduleId, thinking, turns],
  );

  const decide = useCallback(
    async (revision: ScheduleRevision, accept: boolean) => {
      setApplying(true);
      try {
        if (accept) await confirmRevision(revision.id);
        else await rejectRevision(revision.id);
        setState((current) => ({ ...current, revision: null }));
        if (accept) notifyApplied();
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
    [notifyApplied],
  );

  const acceptCommitments = useCallback(
    async (items: ParsedCommitment[]) => {
      setApplying(true);
      try {
        await saveCommitments(items);
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
    [saveCommitments],
  );

  const clear = useCallback(() => {
    abortRef.current?.abort();
    setTurns([]);
    setState(initialAssistantState);
  }, []);

  return (
    <RailShell
      edgeLabel="Помощник по расписанию"
      newLabel="Начать заново"
      onNew={turns.length ? clear : undefined}
      feedRef={feedRef}
      title={
        <span className={railPillClass}>
          <span className="truncate">Расписание</span>
        </span>
      }
      footer={
        ready ? (
          <Composer
            onSubmit={(text) => void send(text)}
            busy={thinking}
            placeholder="Что изменилось?"
            // Подсказки только в пустом разговоре: дальше ученик пишет своё, а
            // три кнопки над полем занимали бы место у ленты.
            suggestions={turns.length === 0 ? EXAMPLES : undefined}
          />
        ) : null
      }
    >
      {turns.length === 0 && !thinking ? <EmptyState ready={ready} /> : null}

      {turns.map((turn, index) => (
        <div
          key={`${turn.role}-${index}`}
          className={
            turn.role === "user"
              ? "ml-6 rounded-[12px] bg-[#f2ece2] px-3 py-2 text-[13px] text-[#3d382f]"
              : "mr-2 text-[13px] leading-relaxed text-[#4a443d]"
          }
        >
          {turn.content}
        </div>
      ))}

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
        state.errorCode === "assistant_not_configured" ? (
          // Модель не задана в окружении бэкенда. Приложение не сломалось, и
          // ученик ничего не сделал не так, — красная строка тут врала бы про
          // серьёзность. Поле ввода остаётся на месте: как только переменную
          // добавят, повторить вопрос можно тем же движением.
          <div className={`${paperTile} px-3 py-2.5`}>
            <div className={paperCaption}>Помощник выключен</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-[#7b7168]">
              Модель для помощника по расписанию не подключена, поэтому менять
              занятия он сейчас не может. Календарь и перетаскивание работают
              как обычно.
            </p>
          </div>
        ) : (
          <p className="px-1 text-[12.5px] text-[#a2543a]">{state.error}</p>
        )
      ) : null}
    </RailShell>
  );
}

function EmptyState({ ready }: { ready: boolean }) {
  if (!ready) {
    return (
      <p className="px-1 text-[13px] leading-[1.55] text-[#8f887f]">
        Выбери учебное занятие в календаре, чтобы помощник понял, расписание
        какой программы менять.
      </p>
    );
  }
  return (
    <p className="px-1 text-[13px] leading-[1.55] text-[#8f887f]">
      Скажи, что изменилось, — я предложу, как переставить занятия. Ничего не
      поменяется, пока ты не подтвердишь.
    </p>
  );
}

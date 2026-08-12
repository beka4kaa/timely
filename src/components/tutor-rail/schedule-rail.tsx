"use client";

// Панель справа в режиме помощника по расписанию.
//
// Раньше это была отдельная карточка в правой колонке «Плана», и на странице
// одновременно жили два разговора: помощник по календарю и чат по книге. Один
// угол экрана на двоих — ученику приходилось выбирать глазами, куда писать.
// Теперь разговор один, а панель на «Плане» умеет менять расписание.
//
// Скиллы расписания выполняются на бэкенде: обычный разговор получает только
// чтение, а явный /plan — инструменты предложений. /start вообще не идёт в
// модель: это подписанный детерминированный мастер первого расписания.

import { useCallback, useEffect, useRef, useState } from "react";

import { MarkdownMessage } from "@/components/chat/markdown-message";
import { paperCaption, paperTile } from "@/components/curriculum/paper";
import { CommitmentsCard, RevisionCard } from "@/components/studyplan/revision-cards";
import {
  CommandWord,
  ScheduleComposer,
} from "@/components/studyplan/schedule-composer";
import { ScheduleSetup } from "@/components/studyplan/schedule-setup";
import { useActiveSchedule } from "@/contexts/active-schedule";
import {
  confirmRevision,
  rejectRevision,
  type ScheduleRevision,
} from "@/lib/studyplan-api";
import {
  askAssistant,
  type AssistantTurn,
  type ScheduleChatMode,
} from "@/lib/studyplan-assistant";
import { zonedDateKey } from "@/lib/studyplan-calendar";
import {
  failAssistantRequest,
  initialAssistantState,
  stageLabel,
  type AssistantState,
  type ParsedCommitment,
} from "@/lib/studyplan-chat";
import "katex/dist/katex.min.css";
import { RailShell, railPillClass } from "./rail-shell";

/** Сколько последних реплик уходит в контекст. Столько же было у панели. */
const HISTORY_LIMIT = 6;

interface RailTurn extends AssistantTurn {
  /** Команда — метаданные интерфейса, а не часть model prompt. */
  command?: "/plan";
}

export function ScheduleRail() {
  const { scheduleId, canStartSetup, timeZone, notifyApplied, saveCommitments } =
    useActiveSchedule();
  const [turns, setTurns] = useState<RailTurn[]>([]);
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const [applying, setApplying] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [composerResetKey, setComposerResetKey] = useState(0);
  const [armPlanKey, setArmPlanKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  /** Намеренная смена контекста не должна рисовать ошибку старого запроса. */
  const invalidateRequest = useCallback(() => {
    const active = abortRef.current;
    abortRef.current = null;
    active?.abort();
  }, []);

  const thinking = state.status === "thinking";
  // `null` — расписаний несколько, а занятие не выбрано: непонятно, чью
  // программу двигать. Пустая строка — расписаний нет вовсе, и это НЕ помеха:
  // бэкенд возьмёт последнее неархивное сам.
  const ready = scheduleId !== null;
  const hasSchedule = Boolean(scheduleId);

  // Сменилось расписание — разговор начинается заново: реплики про среду в
  // одной программе ничего не значат для другой.
  useEffect(() => {
    invalidateRequest();
    setTurns([]);
    setState(initialAssistantState);
    setSetupOpen(false);
    setComposerResetKey((current) => current + 1);
  }, [invalidateRequest, scheduleId]);

  useEffect(() => () => invalidateRequest(), [invalidateRequest]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [setupOpen, turns, state.stages, state.revision, state.commitments]);

  const send = useCallback(
    async (text: string, mode: ScheduleChatMode) => {
      const message = text.trim();
      if (!message || thinking || !ready) return;

      setTurns((current) => [
        ...current,
        {
          role: "user",
          content: message,
          ...(mode === "plan" ? { command: "/plan" as const } : {}),
        },
      ]);

      invalidateRequest();
      const controller = new AbortController();
      abortRef.current = controller;

      const history = turns.slice(-HISTORY_LIMIT);
      try {
        const final = await askAssistant(
          {
            message,
            scheduleId: scheduleId ?? "",
            history,
            mode,
            signal: controller.signal,
          },
          (next) => {
            if (abortRef.current === controller) setState(next);
          },
        );
        if (abortRef.current !== controller) return;
        if (final.answer) {
          setTurns((current) => [
            ...current,
            { role: "assistant", content: final.answer },
          ]);
        }
        // Новая программа появляется предложением отдельного расписания.
        if (final.stages.includes("add_course_to_schedule")) notifyApplied();
      } catch (error) {
        if (abortRef.current !== controller) return;
        setState((current) => failAssistantRequest(current, error));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [invalidateRequest, notifyApplied, ready, scheduleId, thinking, turns],
  );

  const startSetup = useCallback(() => {
    if (!ready || !canStartSetup || thinking) return;
    invalidateRequest();
    setTurns([]);
    setState(initialAssistantState);
    setSetupOpen(true);
  }, [canStartSetup, invalidateRequest, ready, thinking]);

  const setupCreated = useCallback(() => {
    setSetupOpen(false);
    setTurns([
      {
        role: "assistant",
        content:
          "Черновик готов. Проверь занятия в календаре и подтверди расписание.",
      },
    ]);
    notifyApplied();
  }, [notifyApplied]);

  const setupAlreadyExists = useCallback(() => {
    setSetupOpen(false);
    setTurns([
      {
        role: "assistant",
        content:
          "Расписание уже появилось. Для следующих изменений используй /plan.",
      },
    ]);
    notifyApplied();
  }, [notifyApplied]);

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
    invalidateRequest();
    setTurns([]);
    setState(initialAssistantState);
    setSetupOpen(false);
    setComposerResetKey((current) => current + 1);
  }, [invalidateRequest]);

  return (
    <RailShell
      edgeLabel="Помощник по расписанию"
      newLabel="Начать заново"
      onNew={turns.length || setupOpen ? clear : undefined}
      feedRef={feedRef}
      title={
        <span className={railPillClass}>
          <span className="truncate">Расписание</span>
        </span>
      }
      footer={
        ready && !setupOpen ? (
          <ScheduleComposer
            hasSchedule={hasSchedule}
            canStart={canStartSetup}
            onSubmit={(text, mode) => void send(text, mode)}
            onStart={startSetup}
            busy={thinking}
            onStop={() => abortRef.current?.abort()}
            resetKey={composerResetKey}
            armPlanKey={armPlanKey}
            showSuggestions={turns.length === 0}
          />
        ) : null
      }
    >
      {turns.length === 0 && !thinking && !setupOpen ? (
        <EmptyState
          ready={ready}
          hasSchedule={hasSchedule}
          canStart={canStartSetup}
          onStart={startSetup}
          onPlan={() => setArmPlanKey((current) => current + 1)}
        />
      ) : null}

      {setupOpen ? (
        <div className="space-y-2">
          <div className="px-1 text-[11px] text-[#7787a8]">
            Запущен навык <CommandWord>/start</CommandWord>
          </div>
          <ScheduleSetup
            timeZone={timeZone}
            startDate={zonedDateKey(new Date(), timeZone)}
            onCreated={setupCreated}
            onScheduleExists={setupAlreadyExists}
            onCancel={() => setSetupOpen(false)}
          />
        </div>
      ) : null}

      {turns.map((turn, index) =>
        turn.role === "user" ? (
          <div
            key={`user-${index}`}
            className="ml-6 whitespace-pre-wrap rounded-[12px] bg-[#f2ece2] px-3 py-2 text-[13px] text-[#3d382f]"
          >
            {turn.command ? (
              <span className="mr-1.5 inline-flex rounded-full border border-[#b8caf5] bg-[#edf3ff] px-1.5 py-px align-baseline font-mono text-[10.5px] font-semibold text-[#2563eb]">
                {turn.command}
              </span>
            ) : null}
            {turn.content}
          </div>
        ) : (
          // Ответ помощника — markdown, как и в чате по книге. Раньше он шёл
          // сырым текстом, и ученик читал звёздочки списков и обратные
          // кавычки вокруг имён инструментов.
          <div
            key={`assistant-${index}`}
            className="mr-2 text-[13px] leading-relaxed text-[#4a443d]"
          >
            <MarkdownMessage content={turn.content} variant="rail" />
          </div>
        ),
      )}

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

function EmptyState({
  ready,
  hasSchedule,
  canStart,
  onStart,
  onPlan,
}: {
  ready: boolean;
  hasSchedule: boolean;
  canStart: boolean;
  onStart: () => void;
  onPlan: () => void;
}) {
  if (!ready) {
    return (
      <p className="px-1 text-[13px] leading-[1.55] text-[#8f887f]">
        Выбери учебное занятие в календаре, чтобы помощник понял, расписание
        какой программы менять.
      </p>
    );
  }
  if (!hasSchedule) {
    return (
      <div className="px-1 text-[13px] leading-[1.55] text-[#8f887f]">
        <p>
          Начни с{" "}
          <SlashAction onClick={onStart}>/start</SlashAction>: я задам несколько
          вопросов и соберу первый черновик расписания.
        </p>
        <p className="mt-2 text-[11.5px] text-[#9a938a]">
          Введи <CommandWord>/</CommandWord>, чтобы увидеть доступные навыки.
        </p>
      </div>
    );
  }
  return (
    <div className="px-1 text-[13px] leading-[1.55] text-[#8f887f]">
      <p>
        Без команды я оцениваю расписание и советую, что улучшить. Для переноса
        или разгрузки выбери <SlashAction onClick={onPlan}>/plan</SlashAction>.
      </p>
      {canStart ? (
        <p className="mt-2">
          Черновик ещё не подтверждён — <SlashAction onClick={onStart}>/start</SlashAction>{" "}
          соберёт его заново.
        </p>
      ) : null}
      <p className="mt-2 text-[11.5px] text-[#9a938a]">
        Изменения всегда появятся предложением и потребуют подтверждения.
      </p>
    </div>
  );
}

function SlashAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-mono font-semibold text-[#2563eb] decoration-[#2563eb] decoration-dotted underline-offset-4 outline-none hover:underline focus-visible:underline"
    >
      {children}
    </button>
  );
}

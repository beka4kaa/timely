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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Plus } from "lucide-react";

import { MarkdownMessage } from "@/components/chat/markdown-message";
import { paperCaption, paperTile } from "@/components/curriculum/paper";
import { CommitmentsCard, RevisionCard } from "@/components/studyplan/revision-cards";
import {
  CommandWord,
  ScheduleComposer,
} from "@/components/studyplan/schedule-composer";
import { ScheduleSetup } from "@/components/studyplan/schedule-setup";
import type { ScheduleTargetOption } from "@/components/studyplan/schedule-targets";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { RailShell, railPillButtonClass } from "./rail-shell";

/** Сколько последних реплик уходит в контекст. Столько же было у панели. */
const HISTORY_LIMIT = 6;

interface RailTurn extends AssistantTurn {
  /** Команда — метаданные интерфейса, а не часть model prompt. */
  command?: "/plan";
}

export function ScheduleRail() {
  const {
    scheduleId,
    scheduleOptions,
    timeZone,
    notifyApplied,
    saveCommitments,
    selectSchedule,
  } = useActiveSchedule();
  const [turns, setTurns] = useState<RailTurn[]>([]);
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const [applying, setApplying] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [composerResetKey, setComposerResetKey] = useState(0);
  const [armPlanKey, setArmPlanKey] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const pendingTargetRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  /** Намеренная смена контекста не должна рисовать ошибку старого запроса. */
  const invalidateRequest = useCallback(() => {
    const active = abortRef.current;
    abortRef.current = null;
    active?.abort();
  }, []);

  const thinking = state.status === "thinking";
  // `null` — страница ещё не готова. Пустая строка — расписаний нет вовсе, и
  // это НЕ помеха: /start остаётся доступен.
  const ready = scheduleId !== null;
  const hasSchedule = Boolean(scheduleId);
  const selectedSchedule = useMemo(
    () => scheduleOptions.find((item) => item.id === scheduleId) ?? null,
    [scheduleId, scheduleOptions],
  );
  const selectingTarget = Boolean(pendingTargetId);

  const markPendingTarget = useCallback((next: string | null) => {
    pendingTargetRef.current = next;
    setPendingTargetId(next);
  }, []);

  useEffect(() => {
    if (!pendingTargetId) return;
    if (scheduleId === pendingTargetId) {
      markPendingTarget(null);
    }
  }, [markPendingTarget, pendingTargetId, scheduleId]);

  useEffect(() => {
    if (selectingTarget) setPickerOpen(false);
  }, [selectingTarget]);

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
      if (!message || thinking || !ready || selectingTarget) return;

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
    [
      invalidateRequest,
      notifyApplied,
      ready,
      scheduleId,
      selectingTarget,
      thinking,
      turns,
    ],
  );

  const startSetup = useCallback(() => {
    if (!ready || thinking || selectingTarget) return;
    invalidateRequest();
    setTurns([]);
    setState(initialAssistantState);
    setSetupOpen(true);
  }, [invalidateRequest, ready, selectingTarget, thinking]);

  const selectKnownSchedule = useCallback(
    (nextScheduleId: string) => {
      if (nextScheduleId === scheduleId) return;
      // Context обновляется через effect страницы. До совпадения id нельзя
      // отправлять чат в ещё старый target, даже если новый уже был загружен.
      markPendingTarget(nextScheduleId);
      selectSchedule(nextScheduleId);
    },
    [markPendingTarget, scheduleId, selectSchedule],
  );

  const setupCreated = useCallback((result: { schedule: { id: string } }) => {
    // Пока страница перечитывает созданный id, composer заблокирован и не
    // может отправить запрос в предыдущее расписание. Страница выбирает id
    // только если он действительно пришёл в свежем списке вариантов.
    const createdId = result.schedule.id;
    setPickerOpen(false);
    markPendingTarget(createdId);
    setSetupOpen(false);
    setTurns([
      {
        role: "assistant",
        content:
          "Черновик готов. Проверь занятия в календаре и подтверди расписание.",
      },
    ]);
    void notifyApplied(createdId)
      .then((available) => {
        // Пока шёл reload, пользователь мог осознанно выбрать другой target.
        // Устаревший ответ не имеет права переиграть его выбор.
        if (pendingTargetRef.current !== createdId) return;
        if (!available) {
          markPendingTarget(null);
          return;
        }
        selectSchedule(createdId);
      })
      .catch(() => {
        if (pendingTargetRef.current === createdId) markPendingTarget(null);
      });
  }, [markPendingTarget, notifyApplied, selectSchedule]);

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
        <ScheduleTargetPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          options={scheduleOptions}
          selected={selectedSchedule}
          onSelect={selectKnownSchedule}
          onStart={startSetup}
          disabled={selectingTarget || setupOpen}
          startDisabled={!ready || thinking || selectingTarget}
        />
      }
      footer={
        ready && !setupOpen ? (
          <ScheduleComposer
            hasSchedule={hasSchedule}
            onSubmit={(text, mode) => void send(text, mode)}
            onStart={startSetup}
            busy={thinking}
            disabled={selectingTarget}
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

function ScheduleTargetPicker({
  open,
  onOpenChange,
  options,
  selected,
  onSelect,
  onStart,
  disabled,
  startDisabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ScheduleTargetOption[];
  selected: ScheduleTargetOption | null;
  onSelect: (scheduleId: string) => void;
  onStart: () => void;
  disabled: boolean;
  startDisabled: boolean;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Выбрать расписание для помощника"
          aria-haspopup="menu"
          title="Выбрать расписание для /plan и чата"
          disabled={disabled}
          className={railPillButtonClass}
        >
          <span className="min-w-0 truncate">
            {selected ? `Расписание · ${selected.title}` : "Расписание"}
          </span>
          {selected ? (
            <span className="shrink-0 text-[9.5px] text-[#968e84]">
              {selected.statusLabel.toLocaleLowerCase("ru-RU")}
            </span>
          ) : null}
          <ChevronDown className="ml-auto h-2.5 w-2.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        role="menu"
        aria-label="Расписания для помощника"
        className="w-[min(19rem,calc(100vw-1.5rem))] border-[#dcd7cf] bg-[#fbfaf7] p-1.5 text-[#49423a] shadow-[0_18px_60px_rgba(62,52,41,0.14)]"
      >
        <div className="px-2 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-[#9299a8]">
          Расписания
        </div>
        <div className="max-h-72 overflow-y-auto">
          {options.map((option) => {
            const active = option.id === selected?.id;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                disabled={disabled}
                onClick={() => {
                  if (disabled) return;
                  onSelect(option.id);
                  onOpenChange(false);
                }}
                className={`flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left outline-none transition-colors hover:bg-[#f1ede6] focus-visible:bg-[#eef4ff] disabled:cursor-not-allowed disabled:opacity-45 ${
                  active ? "bg-[#f4efe7]" : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-[#3f3933]">
                    {option.title}
                  </span>
                  <span className="block truncate text-[10.5px] text-[#918980]">
                    {option.detail}
                  </span>
                </span>
                {active ? <Check className="h-3.5 w-3.5 shrink-0 text-[#8a5b24]" /> : null}
              </button>
            );
          })}
          {options.length === 0 ? (
            <p className="px-2.5 py-2 text-[11.5px] leading-relaxed text-[#918980]">
              Вариантов пока нет. Создай первый — он появится в этом списке.
            </p>
          ) : null}
        </div>
        <div className="my-1 border-t border-[#e4e0d8]" />
        <button
          type="button"
          role="menuitem"
          disabled={startDisabled}
          onClick={() => {
            onOpenChange(false);
            onStart();
          }}
          className="flex w-full items-center gap-2 rounded-[9px] px-2.5 py-2 text-left text-[12px] font-medium text-[#2563eb] outline-none transition-colors hover:bg-[#eef4ff] focus-visible:bg-[#eef4ff] disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" />
          Создать новое расписание
          <span className="ml-auto font-mono text-[10.5px]">/start</span>
        </button>
      </PopoverContent>
    </Popover>
  );
}

function EmptyState({
  ready,
  hasSchedule,
  onStart,
  onPlan,
}: {
  ready: boolean;
  hasSchedule: boolean;
  onStart: () => void;
  onPlan: () => void;
}) {
  if (!ready) {
    return (
      <p className="px-1 text-[13px] leading-[1.55] text-[#8f887f]">
        Загружаю расписания для помощника…
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
      <p className="mt-2">
        <SlashAction onClick={onStart}>/start</SlashAction> создаст ещё один
        вариант — текущий останется в списке расписаний.
      </p>
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

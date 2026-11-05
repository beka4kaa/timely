"use client";

// Мини-окно внизу в режиме помощника по расписанию.
//
// Окно спрашивает «Что поменять?», поэтому обычное сообщение идёт в режиме `plan`: он
// только готовит предложение, а применяет его сам ученик. Совет без изменений остаётся за
// `/advice`, а `/start` вообще не идёт в модель: это подписанный детерминированный мастер
// первого расписания.
//
// Любое изменение идёт через предпросмотр: сетка показывает его сразу, а настоящая запись
// случается только по «Применить», и её можно вернуть.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { MarkdownMessage } from "@/components/chat/markdown-message";
import { invalidatePlan } from "@/components/now/now-resources";
import { Icon } from "@/components/shell/icons";
import { mascot } from "@/components/shell/mascot/mascot";
import { useQuick } from "@/components/shell/quick/quick-context";
import { setPlanPreview } from "@/components/studyplan/plan-preview";
import {
  CommitmentsCard,
  RevisionCard,
  StudyWindowsCard,
} from "@/components/studyplan/revision-cards";
import { resolveScheduleSubmission } from "@/components/studyplan/schedule-commands";
import { ScheduleComposer } from "@/components/studyplan/schedule-composer";
import { ScheduleSetup } from "@/components/studyplan/schedule-setup";
import type { ScheduleTargetOption } from "@/components/studyplan/schedule-targets";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useActiveSchedule } from "@/contexts/active-schedule";
import { useAskRail } from "@/contexts/ask-rail";
import { closedByRejecting } from "@/lib/now-feed";
import {
  StudyplanApiError,
  confirmRevision,
  rejectRevision,
  undoRevision,
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
  type ProposedStudyWindows,
} from "@/lib/studyplan-chat";
import "katex/dist/katex.min.css";
import "@/styles/timely/page-plan.css";
import { RailShell } from "./rail-shell";

/** Сколько последних реплик уходит в контекст. */
const HISTORY_LIMIT = 6;

export function ScheduleRail() {
  const {
    scheduleId,
    scheduleOptions,
    timeZone,
    notifyApplied,
    saveCommitments,
    saveStudyWindows,
    selectSchedule,
  } = useActiveSchedule();
  const { open, toggle, pending, consumePrompt } = useAskRail();
  const { attached } = useQuick();
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [state, setState] = useState<AssistantState>(initialAssistantState);
  const [applying, setApplying] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [composerResetKey, setComposerResetKey] = useState(0);
  const [focusKey, setFocusKey] = useState(0);
  const [prefill, setPrefill] = useState<{ text: string; nonce: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  /** Что только что применили: пока это на экране, можно вернуть как было. */
  const [applied, setApplied] = useState<ScheduleRevision | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** «Не надо»: ответ убран с экрана, а реплики остаются контекстом следующей просьбы. */
  const [hidden, setHidden] = useState(false);
  const pendingTargetRef = useRef<string | null>(null);
  const keepConversationFor = useRef<string | null>(null);
  const keepDraftFor = useRef<string | null>(null);
  const decidedRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  /** Намеренная смена контекста не должна рисовать ошибку старого запроса. */
  const invalidateRequest = useCallback(() => {
    const active = abortRef.current;
    abortRef.current = null;
    active?.abort();
  }, []);

  const thinking = state.status === "thinking";
  // `null` — страница ещё не готова. Пустая строка — расписаний нет вовсе, и это НЕ
  // помеха: /start остаётся доступен.
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

  const resetAnswer = useCallback(() => {
    setApplied(null);
    setNote(null);
    setHidden(false);
  }, []);

  useEffect(() => {
    if (!pendingTargetId) return;
    if (scheduleId === pendingTargetId) markPendingTarget(null);
  }, [markPendingTarget, pendingTargetId, scheduleId]);

  useEffect(() => {
    if (selectingTarget) setPickerOpen(false);
  }, [selectingTarget]);

  // Сменилось расписание — разговор начинается заново: реплики про среду в одной
  // программе ничего не значат для другой. Кроме только что созданного: там уже сказано,
  // что делать с черновиком.
  useEffect(() => {
    if (keepConversationFor.current && keepConversationFor.current === scheduleId) {
      keepConversationFor.current = null;
      return;
    }
    invalidateRequest();
    setTurns([]);
    setState(initialAssistantState);
    resetAnswer();
    setSetupOpen(false);
    // Расписание сменилось из-за указанного занятия: начатая фраза как раз про него.
    if (keepDraftFor.current === scheduleId) keepDraftFor.current = null;
    else setComposerResetKey((current) => current + 1);
  }, [invalidateRequest, resetAnswer, scheduleId]);

  useEffect(() => () => invalidateRequest(), [invalidateRequest]);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight });
  }, [setupOpen, turns, state.stages, state.revision, state.commitments, applied, note]);

  const lastQuestion = useMemo(
    () => [...turns].reverse().find((turn) => turn.role === "user")?.content ?? "",
    [turns],
  );
  const lastTurn = turns[turns.length - 1];
  const lastAnswer = lastTurn?.role === "assistant" ? lastTurn.content : "";
  const stage = state.stages[state.stages.length - 1];

  // Слайм думает над запросом, даже если окно уже закрыли.
  const thinkingRef = useRef(false);
  useEffect(() => {
    if (thinking && !thinkingRef.current) {
      thinkingRef.current = true;
      mascot.thinkStart(lastQuestion || "Запрос", () => {
        thinkingRef.current = false;
        abortRef.current?.abort();
      });
    } else if (!thinking && thinkingRef.current) {
      thinkingRef.current = false;
      const proposal = state.revision || state.commitments?.length || state.studyWindows;
      mascot.thinkEnd(state.status === "error" ? undefined : proposal ? "Есть вариант" : "Готово");
    }
  }, [lastQuestion, state.commitments, state.revision, state.status, state.studyWindows, thinking]);
  useEffect(() => {
    if (thinkingRef.current && stage) mascot.thought(stageLabel(stage));
  }, [stage]);
  useEffect(
    () => () => {
      if (thinkingRef.current) mascot.thinkEnd();
      thinkingRef.current = false;
    },
    [],
  );

  // Предпросмотр на сетке живёт, пока окно открыто и предложение ждёт ответа.
  const previewDiff = open ? state.revision?.diff ?? null : null;
  useEffect(() => {
    setPlanPreview(previewDiff);
  }, [previewDiff]);
  useEffect(() => () => setPlanPreview(null), []);

  const send = useCallback(
    async (text: string, mode: ScheduleChatMode) => {
      const message = text.trim();
      if (!message || thinking || !ready || selectingTarget) return;

      resetAnswer();
      setTurns((current) => [...current, { role: "user", content: message }]);

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
            if (abortRef.current !== controller) return;
            // Ответили, пока поток дописывался: решённое предложение не возвращается.
            setState(next.revision?.id === decidedRef.current ? { ...next, revision: null } : next);
          },
        );
        if (abortRef.current !== controller) return;
        if (final.answer) {
          setTurns((current) => [...current, { role: "assistant", content: final.answer }]);
        }
        // Новая программа появляется предложением отдельного расписания.
        if (final.stages.includes("add_course_to_schedule")) notifyApplied();
        // На главной новое предложение должно ждать сразу, а не через две минуты.
        if (final.revision) invalidatePlan();
      } catch (error) {
        if (abortRef.current !== controller) return;
        setState((current) => failAssistantRequest(current, error));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [invalidateRequest, notifyApplied, ready, resetAnswer, scheduleId, selectingTarget, thinking, turns],
  );

  const startSetup = useCallback(() => {
    if (!ready || thinking || selectingTarget) return;
    invalidateRequest();
    setTurns([]);
    setState(initialAssistantState);
    resetAnswer();
    setSetupOpen(true);
  }, [invalidateRequest, ready, resetAnswer, selectingTarget, thinking]);

  const selectKnownSchedule = useCallback(
    (nextScheduleId: string) => {
      if (nextScheduleId === scheduleId) return;
      // Context обновляется через effect страницы. До совпадения id нельзя отправлять
      // запрос в ещё старый target, даже если новый уже был загружен.
      markPendingTarget(nextScheduleId);
      selectSchedule(nextScheduleId);
    },
    [markPendingTarget, scheduleId, selectSchedule],
  );

  // Просьба извне: «Перенести» и «Изменить план» на главной, кнопки на этой странице.
  // Ждём, пока страница сообщит расписание. Если просьба про конкретное расписание,
  // сначала переключаемся на него: помощник правит только то, что выбрано.
  useEffect(() => {
    if (!pending || pending.target !== "schedule") return;
    if (!ready || thinking || selectingTarget) return;
    if (pending.scheduleId && pending.scheduleId !== scheduleId) {
      if (scheduleOptions.some((option) => option.id === pending.scheduleId)) {
        selectKnownSchedule(pending.scheduleId);
      } else {
        consumePrompt(pending.id);
      }
      return;
    }
    consumePrompt(pending.id);
    if (!pending.text) return;
    if (!pending.send) {
      setPrefill({ text: pending.text, nonce: pending.id });
      return;
    }
    const request = resolveScheduleSubmission(pending.text, hasSchedule ? "plan" : "advice", hasSchedule);
    if (request.kind === "start") startSetup();
    else if (request.kind === "message") void send(request.message, request.mode);
  }, [
    consumePrompt,
    hasSchedule,
    pending,
    ready,
    scheduleId,
    scheduleOptions,
    selectKnownSchedule,
    selectingTarget,
    send,
    startSetup,
    thinking,
  ]);

  // Указанное занятие решает, какое расписание править: помощник видит только выбранное,
  // и перенос алгебры, отправленный в физику, ничего бы не перенёс.
  const attachedSchedule = attached[attached.length - 1]?.el.dataset.schedule;
  useEffect(() => {
    if (!attachedSchedule || attachedSchedule === scheduleId || selectingTarget) return;
    if (scheduleOptions.some((option) => option.id === attachedSchedule)) {
      keepDraftFor.current = attachedSchedule;
      selectKnownSchedule(attachedSchedule);
    }
  }, [attachedSchedule, scheduleId, scheduleOptions, selectKnownSchedule, selectingTarget]);

  const setupCreated = useCallback(
    (result: { schedule: { id: string }; feasible: boolean }) => {
      // Пока страница перечитывает созданный id, поле заблокировано и не может отправить
      // запрос в предыдущее расписание. Страница выбирает id только если он действительно
      // пришёл в свежем списке вариантов.
      const createdId = result.schedule.id;
      setPickerOpen(false);
      markPendingTarget(createdId);
      keepConversationFor.current = createdId;
      setSetupOpen(false);
      setTurns([
        {
          role: "assistant",
          content: result.feasible
            ? "Черновик готов. Проверь занятия в календаре и подтверди расписание."
            : "Черновик готов, но программа не помещается в свободное время. Скажи, что подвинуть, или добавь дни.",
        },
      ]);
      void notifyApplied(createdId)
        .then((available) => {
          // Пока шёл reload, ученик мог осознанно выбрать другой вариант. Устаревший
          // ответ не имеет права переиграть его выбор.
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
    },
    [markPendingTarget, notifyApplied, selectSchedule],
  );

  const setupAlreadyExists = useCallback(() => {
    setSetupOpen(false);
    setTurns([{ role: "assistant", content: "Расписание уже появилось. Что в нём поменять?" }]);
    notifyApplied();
  }, [notifyApplied]);

  const failed = useCallback((error: unknown, fallback: string) => {
    setState((current) => ({
      ...current,
      status: "error",
      error: error instanceof Error ? error.message : fallback,
      errorCode: null,
    }));
  }, []);

  const decide = useCallback(
    async (revision: ScheduleRevision, accept: boolean) => {
      setApplying(true);
      try {
        if (accept) {
          await confirmRevision(revision.id);
          decidedRef.current = revision.id;
          // Принятое двигает всё расписание вперёд, и его прежние предложения уже не применить.
          invalidatePlan((item) => item.schedule === revision.schedule);
          // Предпросмотр снимается, только когда сетка уже перечитана: иначе блок на миг
          // вернулся бы на старое место.
          await notifyApplied();
          setState((current) => ({ ...current, revision: null }));
          setApplied(revision);
          mascot.hop(1);
        } else {
          await rejectRevision(revision.id);
          decidedRef.current = revision.id;
          // Отказ закрывает само предложение и более старые.
          invalidatePlan(closedByRejecting(revision));
          setState((current) => ({ ...current, revision: null }));
          setHidden(true);
          setFocusKey((current) => current + 1);
        }
      } catch (error) {
        // Устаревшее уже не применить, а на закрытое уже ответили: живые кнопки ни к чему,
        // а календарь и главная показывают не то, что на сервере.
        const stale = error instanceof StudyplanApiError && (error.isStale || error.isClosed);
        setState((current) => ({
          ...current,
          revision: stale ? null : current.revision,
          status: "error",
          error: error instanceof Error ? error.message : "Применить не получилось.",
          errorCode: null,
        }));
        invalidatePlan(stale ? (item) => item.schedule === revision.schedule : undefined);
        if (stale) notifyApplied();
      } finally {
        setApplying(false);
      }
    },
    [notifyApplied],
  );

  const undoApplied = useCallback(async () => {
    if (!applied) return;
    setApplying(true);
    try {
      await undoRevision(applied.id);
      invalidatePlan((item) => item.schedule === applied.schedule);
      await notifyApplied();
      setApplied(null);
      setNote("План снова прежний.");
    } catch (error) {
      if (error instanceof StudyplanApiError && (error.isStale || error.isClosed)) setApplied(null);
      failed(error, "Вернуть не получилось.");
    } finally {
      setApplying(false);
    }
  }, [applied, failed, notifyApplied]);

  const acceptCommitments = useCallback(
    async (items: ParsedCommitment[]) => {
      setApplying(true);
      try {
        await saveCommitments(items);
        setState((current) => ({ ...current, commitments: null }));
        setNote("Готово, занятое время записано.");
        mascot.hop(1);
      } catch (error) {
        failed(error, "Записать не получилось.");
      } finally {
        setApplying(false);
      }
    },
    [failed, saveCommitments],
  );

  const acceptStudyWindows = useCallback(
    async (proposal: ProposedStudyWindows) => {
      setApplying(true);
      try {
        await saveStudyWindows(proposal);
        setState((current) => ({ ...current, studyWindows: null }));
        setNote("Готово, время занятий обновлено.");
        mascot.hop(1);
      } catch (error) {
        failed(error, "Записать ритм не вышло.");
      } finally {
        setApplying(false);
      }
    },
    [failed, saveStudyWindows],
  );

  const clear = useCallback(() => {
    invalidateRequest();
    setTurns([]);
    setState(initialAssistantState);
    resetAnswer();
    setSetupOpen(false);
    setComposerResetKey((current) => current + 1);
  }, [invalidateRequest, resetAnswer]);

  // Закрыли окно: готовый ответ больше не нужен. Предложение и настройка ждут, и работу
  // модели тоже не прерываем: слайм скажет, когда будет готово.
  const wasOpen = useRef(open);
  const waiting = thinking || setupOpen || Boolean(state.revision || state.commitments?.length || state.studyWindows);
  useEffect(() => {
    if (wasOpen.current && !open && !waiting) clear();
    wasOpen.current = open;
  }, [clear, open, waiting]);

  const hasAnswer = !hidden && (turns.length > 0 || Boolean(note || applied || state.error));
  const showExchange = !setupOpen && !hidden;
  // Дело сделано: остаётся только итог, а не «осталось нажать «Применить»».
  const finished = Boolean(applied || note);

  return (
    <RailShell
      mode="schedule"
      edgeLabel="Помощник по расписанию"
      newLabel="Заново"
      onNew={hasAnswer && !setupOpen ? clear : undefined}
      feedRef={feedRef}
      title={
        scheduleOptions.length > 1 && !setupOpen ? (
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
        ) : undefined
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
            focusKey={focusKey}
            initialDraft={prefill}
            showSuggestions={!hasAnswer}
          />
        ) : !ready ? (
          <p className="q-status">Загружаю расписание…</p>
        ) : null
      }
    >
      {setupOpen ? (
        <ScheduleSetup
          timeZone={timeZone}
          startDate={zonedDateKey(new Date(), timeZone)}
          onCreated={setupCreated}
          onScheduleExists={setupAlreadyExists}
          onCancel={() => setSetupOpen(false)}
        />
      ) : null}

      {showExchange && !finished && lastQuestion ? <p className="q-q">{lastQuestion}</p> : null}

      {showExchange && thinking ? (
        <p className="q-status shine">{stage ? `${stageLabel(stage)}…` : "Думаю…"}</p>
      ) : null}

      {showExchange && !finished && lastAnswer ? (
        <div className="q-say">
          <MarkdownMessage content={lastAnswer} variant="rail" />
        </div>
      ) : null}

      {showExchange && state.revision ? (
        <RevisionCard revision={state.revision} timeZone={timeZone} busy={applying} onDecide={decide} />
      ) : null}

      {showExchange && state.commitments && state.commitments.length > 0 ? (
        <CommitmentsCard
          items={state.commitments}
          busy={applying}
          onAccept={acceptCommitments}
          onDismiss={() => {
            setState((current) => ({ ...current, commitments: null }));
            setHidden(true);
            setFocusKey((current) => current + 1);
          }}
        />
      ) : null}

      {showExchange && state.studyWindows ? (
        <StudyWindowsCard
          proposal={state.studyWindows}
          busy={applying}
          onAccept={acceptStudyWindows}
          onDismiss={() => {
            setState((current) => ({ ...current, studyWindows: null }));
            setHidden(true);
            setFocusKey((current) => current + 1);
          }}
        />
      ) : null}

      {showExchange && applied ? (
        <>
          <p className="q-say">Готово, план обновлён.</p>
          <div className="q-acts">
            <button className="btn btn-text" type="button" disabled={applying} onClick={() => void undoApplied()}>
              Вернуть как было
            </button>
            <button
              className="btn btn-text"
              type="button"
              disabled={applying}
              onClick={() => {
                clear();
                toggle();
              }}
            >
              Закрыть
            </button>
          </div>
        </>
      ) : null}

      {showExchange && note ? <p className="q-say">{note}</p> : null}

      {showExchange && state.status === "error" && state.error ? (
        state.errorCode === "assistant_not_configured" ? (
          // Модель не задана в окружении бэкенда. Приложение не сломалось, и ученик ничего
          // не сделал не так: красная строка тут врала бы про серьёзность. Поле ввода на
          // месте: как только модель подключат, просьбу можно повторить тем же движением.
          <>
            <p className="q-say">Помощник сейчас не на связи.</p>
            <p className="q-status">
              Менять план через него пока нельзя. Занятия можно двигать прямо в календаре: перетащи
              их мышью или нажми на пустое место, чтобы поставить новое.
            </p>
          </>
        ) : (
          <p className="q-status" role="alert">
            {state.error}
          </p>
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
          className="q-tool ps-target"
          type="button"
          title="Какое расписание правит помощник"
          disabled={disabled}
        >
          <Icon name="plan" />
          <span>{selected?.title ?? "Расписание"}</span>
          <Icon name="chev-d" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-72 p-0">
        <div className="q-book-menu" aria-label="Какое расписание править">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={option.id === selected?.id}
              disabled={disabled}
              onClick={() => {
                onSelect(option.id);
                onOpenChange(false);
              }}
            >
              <span>{option.title}</span>
              <small>{option.statusLabel.toLocaleLowerCase("ru-RU")}</small>
            </button>
          ))}
          <button
            type="button"
            disabled={startDisabled}
            onClick={() => {
              onOpenChange(false);
              onStart();
            }}
          >
            <span>Новое расписание</span>
            <small>/start</small>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

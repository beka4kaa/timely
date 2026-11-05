// «План»: один календарь времени ученика, как в Google Календаре, и на неделю, и на день.

"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Icon } from "@/components/shell/icons";
import { mascot } from "@/components/shell/mascot/mascot";
import { useQuick } from "@/components/shell/quick/quick-context";
import { SubNav } from "@/components/shell/tab-bar";
import { usePageSchedule } from "@/contexts/active-schedule";
import { useAskRail } from "@/contexts/ask-rail";
import {
  applyStudyWindows,
  createCommitment,
  listTemplates,
  type FixedCommitment,
} from "@/lib/studyplan-api";
import {
  shiftDateKey,
  toInstant,
  zonedDateKey,
  zonedMinutes,
} from "@/lib/studyplan-calendar";
import {
  expandCommitments,
  isCommitmentEntry,
} from "@/lib/studyplan-calendar-entries";
import { durationLabel, weekLabel } from "@/lib/studyplan-visuals";

import { BlockCard, CalPopover, DraftCard } from "./block-details";
import { PlanCalendar, type PlanDraft } from "./plan-calendar";
import { usePlanDeadlines } from "./plan-deadlines";
import {
  NEW_BLOCK_MINUTES,
  applyRevisionPreview,
  clock,
  dayShort,
  fullDayLabel,
  isOwnEvent,
  monthCells,
  monthTitle,
  soonWhen,
  upcomingDeadlines,
  type Due,
} from "./plan-grid.logic";
import { usePlanPreview } from "./plan-preview";
import {
  buildScheduleTargetOptions,
  resolveScheduleTarget,
} from "./schedule-targets";
import { type CalendarEntry, useSchedule } from "./use-schedule";


type Mode = "week" | "day";
type ScheduleApi = ReturnType<typeof useSchedule>;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** На таких ширинах недели нет: колонки слишком тесные. */
const NARROW_MAIN = 760;
const EMPTY_ENTRIES: CalendarEntry[] = [];
const NO_COMMITMENTS: FixedCommitment[] = [];
const NO_IDS: ReadonlySet<string> = new Set();
const TOAST_MS = 9000;
const NOTICE_MS = 14000;
const FRESH_MS = 700;

/** «1 занятие», «2 занятия», «5 занятий». */
function blockWord(count: number): string {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return "занятий";
  const units = count % 10;
  if (units === 1) return "занятие";
  if (units >= 2 && units <= 4) return "занятия";
  return "занятий";
}

// ───────────────────────────── История действий ──────────────────────────────
//
// Шаг сам знает, как себя отменить, и возвращает обратный шаг для Ctrl+Shift+Z. Занятие
// и занятое время отменяются по-разному: занятие получает статус и живо на сервере, а
// занятость удаляется совсем и возвращается пересозданием, с новым идентификатором.

interface HistoryStep {
  run: () => Promise<HistoryStep | null>;
}

interface DeleteStep {
  blockIds: string[];
  commitments: FixedCommitment[];
}

type GetSchedule = () => ScheduleApi;

/** Выполнить удаление. Обратный шаг только если что-то действительно ушло. */
async function performDelete(get: GetSchedule, step: DeleteStep): Promise<HistoryStep | null> {
  const cancelled = step.blockIds.length ? await get().cancel(step.blockIds) : [];
  for (const item of step.commitments) await get().removeCommitment(item.id);
  if (cancelled.length === 0 && step.commitments.length === 0) return null;
  return restoreStep(get, { blockIds: cancelled, commitments: step.commitments });
}

function restoreStep(get: GetSchedule, step: DeleteStep): HistoryStep {
  return {
    run: async () => {
      if (step.blockIds.length) await get().restore(step.blockIds);
      const commitments: FixedCommitment[] = [];
      for (const item of step.commitments) {
        const created = await get().recreateCommitment(item);
        if (created) commitments.push(created);
      }
      return { run: () => performDelete(get, { blockIds: step.blockIds, commitments }) };
    },
  };
}

/** Свой блок убирается, а повтор ставит его снова, уже с новым идентификатором. */
function createdStep(get: GetSchedule, commitment: FixedCommitment): HistoryStep {
  return {
    run: async () => {
      await get().removeCommitment(commitment.id);
      return {
        run: async () => {
          const created = await get().recreateCommitment(commitment);
          return created ? createdStep(get, created) : null;
        },
      };
    },
  };
}

function eventMoveStep(
  get: GetSchedule,
  commitmentId: string,
  to: { startAt: Date; duration: number },
  back: { startAt: Date; duration: number },
): HistoryStep {
  return {
    run: async () => {
      const done = await get().moveEvent(commitmentId, to.startAt, to.duration);
      return done ? eventMoveStep(get, commitmentId, back, to) : null;
    },
  };
}

export function StudyPlanPage() {
  const schedule = useSchedule();
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;
  const getSchedule = useCallback<GetSchedule>(() => scheduleRef.current, []);

  const { prompt, openRail, open: railOpen } = useAskRail();
  const quick = useQuick();

  const [chosenMode, setChosenMode] = useState<Mode>("week");
  const [narrow, setNarrow] = useState(false);
  const mode: Mode = narrow ? "day" : chosenMode;
  // Выделение — список: рамкой можно захватить несколько занятий и убрать их одним
  // Delete. Карточка открыта у одного.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [cardId, setCardId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [assistantTargetId, setAssistantTargetId] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(NO_IDS);
  const [toast, setToast] = useState<Toast | null>(null);

  useIsoLayoutEffect(() => {
    const main = document.querySelector<HTMLElement>(".main");
    if (!main) return;
    const check = () => setNarrow(main.clientWidth > 0 && main.clientWidth <= NARROW_MAIN);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(main);
    return () => observer.disconnect();
  }, []);

  const ready = schedule.data.state === "ready" ? schedule.data : null;
  const assistantScheduleOptions = useMemo(
    () => (ready ? buildScheduleTargetOptions(ready.assistantSchedules, ready.plans) : []),
    [ready],
  );
  const assistantView = useMemo(
    () =>
      resolveScheduleTarget(
        assistantTargetId,
        assistantScheduleOptions,
        ready?.blocksBySchedule ?? {},
        ready?.schedules.map((item) => item.id) ?? [],
      ),
    [assistantScheduleOptions, assistantTargetId, ready?.blocksBySchedule, ready?.schedules],
  );
  const assistantScheduleOption = assistantView.option;
  const displayTimeZone = assistantScheduleOption?.timeZone ?? schedule.timeZone;
  const commitmentSources = ready?.commitmentSources ?? NO_COMMITMENTS;

  const baseEntries = useMemo(() => {
    if (!ready) return EMPTY_ENTRIES;
    return [
      ...assistantView.blocks,
      ...expandCommitments(ready.commitmentSources, schedule.days, displayTimeZone),
    ];
  }, [assistantView.blocks, displayTimeZone, ready, schedule.days]);

  // Предложение помощника, которое ждёт ответа: календарь ещё тот же, сетка только показывает.
  const previewDiff = usePlanPreview();
  const preview = useMemo(
    () => applyRevisionPreview(baseEntries, previewDiff),
    [baseEntries, previewDiff],
  );
  const entries = preview.entries;

  const ownSources = useMemo(
    () => new Map(commitmentSources.filter(isOwnEvent).map((item) => [item.id, item])),
    [commitmentSources],
  );
  const ownIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of baseEntries) {
      if (!isCommitmentEntry(entry)) continue;
      const source = ownSources.get(entry.commitment_id);
      // Запись через полночь развёрнута кусками: двигать кусок значило бы рвать её.
      const whole =
        source &&
        Date.parse(source.start_at ?? "") === Date.parse(entry.start_at) &&
        Date.parse(source.end_at ?? "") === Date.parse(entry.end_at);
      if (whole) ids.add(entry.id);
    }
    return ids;
  }, [baseEntries, ownSources]);

  const todayKey = zonedDateKey(new Date(), displayTimeZone);
  const activeDay =
    dayKey && schedule.days.includes(dayKey)
      ? dayKey
      : schedule.days.includes(todayKey)
        ? todayKey
        : schedule.days[0];

  const dues = usePlanDeadlines(ready ? todayKey : null, displayTimeZone, commitmentSources);
  // Экзамен уже стоит в сетке со своим временем: в строке «весь день» он был бы дважды.
  const weekDues = useMemo(
    () => dues.filter((due) => schedule.days.includes(due.dateKey) && !due.id.startsWith("exam:")),
    [dues, schedule.days],
  );
  const soon = useMemo(
    () => (ready ? upcomingDeadlines(dues, todayKey, zonedMinutes(new Date(), displayTimeZone)) : []),
    [displayTimeZone, dues, ready, todayKey],
  );

  const card = useMemo(
    () => (cardId ? entries.find((entry) => entry.id === cardId) ?? null : null),
    [cardId, entries],
  );

  // Занятие могло исчезнуть из недели: карточка без него не нужна.
  useEffect(() => {
    if (cardId && !card) setCardId(null);
  }, [card, cardId]);

  // ── Сообщения ───────────────────────────────────────────────────────────────
  const dismissNotice = schedule.dismissNotice;
  const showToast = useCallback((next: Toast) => setToast(next), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), TOAST_MS);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const notice = schedule.notice;
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismissNotice, NOTICE_MS);
    return () => window.clearTimeout(timer);
    // `dismissNotice` пересоздаётся на каждый рендер, а срок считается от сообщения.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  // ── История ─────────────────────────────────────────────────────────────────
  const undoStack = useRef<HistoryStep[]>([]);
  const redoStack = useRef<HistoryStep[]>([]);

  const remember = useCallback((step: HistoryStep) => {
    undoStack.current.push(step);
    // Новое действие обрывает ветку повтора, как в любом редакторе.
    redoStack.current = [];
  }, []);

  const undo = useCallback(async () => {
    const step = undoStack.current.pop();
    setToast(null);
    if (!step) return;
    const inverse = await step.run();
    if (inverse) redoStack.current.push(inverse);
  }, []);

  const redo = useCallback(async () => {
    const step = redoStack.current.pop();
    setToast(null);
    if (!step) return;
    const inverse = await step.run();
    if (inverse) undoStack.current.push(inverse);
  }, []);

  // ── Выделение и карточка ────────────────────────────────────────────────────
  const closeCard = useCallback(() => {
    setCardId(null);
    setSelectedIds([]);
  }, []);

  const openEntry = useCallback((entry: CalendarEntry) => {
    setDraft(null);
    setCardId(entry.id);
    setSelectedIds([entry.id]);
  }, []);

  const toggleEntry = useCallback((entry: CalendarEntry) => {
    setDraft(null);
    setCardId(null);
    setSelectedIds((current) =>
      current.includes(entry.id) ? current.filter((item) => item !== entry.id) : [...current, entry.id],
    );
  }, []);

  const dismissAll = useCallback(() => {
    setDraft(null);
    closeCard();
  }, [closeCard]);

  const selectMany = useCallback((ids: string[]) => {
    setDraft(null);
    setCardId(null);
    setSelectedIds(ids);
  }, []);

  /** Нажатие на пустое место: первое закрывает открытое, новое занятие только со свободной сетки. */
  const onSlot = useCallback(
    (dateKeyAt: string, startMinutes: number) => {
      if (cardId || selectedIds.length) {
        closeCard();
        return;
      }
      setDraft((current) => ({
        dateKey: dateKeyAt,
        startMinutes,
        durationMinutes: NEW_BLOCK_MINUTES,
        title: current?.title ?? "",
      }));
    },
    [cardId, closeCard, selectedIds.length],
  );

  const pickDay = useCallback(
    (key: string) => {
      setDayKey(key);
      // Как в Google Календаре: нажатие на день в неделе открывает этот день. На узком
      // экране день и так один, а выбор режима остаётся за широким.
      if (!narrow) setChosenMode("day");
      dismissAll();
    },
    [dismissAll, narrow],
  );

  const pickMonthDay = useCallback(
    (key: string) => {
      setDayKey(key);
      scheduleRef.current.goToDate(key);
      dismissAll();
    },
    [dismissAll],
  );

  const stepView = useCallback(
    (direction: -1 | 1) => {
      dismissAll();
      if (mode === "day") {
        const next = shiftDateKey(activeDay, direction);
        setDayKey(next);
        scheduleRef.current.goToDate(next);
        return;
      }
      setDayKey(shiftDateKey(activeDay, direction * 7));
      scheduleRef.current.goToWeek(direction);
    },
    [activeDay, dismissAll, mode],
  );

  const goToday = useCallback(() => {
    dismissAll();
    setDayKey(null);
    scheduleRef.current.goToWeek(0);
    setScrollNonce((current) => current + 1);
  }, [dismissAll]);

  // ── Изменения ───────────────────────────────────────────────────────────────
  const removeEntries = useCallback(
    async (chosen: CalendarEntry[]) => {
      const blockIds = chosen.filter((entry) => !isCommitmentEntry(entry)).map((entry) => entry.id);
      // Повторяющаяся занятость развёрнута в пять блоков одной записи: по идентификатору
      // записи их и схлопываем, иначе одно удаление ушло бы на сервер пятью запросами.
      const commitmentIds = new Set(
        chosen.flatMap((entry) => (isCommitmentEntry(entry) ? [entry.commitment_id] : [])),
      );
      const commitments = commitmentSources.filter((item) => commitmentIds.has(item.id));
      if (blockIds.length === 0 && commitments.length === 0) return;

      const done = await performDelete(getSchedule, { blockIds, commitments });
      if (!done) return;
      remember(done);
      closeCard();
      const count = blockIds.length + commitments.length;
      showToast({
        text: blockIds.length ? `Убрано: ${count} ${blockWord(count)}` : "Удалено",
        action: "Вернуть",
        onAction: () => void undo(),
      });
    },
    [closeCard, commitmentSources, getSchedule, remember, showToast, undo],
  );

  const removeSelected = useCallback(
    () => removeEntries(entries.filter((entry) => selectedIds.includes(entry.id) && !preview.ghosts.has(entry.id))),
    [entries, preview.ghosts, removeEntries, selectedIds],
  );

  const removeSelectedRef = useRef(removeSelected);
  removeSelectedRef.current = removeSelected;

  const moveEntry = useCallback(
    async (entry: CalendarEntry, dateKeyAt: string, startMinutes: number, duration: number) => {
      const startAt = toInstant(dateKeyAt, startMinutes, displayTimeZone);
      const sameStart = Date.parse(entry.start_at) === startAt.getTime();
      const text =
        sameStart && duration !== entry.duration_minutes
          ? `Теперь ${durationLabel(duration)}`
          : `Перенесено на ${dayShort(dateKeyAt)}, ${clock(startMinutes)}`;

      if (isCommitmentEntry(entry)) {
        const done = await getSchedule().moveEvent(entry.commitment_id, startAt, duration);
        if (!done) return;
        remember(
          eventMoveStep(
            getSchedule,
            entry.commitment_id,
            { startAt: new Date(entry.start_at), duration: entry.duration_minutes },
            { startAt, duration },
          ),
        );
        showToast({ text, action: "Вернуть как было", onAction: () => void undo() });
        return;
      }

      const done = await getSchedule().move(
        entry,
        startAt,
        duration !== entry.duration_minutes ? duration : undefined,
      );
      if (!done) return;
      // Отменить можно только последнее подтверждённое изменение: так решает сервер.
      remember({
        run: async () => {
          await getSchedule().undoLast();
          return null;
        },
      });
      showToast({ text, action: "Вернуть как было", onAction: () => void undo() });
    },
    [displayTimeZone, getSchedule, remember, showToast, undo],
  );

  const saveDraft = useCallback(async () => {
    if (!draft || saving) return;
    setSaving(true);
    const title = draft.title.trim() || "Новое занятие";
    const created = await getSchedule().addEvent({
      title,
      startAt: toInstant(draft.dateKey, draft.startMinutes, displayTimeZone),
      durationMinutes: draft.durationMinutes,
    });
    setSaving(false);
    // Не вышло: сообщение уже показано, а черновик с текстом остаётся на месте.
    if (!created) return;
    setDraft(null);
    setFresh(new Set([`commitment:${created.id}:${draft.dateKey}`]));
    window.setTimeout(() => setFresh(NO_IDS), FRESH_MS);
    mascot.hop(0.42, "quiet");
    remember(createdStep(getSchedule, created));
    showToast({
      text: `Поставил на ${dayShort(draft.dateKey)}, ${clock(draft.startMinutes)}`,
      action: "Убрать",
      onAction: () => void undo(),
    });
  }, [displayTimeZone, draft, getSchedule, remember, saving, showToast, undo]);

  /** Занятие программы в этот слот ставит помощник: черновик уходит ему просьбой. */
  const askAboutDraft = useCallback(() => {
    if (!draft) return;
    const name = draft.title.trim();
    prompt({
      target: "schedule",
      text: `Поставь ${name ? `«${name}»` : "занятие"}: ${fullDayLabel(draft.dateKey).toLowerCase()}, в ${clock(draft.startMinutes)}, ${draft.durationMinutes} минут`,
      send: true,
    });
    setDraft(null);
  }, [draft, prompt]);

  const moveViaAssistant = useCallback(
    (entry: CalendarEntry) => {
      const element = document.querySelector<HTMLElement>(`[data-entry="${CSS.escape(entry.id)}"]`);
      if (element) quick.attach(element);
      closeCard();
      openRail();
    },
    [closeCard, openRail, quick],
  );

  const confirmProposal = useCallback(
    async (id: string) => {
      const done = await getSchedule().confirm(id);
      if (!done) return;
      mascot.hop(1);
      showToast({ text: "Расписание подтверждено" });
    },
    [getSchedule, showToast],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Пока курсор в поле ввода, эти клавиши принадлежат тексту, а не календарю.
      if (event.target instanceof Element && event.target.closest("input, textarea, [contenteditable='true']")) return;

      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      // Ctrl+Shift+Z и Ctrl+Y — два общепринятых написания одного действия.
      if (modifier && (key === "y" || (key === "z" && event.shiftKey))) {
        event.preventDefault();
        void redo();
        return;
      }
      if (modifier && key === "z") {
        event.preventDefault();
        void undo();
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (selectedIds.length === 0) return;
      event.preventDefault();
      void removeSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, removeSelected, selectedIds.length, undo]);

  // Выделили несколько: то же, что Delete, можно сделать и без клавиатуры.
  const selectedCount = selectedIds.length;
  useEffect(() => {
    if (selectedCount < 2) return;
    showToast({
      text: `Выбрано: ${selectedCount} ${blockWord(selectedCount)}`,
      action: "Убрать из плана",
      onAction: () => void removeSelectedRef.current(),
    });
  }, [selectedCount, showToast]);

  const selectAssistantSchedule = useCallback((scheduleId: string) => {
    setAssistantTargetId(scheduleId);
    // Карточка занятия не должна молча переопределять явный выбор в окне помощника.
    setCardId(null);
    setSelectedIds([]);
  }, []);

  // В другой вкладке выбранный вариант могли подтвердить или архивировать.
  useEffect(() => {
    if (!ready || !assistantTargetId) return;
    if (assistantScheduleOptions.some((item) => item.id === assistantTargetId)) return;
    setAssistantTargetId(assistantScheduleOptions[0]?.id ?? null);
  }, [assistantScheduleOptions, assistantTargetId, ready]);

  // `""` — расписаний нет вовсе; `null` только во время загрузки.
  const assistantScheduleId = !ready ? null : assistantScheduleOption?.id ?? "";

  usePageSchedule({
    scheduleId: assistantScheduleId,
    scheduleOptions: assistantScheduleOptions,
    timeZone: displayTimeZone,
    onSelectSchedule: selectAssistantSchedule,
    onApplied: async (preferredScheduleId) => {
      const loaded = await schedule.reload();
      if (!preferredScheduleId) return loaded !== null;
      return Boolean(loaded?.some((item) => item.id === preferredScheduleId));
    },
    onCommitments: async (items) => {
      for (const item of items) {
        await createCommitment(
          {
            title: item.title,
            kind: item.kind,
            weekday: item.weekday,
            start_time: item.start_time,
            duration_minutes: item.duration_minutes,
            valid_from: item.valid_from ?? null,
            valid_until: item.valid_until ?? null,
            start_at: item.start_at,
            end_at: item.end_at,
          },
          "chat",
        );
      }
      await schedule.reload();
    },
    // Ритм — рамка, внутри которой вообще может стоять занятие. Помощник его только
    // предлагает: занятия по утрам вместо вечеров меняют жизнь ученика, а не расстановку
    // блоков, и такое решение принимает он сам.
    onStudyWindows: async (proposal) => {
      const active = ready?.schedules.find((item) => item.id === assistantScheduleId);
      if (!active?.template) throw new Error("Расписание ещё не загрузилось.");
      // Прежние окна нужны только для замены: их идентификаторы есть лишь в самом шаблоне.
      const previousSlotIds = proposal.replace
        ? (await listTemplates()).find((item) => item.id === active.template)?.slots.map((slot) => slot.id) ?? []
        : [];
      await applyStudyWindows(
        active.template,
        proposal.windows.map((window) => ({
          weekday: window.weekday,
          start_time: window.start_time,
          duration_minutes: window.duration_minutes,
        })),
        { replace: proposal.replace, previousSlotIds },
      );
      await schedule.reload();
    },
  });

  const hasSchedule = assistantScheduleOptions.length > 0;
  const startSetup = useCallback(() => {
    prompt({ target: "schedule", text: "/start", send: true });
  }, [prompt]);

  // Указанное курсором подсвечивается отсюда: класс на узле смыло бы первым же рендером.
  const attached = quick.attached;
  const pickedEntries = useMemo<ReadonlySet<string>>(
    () => new Set(attached.flatMap((row) => (row.el.dataset.entry ? [row.el.dataset.entry] : []))),
    [attached],
  );

  const selectedProposal =
    assistantView.proposalId && ready
      ? ready.assistantSchedules.find((item) => item.id === assistantView.proposalId) ?? null
      : null;
  const waitingProposal =
    !selectedProposal && ready ? ready.proposals.find((item) => item.feasible) ?? null : null;

  return (
    <div className="content view plan-view">
      <SubNav group="study" />
      <header className="head">
        <h1 className="title">План</h1>
        {ready ? (
          <div className="head-tools">
            <button className="btn btn-line" type="button" onClick={goToday}>
              Сегодня
            </button>
            <div className="pager">
              <button className="icon-btn" type="button" aria-label="Назад" onClick={() => stepView(-1)}>
                <Icon name="chev-l" />
              </button>
              <span>{mode === "day" ? fullDayLabel(activeDay) : weekLabel(schedule.days)}</span>
              <button className="icon-btn" type="button" aria-label="Вперёд" onClick={() => stepView(1)}>
                <Icon name="chev-r" />
              </button>
            </div>
            <div className="tabs plan-mode" role="group" aria-label="Масштаб">
              {(["week", "day"] as Mode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => {
                    setChosenMode(value);
                    dismissAll();
                  }}
                >
                  {value === "week" ? "Неделя" : "День"}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </header>

      {schedule.data.state === "loading" ? (
        <div className="cal card plan-skel" aria-busy="true" aria-label="Загружаю расписание" />
      ) : null}

      {schedule.data.state === "error" ? (
        <div className="card plan-error" role="alert">
          <p>{schedule.data.message}</p>
          <button className="btn btn-line" type="button" onClick={() => void schedule.reload()}>
            Попробовать снова
          </button>
        </div>
      ) : null}

      {ready ? (
        <>
          <ProposalLine
            selected={selectedProposal}
            waiting={waitingProposal}
            busy={schedule.busy}
            onConfirm={(id) => void confirmProposal(id)}
            onShow={selectAssistantSchedule}
            onAsk={() =>
              prompt({
                target: "schedule",
                text: "Программа не помещается в свободное время. Что подвинуть?",
                send: true,
              })
            }
          />

          <div className="cal-wrap" data-mode={mode}>
            <PlanCalendar
              mode={mode}
              days={schedule.days}
              entries={entries}
              timeZone={displayTimeZone}
              todayKey={todayKey}
              pickedDay={activeDay}
              selectedIds={selectedIds}
              busy={schedule.busy}
              dues={weekDues}
              ownIds={ownIds}
              leaving={preview.leaving}
              ghosts={preview.ghosts}
              resizing={preview.resizing}
              fresh={fresh}
              pickedEntries={pickedEntries}
              draft={draft}
              scrollNonce={scrollNonce}
              onPickDay={pickDay}
              onOpen={openEntry}
              onToggle={toggleEntry}
              onSelectMany={selectMany}
              onSlot={onSlot}
              onDismiss={dismissAll}
              onMove={moveEntry}
            >
              {!hasSchedule && !railOpen ? (
                <div className="plan-empty">
                  <h2>Расписания пока нет</h2>
                  <p>Ответь на пару вопросов, и появится черновик недели. В календарь он попадёт, только когда ты его подтвердишь.</p>
                  <button className="btn btn-main" type="button" onClick={startSetup}>
                    Настроить расписание
                  </button>
                </div>
              ) : null}
            </PlanCalendar>

            <aside className="cal-side" aria-label="Месяц и ближайшие сроки">
              <MiniMonth
                pickedDay={activeDay}
                days={schedule.days}
                todayKey={todayKey}
                onPick={pickMonthDay}
              />
              <SoonCard items={soon} todayKey={todayKey} />
            </aside>
          </div>

          {card ? (
            <CalPopover
              anchor={`[data-entry="${CSS.escape(card.id)}"]`}
              label={card.title}
              layoutKey={`${card.start_at}:${mode}`}
              onClose={(viaKeyboard) => {
                const element = document.querySelector<HTMLElement>(`[data-entry="${CSS.escape(card.id)}"]`);
                closeCard();
                if (viaKeyboard) element?.focus({ preventScroll: true });
              }}
            >
              <BlockCard
                block={card}
                timeZone={displayTimeZone}
                busy={schedule.busy}
                own={ownIds.has(card.id)}
                recurring={
                  isCommitmentEntry(card) &&
                  commitmentSources.some((item) => item.id === card.commitment_id && item.weekday != null)
                }
                onMove={() => moveViaAssistant(card)}
                onTogglePinned={(pinned) => {
                  void schedule.setPinned([card.id], pinned).then((done) => {
                    if (done) showToast({ text: pinned ? "Закреплено: занятие стоит на месте" : "Теперь можно двигать" });
                  });
                }}
                onRemove={() => void removeEntries([card])}
              />
            </CalPopover>
          ) : null}

          {draft ? (
            <CalPopover
              anchor=".blk.draft"
              label="Новое занятие"
              autoFocus={false}
              layoutKey={`${draft.dateKey}:${draft.startMinutes}:${mode}`}
              onClose={() => setDraft(null)}
            >
              <DraftCard
                draft={draft}
                saving={saving}
                canAsk={hasSchedule}
                onTitle={(title) => setDraft((current) => (current ? { ...current, title } : current))}
                onSave={() => void saveDraft()}
                onAsk={askAboutDraft}
              />
            </CalPopover>
          ) : null}
        </>
      ) : null}

      <PlanToast
        notice={notice}
        toast={toast}
        atTop={railOpen}
        onDismissNotice={dismissNotice}
        onDismissToast={() => setToast(null)}
      />
    </div>
  );
}

/** Черновик расписания: подтвердить его можно только здесь, поэтому строка заметна. */
function ProposalLine({
  selected,
  waiting,
  busy,
  onConfirm,
  onShow,
  onAsk,
}: {
  selected: { id: string; feasible: boolean } | null;
  waiting: { id: string } | null;
  busy: boolean;
  onConfirm: (id: string) => void;
  onShow: (id: string) => void;
  onAsk: () => void;
}) {
  if (selected?.feasible) {
    return (
      <div className="plan-line card" role="status">
        <span>Это черновик: новое расписание показано пунктиром.</span>
        <button className="btn btn-main" type="button" disabled={busy} onClick={() => onConfirm(selected.id)}>
          Подтвердить
        </button>
      </div>
    );
  }
  if (selected) {
    return (
      <div className="plan-line card" role="status">
        <span>Программа не помещается в свободное время.</span>
        <button className="btn btn-line" type="button" disabled={busy} onClick={onAsk}>
          Спросить, что подвинуть
        </button>
      </div>
    );
  }
  if (waiting) {
    return (
      <div className="plan-line card" role="status">
        <span>Есть черновик расписания, он ждёт подтверждения.</span>
        <button className="btn btn-line" type="button" onClick={() => onShow(waiting.id)}>
          Показать
        </button>
      </div>
    );
  }
  return null;
}

function MiniMonth({
  pickedDay,
  days,
  todayKey,
  onPick,
}: {
  pickedDay: string;
  days: string[];
  todayKey: string;
  onPick: (dateKey: string) => void;
}) {
  const cells = useMemo(() => monthCells(pickedDay), [pickedDay]);
  return (
    <section className="scard card">
      <h2>{monthTitle(pickedDay)}</h2>
      <div className="mm">
        {["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map((name) => (
          <span key={name}>{name}</span>
        ))}
        {cells.map((cell) => (
          <button
            key={cell.dateKey}
            type="button"
            className={[
              "m",
              cell.out && "out",
              days.includes(cell.dateKey) && "wk",
              cell.dateKey === todayKey && "today",
              cell.dateKey === pickedDay && "on",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-label={fullDayLabel(cell.dateKey)}
            aria-current={cell.dateKey === todayKey ? "date" : undefined}
            onClick={() => onPick(cell.dateKey)}
          >
            {cell.day}
          </button>
        ))}
      </div>
    </section>
  );
}

function SoonCard({ items, todayKey }: { items: Due[]; todayKey: string }) {
  return (
    <section className="scard card">
      <h2>Скоро</h2>
      {items.length ? (
        <ul className="soon">
          {items.map((due) => (
            <li key={due.id}>
              <Link href={due.href}>
                <span>{due.title}</span>
                <small>{soonWhen(due, todayKey)}</small>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small-note">
          Близких сроков нет. Они появятся из контрольных в <Link href="/dashboard/diary">дневнике</Link> и{" "}
          <Link href="/dashboard/goals">целей</Link> с датой.
        </p>
      )}
    </section>
  );
}

interface Toast {
  text: string;
  action?: string;
  onAction?: () => void;
}

/** Плавает над страницей: сетка под ним не прыгает, как прыгала бы от строки над календарём. */
function PlanToast({
  notice,
  toast,
  atTop,
  onDismissNotice,
  onDismissToast,
}: {
  notice: string | null;
  toast: Toast | null;
  /** Внизу открыто мини-окно. */
  atTop: boolean;
  onDismissNotice: () => void;
  onDismissToast: () => void;
}) {
  if (notice) {
    return (
      <div className={`toast plan-toast${atTop ? " at-top" : ""}`} role="alert">
        <span>{notice}</span>
        <button className="btn btn-text" type="button" onClick={onDismissNotice}>
          Понятно
        </button>
      </div>
    );
  }
  if (!toast) return null;
  return (
    <div className={`toast plan-toast${atTop ? " at-top" : ""}`} role="status">
      <span>{toast.text}</span>
      {toast.action ? (
        <button className="btn btn-text" type="button" onClick={toast.onAction}>
          {toast.action}
        </button>
      ) : (
        <button className="icon-btn" type="button" aria-label="Закрыть" onClick={onDismissToast}>
          <Icon name="x" />
        </button>
      )}
    </div>
  );
}

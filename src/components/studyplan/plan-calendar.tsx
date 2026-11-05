"use client";

// Календарь «Плана»: одна сетка времени на неделю и на день, как в Google Календаре.
//
// Занятия живут в семи колонках, а день просто показывает одну из них (`.is-day`).
// Отдельной дневной страницы нет намеренно: те же часы, те же блоки, те же жесты.
//
// Перетаскивание слушает окно, а не сами блоки, и состояние жеста лежит в ref. Раньше
// `pointerup` ручки растягивания всплывал в блок и завершал жест дважды: два одинаковых
// PATCH подряд, и второй падал на устаревшей версии расписания. Здесь жест один на
// указатель: кто первым забрал его из ref, тот и завершил.
//
// Пока блок под мышью и пока сервер отвечает, он стоит там, куда его поставили: сетка
// раскладывает занятия заново, и дорожки с нагрузкой в шапке идут за ним.

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { Icon } from "@/components/shell/icons";
import { bookLabel } from "@/lib/book-label";
import {
  layoutWeek,
  shiftDateKey,
  toInstant,
  visibleRange,
  zonedDateKey,
  zonedMinutes,
} from "@/lib/studyplan-calendar";
import {
  commitmentKindLabel,
  isCommitmentEntry,
} from "@/lib/studyplan-calendar-entries";
import { durationLabel } from "@/lib/studyplan-visuals";

import {
  HOUR_PX,
  STEP_MINUTES,
  applyDragOverride,
  blockFit,
  clock,
  clockRange,
  dayShort,
  fullDayLabel,
  laneBox,
  lessonState,
  loadLabel,
  movedStart,
  resizedDuration,
  slotStart,
  type Due,
  type DragOverride,
} from "./plan-grid.logic";
import type { CalendarEntry } from "./use-schedule";


const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const DAY_MINUTES = 24 * 60;
/** На столько минут выше «сейчас» встаёт верх сетки: как в прототипе. */
const NOW_LEAD_MINUTES = 3.4 * 60;
/** Сдвиг мыши, с которого нажатие становится жестом. */
const DRAG_THRESHOLD = 5;
/** Высота ручки у нижнего края блока, та же, что `.blk::after`. */
const RESIZE_EDGE = 7;
/** Полоса у края сетки, у которой она сама прокручивается под блоком. */
const AUTOSCROLL_EDGE = 32;
const AUTOSCROLL_STEP = 9;
/** Строка «весь день» не должна отъедать сетку. */
const MAX_DUES_IN_DAY = 3;
const NO_IDS: ReadonlySet<string> = new Set();
const NO_DUES: readonly Due[] = [];

export interface PlanDraft {
  dateKey: string;
  startMinutes: number;
  durationMinutes: number;
  title: string;
}

interface DragSession {
  entry: CalendarEntry;
  kind: "move" | "resize";
  dateKey: string;
  startMinutes: number;
  durationMinutes: number;
  downX: number;
  downY: number;
  /** Сколько минут было под мышью при нажатии: блок не прыгает под курсор. */
  downMinutes: number;
  lastX: number;
  lastY: number;
  moved: boolean;
  target: { dateKey: string; startMinutes: number; durationMinutes: number };
  frame: number;
}

interface MarqueeBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function cx(...names: Array<string | false | null | undefined>): string {
  return names.filter(Boolean).join(" ");
}

export function PlanCalendar({
  mode,
  days,
  entries,
  timeZone,
  todayKey,
  pickedDay,
  selectedIds,
  busy = false,
  dues = NO_DUES,
  ownIds = NO_IDS,
  leaving = NO_IDS,
  ghosts = NO_IDS,
  resizing = NO_IDS,
  fresh = NO_IDS,
  pickedEntries = NO_IDS,
  draft = null,
  scrollNonce = 0,
  onPickDay,
  onOpen,
  onToggle,
  onSelectMany,
  onSlot,
  onDismiss,
  onMove,
  children,
}: {
  mode: "week" | "day";
  days: string[];
  entries: CalendarEntry[];
  timeZone: string;
  todayKey: string;
  pickedDay: string;
  selectedIds: string[];
  busy?: boolean;
  /** Сроки на весь день: дедлайны, контрольные. */
  dues?: readonly Due[];
  /** Свои блоки: выглядят и двигаются как занятия. */
  ownIds?: ReadonlySet<string>;
  /** Предпросмотр предложения: старое место, новое место, новая длина. */
  leaving?: ReadonlySet<string>;
  ghosts?: ReadonlySet<string>;
  resizing?: ReadonlySet<string>;
  /** Только что появившиеся: короткая анимация. */
  fresh?: ReadonlySet<string>;
  /** Указаны курсором в мини-окне. */
  pickedEntries?: ReadonlySet<string>;
  /** Новое занятие, ещё не сохранённое. */
  draft?: PlanDraft | null;
  /** Меняется, когда сетку просят вернуться к текущему времени. */
  scrollNonce?: number;
  onPickDay: (dateKey: string) => void;
  onOpen: (entry: CalendarEntry) => void;
  onToggle: (entry: CalendarEntry) => void;
  onSelectMany: (ids: string[]) => void;
  onSlot: (dateKey: string, startMinutes: number) => void;
  onDismiss: () => void;
  onMove: (
    entry: CalendarEntry,
    dateKey: string,
    startMinutes: number,
    durationMinutes: number,
  ) => Promise<unknown> | void;
  /** Поверх сетки: пустое состояние. */
  children?: ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [override, setOverride] = useState<DragOverride | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  // Часы только после монтирования: на сервере чужая зона и другое время.
  const [nowMs, setNowMs] = useState<number | null>(null);
  const session = useRef<DragSession | null>(null);
  const stopGesture = useRef<(() => void) | null>(null);
  // Клик приходит после pointerup: без отметки любой перенос открывал бы карточку.
  const suppressClick = useRef(false);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => stopGesture.current?.(), []);

  const shown = useMemo(() => applyDragOverride(entries, override), [entries, override]);
  const range = useMemo(() => visibleRange(shown, timeZone), [shown, timeZone]);
  const columns = useMemo(
    () => layoutWeek(shown, { timeZone, days, range }),
    [shown, timeZone, days, range],
  );
  const byId = useMemo(() => new Map(shown.map((entry) => [entry.id, entry])), [shown]);

  const isMovable = useCallback(
    (entry: CalendarEntry) => {
      if (ghosts.has(entry.id) || leaving.has(entry.id)) return false;
      if (isCommitmentEntry(entry)) return ownIds.has(entry.id);
      return lessonState(entry, nowMs ?? Date.now()).movable;
    },
    [ghosts, leaving, nowMs, ownIds],
  );

  // ── Прокрутка к текущему времени ────────────────────────────────────────────
  const scrollTo = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    let target: number;
    if (days.includes(todayKey)) {
      target = zonedMinutes(new Date(), timeZone) - NOW_LEAD_MINUTES;
    } else {
      const starts = shown.map((entry) => zonedMinutes(entry.start_at, timeZone));
      target = (starts.length ? Math.min(...starts) : 9 * 60) - 60;
    }
    body.scrollTop = Math.max(0, (target / 60) * HOUR_PX);
    // Только при открытии и по кнопке: при листании недель сетка остаётся, где была.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, todayKey, timeZone]);

  useEffect(() => {
    scrollTo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollNonce]);

  // Предложение помощника должно быть видно: новое место могло оказаться за краем сетки.
  const ghostKey = Array.from(ghosts).join(",");
  useEffect(() => {
    const body = bodyRef.current;
    if (!ghostKey || !body) return;
    const ghost = body.querySelector<HTMLElement>(".blk.ghost");
    if (!ghost) return;
    const box = ghost.getBoundingClientRect();
    const edge = body.getBoundingClientRect();
    if (box.top < edge.top || box.bottom > edge.bottom) {
      body.scrollTop += box.top - edge.top - HOUR_PX;
    }
  }, [ghostKey]);

  // ── Геометрия по указателю ──────────────────────────────────────────────────
  const minutesAt = useCallback((clientY: number) => {
    const hours = bodyRef.current?.querySelector<HTMLElement>(".hours");
    if (!hours) return 0;
    return ((clientY - hours.getBoundingClientRect().top) / HOUR_PX) * 60;
  }, []);

  const dayAt = useCallback((clientX: number): string | null => {
    const columnsInBody = bodyRef.current?.querySelectorAll<HTMLElement>(".wcol");
    if (!columnsInBody) return null;
    for (const column of Array.from(columnsInBody)) {
      const box = column.getBoundingClientRect();
      if (box.width && clientX >= box.left && clientX < box.right) return column.dataset.day ?? null;
    }
    return null;
  }, []);

  const applyPointer = useCallback(
    (current: DragSession) => {
      const delta = minutesAt(current.lastY) - current.downMinutes;
      let next = current.target;
      if (current.kind === "resize") {
        next = {
          ...next,
          durationMinutes: resizedDuration(current.durationMinutes, delta, current.startMinutes),
        };
      } else {
        next = {
          ...next,
          startMinutes: movedStart(current.startMinutes, delta, current.durationMinutes),
          // В режиме дня блок остаётся в своей колонке: другой на экране нет.
          dateKey: mode === "week" ? dayAt(current.lastX) ?? next.dateKey : next.dateKey,
        };
      }
      const changed =
        next.dateKey !== current.target.dateKey ||
        next.startMinutes !== current.target.startMinutes ||
        next.durationMinutes !== current.target.durationMinutes;
      current.target = next;
      if (!changed) return;
      setOverride({
        id: current.entry.id,
        startAt: toInstant(next.dateKey, next.startMinutes, timeZone).toISOString(),
        durationMinutes: next.durationMinutes,
      });
    },
    [dayAt, minutesAt, mode, timeZone],
  );

  const startDrag = useCallback(
    (event: React.PointerEvent, entry: CalendarEntry, element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      const column = element.closest<HTMLElement>(".wcol");
      const dateKey = column?.dataset.day;
      if (!dateKey) return;
      const startMinutes = zonedMinutes(entry.start_at, timeZone);
      const current: DragSession = {
        entry,
        kind: box.bottom - event.clientY < RESIZE_EDGE ? "resize" : "move",
        dateKey,
        startMinutes,
        durationMinutes: entry.duration_minutes,
        downX: event.clientX,
        downY: event.clientY,
        downMinutes: minutesAt(event.clientY),
        lastX: event.clientX,
        lastY: event.clientY,
        moved: false,
        target: { dateKey, startMinutes, durationMinutes: entry.duration_minutes },
        frame: 0,
      };
      session.current = current;

      const tick = () => {
        const body = bodyRef.current;
        if (body) {
          const edge = body.getBoundingClientRect();
          let step = 0;
          if (current.lastY < edge.top + AUTOSCROLL_EDGE) step = -AUTOSCROLL_STEP;
          else if (current.lastY > edge.bottom - AUTOSCROLL_EDGE) step = AUTOSCROLL_STEP;
          if (step) {
            body.scrollTop += step;
            applyPointer(current);
          }
        }
        current.frame = window.requestAnimationFrame(tick);
      };

      const onMoveEvent = (moveEvent: PointerEvent) => {
        current.lastX = moveEvent.clientX;
        current.lastY = moveEvent.clientY;
        if (!current.moved) {
          const travelled =
            Math.abs(moveEvent.clientX - current.downX) + Math.abs(moveEvent.clientY - current.downY);
          if (travelled < DRAG_THRESHOLD) return;
          current.moved = true;
          setDraggingId(entry.id);
          onDismiss();
          current.frame = window.requestAnimationFrame(tick);
        }
        applyPointer(current);
      };

      const stop = () => {
        window.removeEventListener("pointermove", onMoveEvent);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        window.removeEventListener("keydown", onKey, true);
        window.cancelAnimationFrame(current.frame);
        stopGesture.current = null;
      };

      // Единственное место, где жест завершается: повторно его забрать неоткуда.
      const take = (): DragSession | null => {
        const taken = session.current;
        session.current = null;
        stop();
        setDraggingId(null);
        return taken;
      };

      const onCancel = () => {
        take();
        setOverride(null);
      };

      const onKey = (keyEvent: KeyboardEvent) => {
        if (keyEvent.key !== "Escape") return;
        keyEvent.stopPropagation();
        onCancel();
      };

      const onUp = () => {
        const finished = take();
        if (!finished || !finished.moved) return;
        suppressClick.current = true;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        const { target } = finished;
        const unchanged =
          target.dateKey === finished.dateKey &&
          target.startMinutes === finished.startMinutes &&
          target.durationMinutes === finished.durationMinutes;
        if (unchanged) {
          setOverride(null);
          return;
        }
        void Promise.resolve(
          onMove(finished.entry, target.dateKey, target.startMinutes, target.durationMinutes),
        ).finally(() => setOverride(null));
      };

      window.addEventListener("pointermove", onMoveEvent);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      window.addEventListener("keydown", onKey, true);
      stopGesture.current = stop;
    },
    [applyPointer, minutesAt, onDismiss, onMove, timeZone],
  );

  // Тянем по пустому месту: выделяются все занятия, которых рамка коснулась. Дальше их
  // можно убрать одним Delete.
  const startMarquee = useCallback(
    (event: React.PointerEvent) => {
      const body = bodyRef.current;
      if (!body) return;
      const origin = body.getBoundingClientRect();
      const x0 = event.clientX - origin.left + body.scrollLeft;
      const y0 = event.clientY - origin.top + body.scrollTop;
      let box: MarqueeBox | null = null;

      const onMoveEvent = (moveEvent: PointerEvent) => {
        const x1 = moveEvent.clientX - origin.left + body.scrollLeft;
        const y1 = moveEvent.clientY - origin.top + body.scrollTop;
        if (!box && Math.abs(x1 - x0) + Math.abs(y1 - y0) < DRAG_THRESHOLD) return;
        if (!box) onDismiss();
        box = { x0, y0, x1, y1 };
        setMarquee(box);
      };
      const stop = () => {
        window.removeEventListener("pointermove", onMoveEvent);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        stopGesture.current = null;
      };
      const onCancel = () => {
        stop();
        setMarquee(null);
      };
      const onUp = () => {
        stop();
        setMarquee(null);
        if (!box) return;
        suppressClick.current = true;
        window.setTimeout(() => {
          suppressClick.current = false;
        }, 0);
        const left = Math.min(box.x0, box.x1) + origin.left - body.scrollLeft;
        const right = Math.max(box.x0, box.x1) + origin.left - body.scrollLeft;
        const top = Math.min(box.y0, box.y1) + origin.top - body.scrollTop;
        const bottom = Math.max(box.y0, box.y1) + origin.top - body.scrollTop;
        const picked: string[] = [];
        body.querySelectorAll<HTMLElement>("[data-entry]").forEach((element) => {
          const rect = element.getBoundingClientRect();
          if (!rect.width || rect.right < left || rect.left > right || rect.bottom < top || rect.top > bottom) return;
          if (element.dataset.entry) picked.push(element.dataset.entry);
        });
        onSelectMany(picked);
      };
      window.addEventListener("pointermove", onMoveEvent);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      stopGesture.current = stop;
    },
    [onDismiss, onSelectMany],
  );

  const onPointerDown = (event: React.PointerEvent) => {
    // Жесты только мышью: на телефоне палец прокручивает сетку и нажимает.
    if (event.button !== 0 || event.pointerType !== "mouse" || busy) return;
    if (document.documentElement.classList.contains("picking")) return;
    const target = event.target as HTMLElement;
    const element = target.closest<HTMLElement>("[data-entry]");
    if (element?.dataset.entry) {
      const entry = byId.get(element.dataset.entry);
      if (entry && isMovable(entry)) startDrag(event, entry, element);
      return;
    }
    if (target.closest(".draft, .ghost")) return;
    if (target.closest(".wcol")) startMarquee(event);
  };

  const onClick = (event: React.MouseEvent) => {
    if (suppressClick.current) return;
    const target = event.target as HTMLElement;
    const element = target.closest<HTMLElement>("[data-entry]");
    if (element?.dataset.entry) {
      const entry = byId.get(element.dataset.entry);
      if (!entry) return;
      if (event.shiftKey || event.metaKey || event.ctrlKey) onToggle(entry);
      else onOpen(entry);
      return;
    }
    if (target.closest(".draft, .ghost")) return;
    const column = target.closest<HTMLElement>(".wcol");
    if (!column?.dataset.day) {
      onDismiss();
      return;
    }
    onSlot(column.dataset.day, slotStart(minutesAt(event.clientY)));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    const element = (event.target as HTMLElement).closest<HTMLElement>("[data-entry]");
    if (!element?.dataset.entry) return;
    const entry = byId.get(element.dataset.entry);
    if (!entry) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (event.shiftKey || event.metaKey || event.ctrlKey) onToggle(entry);
      else onOpen(entry);
      return;
    }
    // Перенос с клавиатуры только с Alt: голые стрелки листают страницу.
    if (!event.altKey || busy || !isMovable(entry)) return;
    let dateKey = zonedDateKey(entry.start_at, timeZone);
    let minutes = zonedMinutes(entry.start_at, timeZone);
    if (event.key === "ArrowUp") minutes -= STEP_MINUTES;
    else if (event.key === "ArrowDown") minutes += STEP_MINUTES;
    else if (event.key === "ArrowLeft") dateKey = shiftDateKey(dateKey, -1);
    else if (event.key === "ArrowRight") dateKey = shiftDateKey(dateKey, 1);
    else return;
    event.preventDefault();
    minutes = Math.max(0, Math.min(minutes, DAY_MINUTES - entry.duration_minutes));
    void onMove(entry, dateKey, minutes, entry.duration_minutes);
  };

  // ── Шапка и строка сроков ───────────────────────────────────────────────────
  const dueByDay = useMemo(() => {
    const map = new Map<string, Due[]>();
    for (const due of dues) {
      const list = map.get(due.dateKey);
      if (list) list.push(due);
      else map.set(due.dateKey, [due]);
    }
    return map;
  }, [dues]);

  const noAllDay = mode === "day" && !dueByDay.get(pickedDay)?.length;
  const nowLine = nowMs === null ? null : new Date(nowMs);
  const nowDay = nowLine ? zonedDateKey(nowLine, timeZone) : null;
  const nowMinutes = nowLine ? zonedMinutes(nowLine, timeZone) : 0;

  return (
    <div
      className={cx("cal card plan-cal", noAllDay && "no-all", draggingId && "is-dragging")}
      data-mode={mode}
    >
      <div className="cal-days" role="tablist" aria-label="День недели">
        <span aria-hidden="true" />
        {columns.map((column) => {
          const studied = column.blocks.filter(
            ({ block }) => !ghosts.has(block.id) && (!isCommitmentEntry(block) || ownIds.has(block.id)),
          );
          const minutes = studied.reduce((sum, { block }) => sum + block.duration_minutes, 0);
          return (
            <button
              key={column.dateKey}
              className={cx("cd", column.dateKey === todayKey && "today")}
              type="button"
              role="tab"
              aria-selected={column.dateKey === pickedDay}
              aria-label={fullDayLabel(column.dateKey)}
              onClick={() => onPickDay(column.dateKey)}
            >
              <span>{dayShort(column.dateKey)}</span>
              <b>{Number(column.dateKey.slice(-2))}</b>
              <small>{loadLabel(minutes)}</small>
              <span className="cd-pips" aria-hidden="true">
                {studied.slice(0, 6).map(({ block }) => (
                  <i key={block.id} />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      <div className="cal-all">
        <span aria-hidden="true" />
        {columns.map((column) => (
          <div
            key={column.dateKey}
            className={cx("ca", column.dateKey === pickedDay && "is-day")}
          >
            {dueByDay.get(column.dateKey)?.slice(0, MAX_DUES_IN_DAY).map((due) => (
              <Link key={due.id} className="due" href={due.href} title={due.title}>
                {due.title}
              </Link>
            ))}
            {(dueByDay.get(column.dateKey)?.length ?? 0) > MAX_DUES_IN_DAY ? (
              <small className="due-more">ещё {(dueByDay.get(column.dateKey)?.length ?? 0) - MAX_DUES_IN_DAY}</small>
            ) : null}
          </div>
        ))}
      </div>

      <div
        ref={bodyRef}
        className="cal-body"
        tabIndex={0}
        aria-label="Занятия по часам"
        onPointerDown={onPointerDown}
        onClick={onClick}
        onKeyDown={onKeyDown}
      >
        <div className="hours" aria-hidden="true">
          {HOURS.map((hour) => (
            <span key={hour} style={{ "--s": hour } as CSSProperties}>
              {hour}:00
            </span>
          ))}
        </div>

        {columns.map((column) => (
          <div
            key={column.dateKey}
            className={cx(
              "wcol",
              column.dateKey === todayKey && "today",
              column.dateKey === pickedDay && "is-day",
            )}
            data-day={column.dateKey}
          >
            {nowDay === column.dateKey ? (
              <div
                className="nowline"
                role="img"
                aria-label={`Сейчас ${clock(nowMinutes)}`}
                style={{ top: `calc(${nowMinutes / 60} * var(--hh))` }}
              />
            ) : null}

            {column.blocks.map((positioned) => {
              const entry = positioned.block;
              const lane = laneBox(positioned.lane, positioned.lanes);
              const start = positioned.startMinutes;
              const duration = Math.max(15, Math.min(entry.duration_minutes, DAY_MINUTES - start));
              const style = {
                "--s": start / 60,
                "--d": duration,
                ...(lane ? { left: lane.left, right: "auto", width: lane.width } : {}),
              } as CSSProperties;
              const selected = selectedIds.includes(entry.id);
              const time = clockRange(start, entry.duration_minutes);

              if (isCommitmentEntry(entry) && !ownIds.has(entry.id)) {
                const kind = commitmentKindLabel(entry.commitment_kind);
                return (
                  <div
                    key={entry.id}
                    className={cx("busy", duration >= 180 && "long", selected && "is-sel")}
                    data-entry={entry.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${entry.title}, ${time}, ${kind.toLowerCase()}`}
                    title={`${entry.title} · ${time}`}
                    style={style}
                  >
                    <span>{entry.title}</span>
                  </div>
                );
              }

              const ghost = ghosts.has(entry.id);
              const own = isCommitmentEntry(entry);
              const lesson = isCommitmentEntry(entry) ? null : entry;
              const state =
                lesson && !ghost && nowMs !== null ? lessonState(lesson, nowMs) : null;
              const past =
                own && nowMs !== null
                  ? Date.parse(entry.end_at) <= nowMs
                  : Boolean(state?.past);
              const movable = !ghost && isMovable(entry);
              const fit = blockFit(duration, { lanes: positioned.lanes });
              const subject = lesson?.course_plan_title ? bookLabel(lesson.course_plan_title) : "";
              const draftSchedule =
                lesson?.schedule_status === "proposed" || lesson?.schedule_status === "draft";
              const label = [
                entry.title,
                `${dayShort(column.dateKey)} ${time}`,
                subject,
                durationLabel(entry.duration_minutes),
                entry.fixed && !own ? "закреплено" : "",
                state?.done ? "сделано" : "",
                state?.missed ? "пропущено" : "",
                draftSchedule ? "предложенное расписание" : "",
              ]
                .filter(Boolean)
                .join(", ");

              return (
                <div
                  key={entry.id}
                  className={cx(
                    "blk",
                    past && "past",
                    state?.onNow && !draftSchedule && "on-now",
                    state?.missed && "missed",
                    state?.done && "done",
                    ghost && "ghost",
                    leaving.has(entry.id) && "leaving",
                    resizing.has(entry.id) && "resizing",
                    draggingId === entry.id && "dragging",
                    fresh.has(entry.id) && "fresh",
                    fit.hasTime && "has-time",
                    fit.tiny && "tiny",
                    selected && "is-sel",
                    !movable && "is-fixed",
                    entry.fixed && !own && "is-pinned",
                    draftSchedule && "is-draft",
                    pickedEntries.has(entry.id) && "pick-on",
                  )}
                  data-entry={ghost ? undefined : entry.id}
                  data-lines={fit.lines}
                  data-attach={ghost ? undefined : `${entry.title}, ${dayShort(column.dateKey)} ${clock(start)}`}
                  data-schedule={lesson?.schedule}
                  role={ghost ? undefined : "button"}
                  tabIndex={ghost ? undefined : 0}
                  aria-hidden={ghost ? true : undefined}
                  aria-label={ghost ? undefined : label}
                  title={entry.title}
                  style={style}
                >
                  <b>{entry.title}</b>
                  <small>
                    {time}
                    {subject ? <span className="sj">, {subject}</span> : null}
                  </small>
                  {state?.done ? <Icon name="check" className="blk-check" /> : null}
                </div>
              );
            })}

            {draft?.dateKey === column.dateKey ? (
              <DraftBlock draft={draft} />
            ) : null}
          </div>
        ))}

        {marquee ? (
          <div
            className="plan-marquee"
            aria-hidden="true"
            style={{
              left: Math.min(marquee.x0, marquee.x1),
              top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0),
              height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        ) : null}
      </div>
      {children}
    </div>
  );
}

function DraftBlock({ draft }: { draft: PlanDraft }) {
  const fit = blockFit(draft.durationMinutes);
  return (
    <div
      className={cx("blk draft is-fixed", fit.hasTime && "has-time", fit.tiny && "tiny")}
      data-lines={fit.lines}
      aria-hidden="true"
      style={{ "--s": draft.startMinutes / 60, "--d": draft.durationMinutes } as CSSProperties}
    >
      <b>{draft.title.trim() || "Новое занятие"}</b>
      <small>{clockRange(draft.startMinutes, draft.durationMinutes)}</small>
    </div>
  );
}

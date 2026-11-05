"use client";

// Карточка занятия и быстрое создание: всплывают рядом с блоком, как в Google Календаре.
//
// Показывается то, что бэкенд действительно знает, а кнопки делают настоящее дело: начать
// там, где занятие проходит, перенести через помощника, закрепить, убрать из плана.

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { Icon } from "@/components/shell/icons";
import { BOARD_ENABLED } from "@/config/features";
import { bookLabel } from "@/lib/book-label";
import { criterionText, splitBlockTitle } from "@/lib/now-feed";
import { zonedDateKey, zonedMinutes } from "@/lib/studyplan-calendar";
import { commitmentKindLabel, isCommitmentEntry } from "@/lib/studyplan-calendar-entries";
import { activityLabel, blockAppearance } from "@/lib/studyplan-visuals";

import { clockRange, fullDayLabel, lessonState } from "./plan-grid.logic";
import type { PlanDraft } from "./plan-calendar";
import type { CalendarEntry } from "./use-schedule";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** На каком расстоянии от блока и от края экрана стоит карточка. */
const GAP = 8;
const EDGE = 12;

/**
 * Рядом с блоком: справа, если есть место, потом слева, потом под ним. В окно тела
 * страницы карточка не вложена: там контейнер `.main` ограничивает `position: fixed`,
 * а сверху должна лежать и над боковой панелью.
 */
export function CalPopover({
  anchor,
  label,
  onClose,
  layoutKey,
  autoFocus = true,
  children,
}: {
  /** Селектор блока, рядом с которым стоит карточка. */
  anchor: string;
  label: string;
  /** `viaKeyboard`: закрыли клавишей, фокус возвращается на блок. */
  onClose: (viaKeyboard: boolean) => void;
  /** Меняется, когда блок мог сдвинуться. */
  layoutKey?: string | number;
  autoFocus?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const pop = ref.current;
    const target = document.querySelector<HTMLElement>(anchor);
    if (!pop || !target) return;
    const box = target.getBoundingClientRect();
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    const fitsRight = box.right + GAP + width <= window.innerWidth - EDGE;
    const fitsLeft = box.left - GAP - width >= EDGE;
    let left: number;
    let top: number;
    if (fitsRight || fitsLeft) {
      left = fitsRight ? box.right + GAP : box.left - GAP - width;
      top = box.top;
    } else {
      // Широкая колонка дня или телефон: под блоком, а если там нет места, то над ним.
      left = box.left;
      top = box.bottom + GAP + height <= window.innerHeight - EDGE ? box.bottom + GAP : box.top - GAP - height;
    }
    pop.style.left = `${Math.max(EDGE, Math.min(window.innerWidth - width - EDGE, left))}px`;
    pop.style.top = `${Math.max(EDGE, Math.min(window.innerHeight - height - EDGE, top))}px`;
  }, [anchor]);

  useIsoLayoutEffect(() => {
    place();
  }, [place, layoutKey]);

  useEffect(() => {
    const body = document.querySelector(".cal-body");
    const main = document.querySelector(".main");
    body?.addEventListener("scroll", place, { passive: true });
    main?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      body?.removeEventListener("scroll", place);
      main?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [place]);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  useEffect(() => {
    // В фазе перехвата: Esc закрывает карточку, а не мини-окно под ней.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose(true);
    };
    // Нажатия по сетке разбирает сама сетка.
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (ref.current?.contains(event.target) || event.target.closest(".cal-body")) return;
      onClose(false);
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("click", onClick);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="cal-pop glass" role="dialog" aria-label={label} tabIndex={-1}>
      <button className="icon-btn pop-x" type="button" aria-label="Закрыть" onClick={() => onClose(true)}>
        <Icon name="x" />
      </button>
      {children}
    </div>,
    document.querySelector(".timely-dashboard-shell") ?? document.body,
  );
}

/** Куда ведёт главная кнопка: в ту среду, где занятие и проходит. */
function lessonAction(block: Extract<CalendarEntry, { course_plan: string }>): { label: string; href: string } {
  const plan = `/dashboard/curriculum/plan/${block.course_plan}`;
  const { topic } = splitBlockTitle(block.title);
  if (lessonState(block, Date.now()).done) return { label: "Открыть программу", href: plan };
  const running = block.status === "in_progress";
  switch (block.workspace_type) {
    case "smart_board":
      if (BOARD_ENABLED) return { label: running ? "Продолжить" : "Открыть доску", href: "/dashboard/whiteboard" };
      break;
    case "book_reader":
      return { label: running ? "Продолжить" : "Открыть книгу", href: plan };
    case "tutor_chat":
      break;
    default:
      return { label: running ? "Продолжить" : "Открыть программу", href: plan };
  }
  return {
    label: running ? "Продолжить" : "Начать",
    href: `/dashboard/chat?q=${encodeURIComponent(`Давай разберём «${topic}».`)}`,
  };
}

const REVIEW_STEPS = ["через 2 дня", "через неделю", "через три недели"];

/** Со строчной буквы, как часть фразы. «СОР написан» остаётся как есть. */
function sentencePart(text: string): string {
  const [first = "", second = ""] = Array.from(text);
  return second === second.toLowerCase() ? first.toLowerCase() + text.slice(first.length) : text;
}

export function BlockCard({
  block,
  timeZone,
  busy = false,
  own = false,
  recurring = false,
  onMove,
  onTogglePinned,
  onRemove,
}: {
  block: CalendarEntry;
  timeZone: string;
  busy?: boolean;
  /** Свой блок: двигается в сетке, помощник его не переносит. */
  own?: boolean;
  /** Повторяющаяся занятость: удаляется вся запись, а не один день. */
  recurring?: boolean;
  onMove: () => void;
  onTogglePinned: (pinned: boolean) => void;
  onRemove: () => void;
}) {
  const dateKey = zonedDateKey(block.start_at, timeZone);
  const start = zonedMinutes(block.start_at, timeZone);
  const when = clockRange(start, block.duration_minutes);

  if (isCommitmentEntry(block)) {
    return (
      <>
        <h3>{block.title}</h3>
        <p>
          {fullDayLabel(dateKey)}
          <br />
          {when}
          {own ? "" : `, ${commitmentKindLabel(block.commitment_kind).toLowerCase()}`}
        </p>
        <p>Планировщик ставит занятия вокруг этого времени.</p>
        <div className="pop-acts">
          <button className="btn btn-line" type="button" disabled={busy} onClick={onRemove}>
            {recurring ? "Удалить все повторы" : "Удалить"}
          </button>
        </div>
      </>
    );
  }

  const state = lessonState(block, Date.now());
  const look = blockAppearance(block, { accent: "" });
  const course = block.course_plan_title ? bookLabel(block.course_plan_title) : "";
  const proposal = block.schedule_status === "proposed" || block.schedule_status === "draft";
  const payload = block.lesson_payload as { completion?: unknown } | null;
  const completion =
    block.mastery_criteria || (typeof payload?.completion === "string" ? payload.completion : "");
  const action = proposal ? null : lessonAction(block);
  const details = [
    activityLabel(block.activity_type),
    look.statusLabel,
    block.review_step != null ? `повторение ${REVIEW_STEPS[block.review_step] ?? "по плану"}` : null,
    block.fixed ? "закреплено" : null,
  ]
    .filter(Boolean)
    .join(", ");
  const canRemove = !block.fixed && !state.done && block.status !== "in_progress";

  return (
    <>
      <h3>{block.title}</h3>
      <p>
        {fullDayLabel(dateKey)}
        <br />
        {when}
        {course ? `, ${course}` : ""}
      </p>
      {details ? <p>{details}</p> : null}
      {block.objective ? <p className="pop-note">{block.objective}</p> : null}
      {completion ? <p className="pop-note">Готово, когда: {sentencePart(criterionText(completion))}.</p> : null}
      {proposal ? <p>Время предварительное: станет постоянным, когда подтвердишь расписание.</p> : null}
      {block.detail_level === "outline" ? <p>Тема и дата уже есть, задания появятся ближе к занятию.</p> : null}
      <div className="pop-acts">
        {action ? (
          <Link className="btn btn-main" href={action.href}>
            {action.label}
          </Link>
        ) : null}
        {state.reschedulable ? (
          <button className="btn btn-text" type="button" onClick={onMove}>
            Перенести
          </button>
        ) : null}
        {!state.done ? (
          <button
            className="btn btn-text"
            type="button"
            role="switch"
            aria-checked={block.fixed}
            title={block.fixed ? "Сейчас стоит на месте" : "Планировщик и мышь не будут его двигать"}
            disabled={busy}
            onClick={() => onTogglePinned(!block.fixed)}
          >
            {block.fixed ? "Открепить" : "Закрепить"}
          </button>
        ) : null}
        {canRemove ? (
          <button className="btn btn-text" type="button" disabled={busy} onClick={onRemove}>
            Убрать из плана
          </button>
        ) : null}
      </div>
    </>
  );
}

/** Быстрое создание: название и «Сохранить», длину потом можно потянуть мышью. */
export function DraftCard({
  draft,
  saving,
  canAsk,
  onTitle,
  onSave,
  onAsk,
}: {
  draft: PlanDraft;
  saving: boolean;
  /** Есть расписание: помощник может поставить сюда занятие программы. */
  canAsk: boolean;
  onTitle: (title: string) => void;
  onSave: () => void;
  onAsk: () => void;
}) {
  return (
    <form
      className="pop-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <input
        type="text"
        value={draft.title}
        placeholder="Что делаем?"
        aria-label="Название занятия"
        autoComplete="off"
        autoFocus
        maxLength={200}
        onChange={(event) => onTitle(event.target.value)}
      />
      <p>
        {fullDayLabel(draft.dateKey)}
        <br />
        {clockRange(draft.startMinutes, draft.durationMinutes)}
      </p>
      <div className="pop-acts">
        <button className="btn btn-main" type="submit" disabled={saving}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
        {canAsk ? (
          <button className="btn btn-text" type="button" disabled={saving} onClick={onAsk}>
            Через помощника
          </button>
        ) : null}
      </div>
    </form>
  );
}

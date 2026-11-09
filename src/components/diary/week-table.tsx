"use client";

// Таблица недели шаблона: дни колонками, уроки строками по порядку. Урок перетаскивают на другой,
// и они меняются местами; на «+ урок» другого дня, и он переезжает в конец того дня.

import { useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";

import { Icon } from "@/components/shell/icons";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { DAY_OF_WEEK_LABELS, DAY_SHORT_LABELS, DAYS_ORDER, type DayOfWeek } from "@/types/diary";

import type { TemplateSubject } from "./lesson-editor";
import { dayRange, shortClock, type SlotDraft, type SlotRef, type WeekDays } from "./week-template";

interface WeekTableProps {
  week: WeekDays;
  days: DayOfWeek[];
  subjects: Map<string, TemplateSubject>;
  blockLabel: (slot: SlotDraft) => string;
  selected: SlotRef | null;
  swapFrom: SlotRef | null;
  missing: Set<string>;
  /** Окно правки у клетки. На телефоне его нет: там правка снизу. */
  editor: ReactNode;
  onOpen: (ref: SlotRef) => void;
  onClose: () => void;
  onAdd: (day: DayOfWeek) => void;
  onSwap: (first: SlotRef, second: SlotRef) => void;
  onMove: (from: SlotRef, day: DayOfWeek) => void;
  onCopyDay: (from: DayOfWeek, to: DayOfWeek[]) => void;
  onClearDay: (day: DayOfWeek) => void;
  onShowDay?: (day: DayOfWeek) => void;
  hiddenDay?: DayOfWeek | null;
}

const WEEKDAYS: DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday"];

function refOf(id: string): string {
  return `slot:${id}`;
}

export function WeekTable(props: WeekTableProps) {
  const { week, days, selected, onSwap, onMove, onClose } = props;
  const [dragging, setDragging] = useState<SlotDraft | null>(null);
  // Мышь: тащим после 6 px. Палец: после короткого удержания, иначе таблицу нельзя листать.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 280, tolerance: 8 } }),
  );
  const rows = Math.max(1, ...days.map((day) => week[day].length));

  const onDragStart = ({ active }: DragStartEvent) => {
    const from = active.data.current as SlotRef | undefined;
    if (!from) return;
    setDragging(week[from.day].find((slot) => slot.id === from.id) ?? null);
    if (selected) onClose();
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const from = active.data.current as SlotRef | undefined;
    const target = over?.data.current as ({ kind: "slot" } & SlotRef) | { kind: "day"; day: DayOfWeek } | undefined;
    if (!from || !target) return;
    if (target.kind === "slot") {
      if (target.id !== from.id) onSwap(from, { day: target.day, id: target.id });
    } else if (target.day !== from.day) {
      onMove(from, target.day);
    }
  };

  const cells: ReactNode[] = [<div key="corner" />];
  for (const day of days) cells.push(<DayHead key={`h-${day}`} day={day} {...props} />);
  if (props.hiddenDay) {
    cells.push(
      <button key="h-more" type="button" className="ds-dh-more" onClick={() => props.onShowDay?.(props.hiddenDay!)}>
        <Icon name="plus" />
        {DAY_SHORT_LABELS[props.hiddenDay]}
      </button>,
    );
  }
  for (let row = 0; row <= rows; row++) {
    cells.push(
      <div key={`n-${row}`} className="ds-num">
        {row < rows ? row + 1 : ""}
      </div>,
    );
    for (const day of days) {
      const slot = week[day][row];
      if (slot) cells.push(<SlotCell key={slot.id} slot={slot} day={day} {...props} />);
      else if (row === week[day].length) cells.push(<AddCell key={`a-${day}`} day={day} dragging={dragging} onAdd={props.onAdd} />);
      else cells.push(<div key={`e-${day}-${row}`} />);
    }
    if (props.hiddenDay) cells.push(<div key={`x-${row}`} />);
  }

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <section className="card ds-week" aria-label="Уроки недели">
        <div className="ds-scroll">
          <div
            className="ds-grid"
            style={{ gridTemplateColumns: `24px repeat(${days.length}, minmax(124px, 1fr))${props.hiddenDay ? " 52px" : ""}` }}
          >
            {cells}
          </div>
        </div>
      </section>
      <DragOverlay dropAnimation={null}>
        {dragging ? <CellBody slot={dragging} {...props} overlay /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function DayHead({ day, week, days, onCopyDay, onClearDay }: { day: DayOfWeek } & WeekTableProps) {
  const lessons = week[day];
  const others = DAYS_ORDER.filter((other) => other !== day);
  const weekdays = WEEKDAYS.filter((other) => other !== day && days.includes(other));
  return (
    <div className="ds-dh" data-day={day}>
      <div>
        <b>{DAY_SHORT_LABELS[day]}</b>
        <span>{dayRange(lessons) || "нет уроков"}</span>
      </div>
      {lessons.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="icon-btn ds-dh-menu" aria-label={`Что сделать с днём: ${DAY_OF_WEEK_LABELS[day]}`}>
              <Icon name="more" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="ds-menu">
            <DropdownMenuLabel>Скопировать уроки на</DropdownMenuLabel>
            {WEEKDAYS.includes(day) && weekdays.length > 1 ? (
              <DropdownMenuItem onSelect={() => onCopyDay(day, weekdays)}>Все остальные будни</DropdownMenuItem>
            ) : null}
            {others.map((other) => (
              <DropdownMenuItem key={other} onSelect={() => onCopyDay(day, [other])}>
                {DAY_OF_WEEK_LABELS[other]}
                {week[other].length ? <span className="ds-menu-note">заменит</span> : null}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="ds-menu-danger" onSelect={() => onClearDay(day)}>
              Очистить день
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

function SlotCell({ slot, day, ...props }: { slot: SlotDraft; day: DayOfWeek } & WeekTableProps) {
  const ref: SlotRef = { day, id: slot.id };
  const drag = useDraggable({ id: refOf(slot.id), data: ref });
  const drop = useDroppable({ id: `drop:${slot.id}`, data: { kind: "slot", ...ref } });
  const isSelected = props.selected?.id === slot.id;
  const picking = props.swapFrom;

  const body = (
    <div
      ref={(node) => {
        drag.setNodeRef(node);
        drop.setNodeRef(node);
      }}
      {...drag.listeners}
      {...drag.attributes}
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      data-day={day}
      data-n={slot.lessonNumber}
      className={[
        "ds-cell",
        isSelected ? "is-selected" : "",
        drag.isDragging ? "is-dragging" : "",
        drop.isOver && !drag.isDragging ? "is-over" : "",
        picking?.id === slot.id ? "is-picked" : "",
        picking && picking.id !== slot.id ? "is-target" : "",
        props.missing.has(slot.id) ? "is-missing" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        if (picking && picking.id !== slot.id) props.onSwap(picking, ref);
        else props.onOpen(ref);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen(ref);
        }
      }}
    >
      <CellBody slot={slot} {...props} />
    </div>
  );

  if (!isSelected || !props.editor) return <div className="ds-at">{body}</div>;
  return (
    <Popover open onOpenChange={(open) => (open ? null : props.onClose())}>
      <PopoverAnchor className="ds-at">{body}</PopoverAnchor>
      <PopoverContent side="right" align="start" sideOffset={8} collisionPadding={12} className="ds-pop">
        {props.editor}
      </PopoverContent>
    </Popover>
  );
}

function CellBody({
  slot,
  subjects,
  blockLabel,
  overlay,
}: { slot: SlotDraft; overlay?: boolean } & Pick<WeekTableProps, "subjects" | "blockLabel">) {
  const subject = slot.blockType === "lesson" ? subjects.get(slot.subjectId) : undefined;
  const name = slot.blockType === "lesson" ? subject?.name ?? "Выбери предмет" : blockLabel(slot);
  return (
    <span className={`ds-cell-in${overlay ? " is-overlay" : ""}${slot.blockType === "lesson" ? "" : " is-block"}`}>
      <span className="ds-cell-name">
        <span className={`ds-dot${slot.blockType === "lesson" ? "" : " is-block"}`} style={subject ? { background: subject.color } : undefined} />
        <span className={subject || slot.blockType !== "lesson" ? "" : "ds-cell-empty"}>{name}</span>
      </span>
      <span className="ds-cell-time">
        {shortClock(slot.startTime)}–{shortClock(slot.endTime)}
      </span>
    </span>
  );
}

function AddCell({
  day,
  dragging,
  onAdd,
}: {
  day: DayOfWeek;
  dragging: SlotDraft | null;
  onAdd: (day: DayOfWeek) => void;
}) {
  const drop = useDroppable({ id: `day:${day}`, data: { kind: "day", day } });
  const moving = Boolean(dragging && dragging.dayOfWeek !== day);
  return (
    <button
      ref={drop.setNodeRef}
      type="button"
      data-day={day}
      className={`ds-add${drop.isOver && moving ? " is-over" : ""}${moving ? " is-drop" : ""}`}
      onClick={() => onAdd(day)}
    >
      <Icon name="plus" />
      {moving ? "Перенести сюда" : "урок"}
    </button>
  );
}

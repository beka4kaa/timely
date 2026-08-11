// Недельная сетка: семь колонок, вертикальная шкала времени, перетаскивание.
//
// Механика взята у `components/dashboard/schedule-component.tsx` — абсолютное
// позиционирование поверх колонки с высотой часа в пикселях, — но на pointer-,
// а не mouse-событиях: те же обработчики тогда работают и пальцем, а спец
// требует и десктоп, и мобильный.
//
// Вся арифметика времени вынесена в `lib/studyplan-calendar.ts`. Здесь только
// то, что нельзя проверить без DOM: захват указателя, измерение колонок и
// отрисовка.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LearningBlock } from "@/lib/studyplan-api";
import {
  HOUR_HEIGHT,
  type DayColumn,
  type VisibleRange,
  currentTimeOffset,
  dropTarget,
  formatMinutes,
  hourMarks,
  minutesToOffset,
  offsetToMinutes,
  resizeTarget,
  shiftDateKey,
  snapMinutes,
  toInstant,
} from "@/lib/studyplan-calendar";
import {
  blockAppearance,
  dayLabel,
  durationLabel,
  weekdayShort,
} from "@/lib/studyplan-visuals";
import { paperCaption, paperFocus } from "@/components/curriculum/paper";

/** На сколько двигают блок стрелками с Alt. */
const KEYBOARD_STEP_MINUTES = 15;

interface DragState {
  blockId: string;
  mode: "move" | "resize";
  pointerId: number;
  /** Минуты под указателем в момент захвата — чтобы блок не прыгал под курсор. */
  grabMinutes: number;
  originStartMinutes: number;
  originDateKey: string;
  durationMinutes: number;
  previewStartMinutes: number;
  previewDateKey: string;
  previewDuration: number;
  moved: boolean;
}

export interface WeekGridProps {
  columns: DayColumn<LearningBlock>[];
  range: VisibleRange;
  timeZone: string;
  todayKey: string;
  selectedId: string | null;
  busy?: boolean;
  onSelect: (block: LearningBlock) => void;
  onMove: (blockId: string, startAt: Date, durationMinutes?: number) => void;
}

export function WeekGrid({
  columns,
  range,
  timeZone,
  todayKey,
  selectedId,
  busy = false,
  onSelect,
  onMove,
}: WeekGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Клик приходит ПОСЛЕ pointerup, когда состояние перетаскивания уже снято.
  // Без этой отметки любое перетаскивание вдобавок открывало бы карточку
  // занятия — то есть каждый перенос заканчивался бы всплывшей панелью.
  const draggedRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [now, setNow] = useState(() => new Date());

  const marks = useMemo(() => hourMarks(range), [range]);
  const bodyHeight = ((range.endMinutes - range.startMinutes) / 60) * HOUR_HEIGHT;
  const days = useMemo(() => columns.map((column) => column.dateKey), [columns]);

  // Метка «сейчас» живёт своей жизнью и не должна ждать перезагрузки данных.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const marker = useMemo(
    () => currentTimeOffset(now, { timeZone, days, range }),
    [now, timeZone, days, range],
  );

  /** Слой предпросмотра переноса: он живёт над сеткой, а не внутри колонки. */
  const preview = useMemo(() => {
    if (!drag || drag.mode !== "move") return null;
    const index = columns.findIndex(
      (column) => column.dateKey === drag.previewDateKey,
    );
    if (index < 0) return null;

    const source = columns
      .flatMap((column) => column.blocks)
      .find((item) => item.block.id === drag.blockId);
    if (!source) return null;

    const widthPercent = 100 / columns.length;
    return {
      leftPercent: index * widthPercent,
      widthPercent,
      top: minutesToOffset(drag.previewStartMinutes, range.startMinutes),
      height: (drag.durationMinutes / 60) * HOUR_HEIGHT,
      startMinutes: drag.previewStartMinutes,
      title: source.block.title,
      look: blockAppearance(source.block),
    };
  }, [columns, drag, range.startMinutes]);

  // Один раз доводим прокрутку до текущего времени: календарь, открывающийся
  // на полуночи, заставляет искать сегодняшний день руками.
  const scrolledRef = useRef(false);
  useEffect(() => {
    if (scrolledRef.current || !scrollRef.current) return;
    const offset = marker?.offset ?? minutesToOffset(9 * 60, range.startMinutes);
    scrollRef.current.scrollTop = Math.max(0, offset - HOUR_HEIGHT);
    scrolledRef.current = true;
  }, [marker, range.startMinutes]);

  const pointerToPosition = useCallback(
    (clientX: number, clientY: number) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect || columns.length === 0) return null;
      const columnWidth = rect.width / columns.length;
      const index = Math.min(
        columns.length - 1,
        Math.max(0, Math.floor((clientX - rect.left) / columnWidth)),
      );
      return {
        dateKey: columns[index].dateKey,
        minutes: offsetToMinutes(clientY - rect.top, range.startMinutes),
      };
    },
    [columns, range.startMinutes],
  );

  const beginDrag = useCallback(
    (
      event: React.PointerEvent,
      block: LearningBlock,
      startMinutes: number,
      dateKey: string,
      mode: "move" | "resize",
    ) => {
      if (busy || block.fixed) return;
      const position = pointerToPosition(event.clientX, event.clientY);
      if (!position) return;

      event.preventDefault();
      event.stopPropagation();
      draggedRef.current = false;
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      setDrag({
        blockId: block.id,
        mode,
        pointerId: event.pointerId,
        grabMinutes: position.minutes,
        originStartMinutes: startMinutes,
        originDateKey: dateKey,
        durationMinutes: block.duration_minutes,
        previewStartMinutes: startMinutes,
        previewDateKey: dateKey,
        previewDuration: block.duration_minutes,
        moved: false,
      });
    },
    [busy, pointerToPosition],
  );

  const updateDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const position = pointerToPosition(event.clientX, event.clientY);
      if (!position) return;

      if (drag.mode === "resize") {
        const duration = resizeTarget({
          startMinutes: drag.originStartMinutes,
          offsetBottom: minutesToOffset(position.minutes, range.startMinutes),
          range,
        });
        setDrag({ ...drag, previewDuration: duration, moved: true });
        return;
      }

      const shifted = snapMinutes(
        drag.originStartMinutes + (position.minutes - drag.grabMinutes),
      );
      setDrag({
        ...drag,
        previewStartMinutes: Math.max(
          0,
          Math.min(shifted, 24 * 60 - drag.durationMinutes),
        ),
        previewDateKey: position.dateKey,
        moved: true,
      });
    },
    [drag, pointerToPosition, range],
  );

  const finishDrag = useCallback(
    (event: React.PointerEvent) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const current = drag;
      setDrag(null);
      draggedRef.current = current.moved;

      if (!current.moved) return;

      if (current.mode === "resize") {
        if (current.previewDuration !== current.durationMinutes) {
          onMove(
            current.blockId,
            toInstant(current.originDateKey, current.originStartMinutes, timeZone),
            current.previewDuration,
          );
        }
        return;
      }

      const unchanged =
        current.previewDateKey === current.originDateKey &&
        current.previewStartMinutes === current.originStartMinutes;
      if (unchanged) return;

      const target = dropTarget({
        dateKey: current.previewDateKey,
        offset: minutesToOffset(current.previewStartMinutes, range.startMinutes),
        range,
        timeZone,
        durationMinutes: current.durationMinutes,
      });
      onMove(current.blockId, target.startAt);
    },
    [drag, onMove, range, timeZone],
  );

  const handleKey = useCallback(
    (
      event: React.KeyboardEvent,
      block: LearningBlock,
      startMinutes: number,
      dateKey: string,
    ) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(block);
        return;
      }
      // Перенос с клавиатуры — только с Alt: голые стрелки обязаны листать
      // фокус между блоками, а не двигать расписание при первом же нажатии.
      if (!event.altKey || block.fixed || busy) return;

      let nextDate = dateKey;
      let nextMinutes = startMinutes;
      if (event.key === "ArrowUp") nextMinutes -= KEYBOARD_STEP_MINUTES;
      else if (event.key === "ArrowDown") nextMinutes += KEYBOARD_STEP_MINUTES;
      else if (event.key === "ArrowLeft") nextDate = shiftDateKey(dateKey, -1);
      else if (event.key === "ArrowRight") nextDate = shiftDateKey(dateKey, 1);
      else return;

      event.preventDefault();
      nextMinutes = Math.max(
        0,
        Math.min(nextMinutes, 24 * 60 - block.duration_minutes),
      );
      onMove(block.id, toInstant(nextDate, nextMinutes, timeZone));
    },
    [busy, onMove, onSelect, timeZone],
  );

  return (
    <div className="overflow-hidden rounded-[20px] border border-[#ddd7cd] bg-[#fbfaf7]/95">
      <div className="flex border-b border-[#e4ded4] bg-[#fffdfa]">
        <div className="w-14 shrink-0" aria-hidden />
        {columns.map((column) => {
          const isToday = column.dateKey === todayKey;
          return (
            <div
              key={column.dateKey}
              className={`flex-1 border-l border-[#eee9e1] px-2 py-2 text-center ${
                isToday ? "bg-[#fff6e8]" : ""
              }`}
            >
              <div className={paperCaption}>{weekdayShort(column.weekday)}</div>
              <div
                className={`mt-0.5 text-[13px] ${
                  isToday ? "font-medium text-[#8a5b24]" : "text-[#5f584f]"
                }`}
              >
                {dayLabel(column.dateKey)}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="max-h-[62vh] overflow-y-auto">
        <div className="flex">
          <div className="w-14 shrink-0" style={{ height: bodyHeight }}>
            {marks.map((minutes) => (
              <div
                key={minutes}
                className="relative"
                style={{ height: 0, top: minutesToOffset(minutes, range.startMinutes) }}
              >
                <span className="absolute -top-2 right-2 text-[11px] tabular-nums text-[#9b9186]">
                  {formatMinutes(minutes)}
                </span>
              </div>
            ))}
          </div>

          <div
            ref={gridRef}
            className="relative flex flex-1 touch-none select-none"
            style={{ height: bodyHeight }}
          >
            {marks.map((minutes) => (
              <div
                key={minutes}
                className="pointer-events-none absolute inset-x-0 border-t border-[#efeae2]"
                style={{ top: minutesToOffset(minutes, range.startMinutes) }}
                aria-hidden
              />
            ))}

            {columns.map((column) => (
              <div
                key={column.dateKey}
                className={`relative flex-1 border-l border-[#eee9e1] ${
                  column.dateKey === todayKey ? "bg-[#fffaf1]/70" : ""
                }`}
              >
                {marker?.dateKey === column.dateKey ? (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-20 border-t border-[#c0512f]"
                    style={{ top: marker.offset }}
                    aria-hidden
                  >
                    <span className="absolute -left-1 -top-[3px] h-1.5 w-1.5 rounded-full bg-[#c0512f]" />
                  </div>
                ) : null}

                {column.blocks.map((positioned) => {
                  const block = positioned.block;
                  const dragging = drag?.blockId === block.id;
                  const look = blockAppearance(block);

                  // Растягивание меняет высоту на месте, перенос — нет: блок
                  // остаётся на исходном месте бледной тенью, а результат
                  // показывает отдельный слой поверх сетки. Иначе перенос в
                  // соседний день заставлял бы блок исчезнуть — в чужой колонке
                  // его в списке нет.
                  const resizing = dragging && drag.mode === "resize";
                  const top = positioned.top;
                  const height = resizing
                    ? (drag.previewDuration / 60) * HOUR_HEIGHT
                    : positioned.height;

                  const width = 100 / positioned.lanes;
                  return (
                    <div
                      key={block.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${block.title}, ${formatMinutes(
                        positioned.startMinutes,
                      )}, ${durationLabel(block.duration_minutes)}${
                        look.statusLabel ? `, ${look.statusLabel}` : ""
                      }${block.fixed ? ", закреплено" : ""}`}
                      onPointerDown={(event) =>
                        beginDrag(
                          event,
                          block,
                          positioned.startMinutes,
                          column.dateKey,
                          "move",
                        )
                      }
                      onPointerMove={updateDrag}
                      onPointerUp={finishDrag}
                      onPointerCancel={finishDrag}
                      onKeyDown={(event) =>
                        handleKey(event, block, positioned.startMinutes, column.dateKey)
                      }
                      onClick={() => {
                        if (drag || draggedRef.current) {
                          draggedRef.current = false;
                          return;
                        }
                        onSelect(block);
                      }}
                      className={`absolute overflow-hidden rounded-[10px] border px-2 py-1 text-left transition-shadow ${paperFocus} ${
                        block.fixed ? "cursor-default" : "cursor-grab"
                      } ${dragging ? "z-30 cursor-grabbing shadow-lg" : "z-10"} ${
                        selectedId === block.id ? "shadow-md" : ""
                      }`}
                      style={{
                        top,
                        height,
                        left: `calc(${positioned.lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        background: look.background,
                        borderColor: look.ring ?? look.border,
                        borderStyle: look.dashed ? "dashed" : "solid",
                        borderWidth: look.ring ? 2 : 1,
                        color: look.text,
                        opacity:
                          dragging && !resizing ? 0.3 : look.faded ? 0.55 : 1,
                        boxShadow: `inset 3px 0 0 ${look.accent}`,
                      }}
                    >
                      <div
                        className={`truncate text-[12px] font-medium leading-tight ${
                          look.struck ? "line-through" : ""
                        }`}
                      >
                        {block.title}
                      </div>
                      {height > 34 ? (
                        <div className="mt-0.5 truncate text-[11px] tabular-nums opacity-70">
                          {formatMinutes(positioned.startMinutes)} · {look.label}
                        </div>
                      ) : null}
                      {look.statusLabel && height > 52 ? (
                        <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.12em] opacity-60">
                          {look.statusLabel}
                        </div>
                      ) : null}

                      {!block.fixed ? (
                        <span
                          role="presentation"
                          onPointerDown={(event) =>
                            beginDrag(
                              event,
                              block,
                              positioned.startMinutes,
                              column.dateKey,
                              "resize",
                            )
                          }
                          onPointerMove={updateDrag}
                          onPointerUp={finishDrag}
                          onPointerCancel={finishDrag}
                          className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ))}

            {preview ? (
              <div
                className="pointer-events-none absolute z-40 rounded-[10px] border-2 border-dashed px-2 py-1"
                style={{
                  top: preview.top,
                  height: preview.height,
                  left: `calc(${preview.leftPercent}% + 2px)`,
                  width: `calc(${preview.widthPercent}% - 4px)`,
                  background: preview.look.background,
                  borderColor: preview.look.accent,
                  color: preview.look.text,
                }}
                aria-hidden
              >
                <div className="truncate text-[12px] font-medium leading-tight">
                  {preview.title}
                </div>
                <div className="mt-0.5 text-[11px] tabular-nums opacity-75">
                  {formatMinutes(preview.startMinutes)}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

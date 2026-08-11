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

import {
  commitmentKindLabel,
  entryAccent,
  isCommitmentEntry,
} from "@/lib/studyplan-calendar-entries";
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
  durationLabel,
  weekdayShort,
} from "@/lib/studyplan-visuals";
import { loadRatio, weekLoad } from "@/lib/studyplan-load";
import { paperCaption, paperFocus } from "@/components/curriculum/paper";

import type { CalendarEntry } from "./use-schedule";

/** На сколько двигают блок стрелками с Alt. */
const KEYBOARD_STEP_MINUTES = 15;

/** Освобождённое время: в ленте нагрузки не участвует. */
const RELEASED_STATUSES = new Set(["cancelled", "rescheduled"]);

/** Высота ленты нагрузки под числом дня. */
const LOAD_BAR_HEIGHT = 20;

/**
 * Как выглядит запись календаря.
 *
 * Один источник на три места — блок, слой предпросмотра и лента нагрузки, —
 * чтобы полоска под числом дня и сам блок никогда не разъезжались по цвету.
 *
 * Признак «занятое время» вычисляется внутри, но НАРУЖУ не отдаётся: вызывающий
 * код зовёт `isCommitmentEntry` сам, иначе TypeScript теряет сужение типа и
 * `commitment_kind` перестаёт существовать.
 */
function entryLook(entry: CalendarEntry, accents?: Map<string, string>) {
  const occupied = isCommitmentEntry(entry);
  return blockAppearance(entry, {
    accent: entryAccent(entry, accents),
    occupied,
  });
}

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
  columns: DayColumn<CalendarEntry>[];
  range: VisibleRange;
  timeZone: string;
  todayKey: string;
  /** Выделенные занятия. Одно — карточка разбора, несколько — пакетные действия. */
  selectedIds: string[];
  busy?: boolean;
  onSelect: (block: CalendarEntry, additive: boolean) => void;
  /** Выделение рамкой: пришёл готовый список попавших в неё занятий. */
  onSelectMany: (blockIds: string[]) => void;
  onMove: (block: CalendarEntry, startAt: Date, durationMinutes?: number) => void;
  /** Цвета программ по порядку списка. Без неё цвет берётся по хешу. */
  accents?: Map<string, string>;
}

export function WeekGrid({
  columns,
  range,
  timeZone,
  todayKey,
  selectedIds,
  busy = false,
  onSelect,
  onSelectMany,
  onMove,
  accents,
}: WeekGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Клик приходит ПОСЛЕ pointerup, когда состояние перетаскивания уже снято.
  // Без этой отметки любое перетаскивание вдобавок открывало бы карточку
  // занятия — то есть каждый перенос заканчивался бы всплывшей панелью.
  const draggedRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Видимая высота прокрутки. Нужна, чтобы дотянуть шкалу часами до низа
  // карточки: диапазон считается по занятиям, и в пустоватой неделе он выходит
  // короче экрана — под сеткой оставалось бы пустое поле внутри рамки.
  // Растёт только конец шкалы, начало не трогаем: `layoutWeek` уже посчитал
  // отступы блоков от `range.startMinutes`, и сдвиг начала уронил бы их все.
  const [viewportHeight, setViewportHeight] = useState(0);
  useEffect(() => {
    const node = scrollRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewportHeight(node.clientHeight));
    observer.observe(node);
    setViewportHeight(node.clientHeight);
    return () => observer.disconnect();
  }, []);

  const effectiveEnd = Math.min(
    24 * 60,
    Math.max(range.endMinutes, range.startMinutes + (viewportHeight / HOUR_HEIGHT) * 60),
  );
  const marks = useMemo(
    () => hourMarks({ ...range, endMinutes: effectiveEnd }),
    [range, effectiveEnd],
  );
  const bodyHeight = ((effectiveEnd - range.startMinutes) / 60) * HOUR_HEIGHT;
  const days = useMemo(() => columns.map((column) => column.dateKey), [columns]);
  const empty = columns.every((column) => column.blocks.length === 0);

  /**
   * Лента нагрузки: сколько ученик УЧИТСЯ в каждом дне и по каким предметам.
   *
   * Занятое время сюда не входит намеренно. Школа стоит по семь часов пять дней
   * подряд и, попав в ленту, забивала бы её собой: все будни выглядели одинаково
   * полными, а разница в учебной нагрузке — единственное, что здесь можно
   * подвинуть, — пропадала в общем сером столбике.
   */
  const load = useMemo(
    () =>
      weekLoad(
        days,
        columns.flatMap((column) =>
          column.blocks
            .filter((positioned) => !isCommitmentEntry(positioned.block))
            .map((positioned) => {
              const entry = positioned.block;
              return {
                dateKey: column.dateKey,
                minutes: entry.duration_minutes,
                accent: entryAccent(entry, accents),
                released: RELEASED_STATUSES.has(entry.status),
              };
            }),
        ),
      ),
    [accents, columns, days],
  );

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
      look: entryLook(source.block, accents),
    };
  }, [accents, columns, drag, range.startMinutes]);

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
      block: CalendarEntry,
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
          const source = columns
            .flatMap((column) => column.blocks)
            .find((item) => item.block.id === current.blockId)?.block;
          if (!source) return;
          onMove(
            source,
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
      const source = columns
        .flatMap((column) => column.blocks)
        .find((item) => item.block.id === current.blockId)?.block;
      if (source) onMove(source, target.startAt);
    },
    [columns, drag, onMove, range, timeZone],
  );

  // ── Выделение рамкой ──────────────────────────────────────────────────────
  //
  // Тянем по пустому месту сетки — выделяются все занятия, которых рамка
  // коснулась. Дальше их можно отменить одним Delete. Начинать разрешено
  // только с пустого места: pointerdown на самом блоке — это перетаскивание,
  // и путать эти два жеста нельзя.
  const [marquee, setMarquee] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);

  const beginMarquee = useCallback(
    (event: React.PointerEvent) => {
      if (busy) return;
      if ((event.target as HTMLElement).closest("[data-calendar-block]")) return;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setMarquee({ x1: x, y1: y, x2: x, y2: y });
    },
    [busy],
  );

  const updateMarquee = useCallback((event: React.PointerEvent) => {
    setMarquee((current) => {
      if (!current) return current;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return current;
      return {
        ...current,
        x2: event.clientX - rect.left,
        y2: event.clientY - rect.top,
      };
    });
  }, []);

  const finishMarquee = useCallback(() => {
    const box = marquee;
    setMarquee(null);
    if (!box) return;
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect || columns.length === 0) return;

    const left = Math.min(box.x1, box.x2);
    const right = Math.max(box.x1, box.x2);
    const top = Math.min(box.y1, box.y2);
    const bottom = Math.max(box.y1, box.y2);
    // Меньше пяти пикселей — это клик по пустому месту, а не рамка. Иначе
    // каждый промах мимо блока снимал бы выделение рывком.
    if (right - left < 5 && bottom - top < 5) {
      onSelectMany([]);
      return;
    }

    const columnWidth = rect.width / columns.length;
    const picked: string[] = [];
    columns.forEach((column, index) => {
      const columnLeft = index * columnWidth;
      if (columnLeft + columnWidth < left || columnLeft > right) return;
      for (const positioned of column.blocks) {
        const blockTop = positioned.top;
        const blockBottom = positioned.top + positioned.height;
        if (blockBottom < top || blockTop > bottom) continue;
        picked.push(positioned.block.id);
      }
    });
    onSelectMany(picked);
  }, [columns, marquee, onSelectMany]);

  const handleKey = useCallback(
    (
      event: React.KeyboardEvent,
      block: CalendarEntry,
      startMinutes: number,
      dateKey: string,
    ) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onSelect(block, event.shiftKey || event.metaKey || event.ctrlKey);
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
      onMove(block, toInstant(nextDate, nextMinutes, timeZone));
    },
    [busy, onMove, onSelect, timeZone],
  );

  return (
    // Сетка тянется на всю высоту, которую ей даёт страница: календарь должен
    // занимать экран, а не жить в коробке на 62vh с полосой пустоты под ней.
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-[20px] border border-[#ddd7cd] bg-[#fbfaf7]/95">
      <div className="flex shrink-0 border-b border-[#e4ded4] bg-[#fffdfa]">
        {/* Колонка под шкалой времени: держит шапку и сетку на одной оси. */}
        <div className="w-14 shrink-0" aria-hidden />
        {columns.map((column, index) => {
          const isToday = column.dateKey === todayKey;
          const day = load.days[index];
          const dayNumber = Number(column.dateKey.slice(-2));
          return (
            <div
              key={column.dateKey}
              className="flex-1 border-l border-[#eee9e1] px-1.5 pb-1.5 pt-2 text-center"
            >
              <div className={paperCaption}>{weekdayShort(column.weekday)}</div>
              {/* Число, а не «18 августа»: месяц уже написан в заголовке недели,
                  и семь раз повторять его — значит забить колонку словом. */}
              <div
                className={`mx-auto mt-1 grid h-7 w-7 place-items-center font-serif text-[15px] tabular-nums ${
                  isToday
                    ? "rounded-full bg-[#8a5b24] font-medium text-[#fdf8ef]"
                    : "text-[#4a443d]"
                }`}
              >
                {dayNumber}
              </div>

              {/* Лента нагрузки: сколько занято и чем. Отвечает на главный
                  вопрос страницы — «я не перегружен» — до того, как ученик
                  начнёт читать названия занятий. */}
              <div
                className="mt-1.5 flex items-end justify-center gap-px"
                style={{ height: LOAD_BAR_HEIGHT }}
                aria-hidden
              >
                {day && day.totalMinutes > 0 ? (
                  day.segments.map((segment) => (
                    <span
                      key={segment.accent}
                      className="w-[7px] rounded-[2px]"
                      style={{
                        height: Math.round(
                          loadRatio(segment.minutes, load.peakMinutes) *
                            LOAD_BAR_HEIGHT,
                        ),
                        background: segment.accent,
                      }}
                    />
                  ))
                ) : (
                  // Свободный день — не пустое место, а плоское основание:
                  // так семь дней остаются одним рядом, а не рваной строкой.
                  <span className="h-px w-4 rounded-full bg-[#e0dbd2]" />
                )}
              </div>
              <div className="mt-1 text-[10px] tabular-nums text-[#a1978b]">
                {day && day.totalMinutes > 0 ? durationLabel(day.totalMinutes) : "—"}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {/* `min-h-full`: когда шкала упёрлась в 24:00 и всё равно короче
            карточки, колонки должны закрашиваться до низа, а не обрываться
            полосой пустоты под последним часом. */}
        <div className="flex min-h-full">
          <div className="w-14 shrink-0" style={{ minHeight: bodyHeight }}>
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
            style={{ minHeight: bodyHeight }}
            onPointerDown={beginMarquee}
            onPointerMove={updateMarquee}
            onPointerUp={finishMarquee}
            onPointerCancel={finishMarquee}
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
                  const look = entryLook(block, accents);
                  const commitment = isCommitmentEntry(block);
                  const sourceLabel = commitment
                    ? commitmentKindLabel(block.commitment_kind)
                    : block.course_plan_title;
                  const selected = selectedIds.includes(block.id);
                  const isProposal =
                    !commitment &&
                    (block.schedule_status === "proposed" ||
                      block.schedule_status === "draft");

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
                      data-calendar-block=""
                      role="button"
                      tabIndex={0}
                      aria-label={`${block.title}, ${formatMinutes(
                        positioned.startMinutes,
                      )}, ${sourceLabel}, ${durationLabel(block.duration_minutes)}${
                        look.statusLabel ? `, ${look.statusLabel}` : ""
                      }${block.fixed ? ", закреплено" : ""}${
                        isProposal ? ", предложенное расписание" : ""
                      }`}
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
                      onClick={(event) => {
                        if (draggedRef.current) {
                          draggedRef.current = false;
                          return;
                        }
                        // Shift и Cmd/Ctrl добавляют к выделению — как в любом
                        // списке файлов. Обычный клик выделяет одно.
                        onSelect(block, event.shiftKey || event.metaKey || event.ctrlKey);
                      }}
                      className={`absolute overflow-hidden rounded-[10px] border px-2 py-1 text-left transition-shadow ${paperFocus} ${
                        block.fixed ? "cursor-default" : "cursor-grab"
                      } ${dragging ? "z-30 cursor-grabbing shadow-lg" : selected ? "z-20" : "z-10"}`}
                      style={{
                        top,
                        height,
                        left: `calc(${positioned.lane * width}% + 2px)`,
                        width: `calc(${width}% - 4px)`,
                        background: look.background,
                        // Занятое время штрихуется: чужой блок видно как чужой
                        // даже боковым зрением, ещё до чтения подписи.
                        backgroundImage: look.hatched
                          ? "repeating-linear-gradient(135deg, rgba(120,110,98,0.10) 0 3px, transparent 3px 7px)"
                          : undefined,
                        borderColor: look.ring ?? look.border,
                        borderStyle: look.dashed || isProposal ? "dashed" : "solid",
                        borderWidth: look.ring ? 2 : 1,
                        color: look.text,
                        opacity:
                          dragging && !resizing ? 0.3 : look.faded ? 0.55 : 1,
                        // Кант слева — цвет курса. У выделенного он же становится
                        // кольцом: раньше выделение показывала одна тень, и на
                        // светлой бумаге её почти не было видно.
                        boxShadow: selected
                          ? `inset 3px 0 0 ${look.accent}, 0 0 0 2px ${look.accent}, 0 6px 16px rgba(70,54,36,0.16)`
                          : `inset 3px 0 0 ${look.accent}`,
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
                          {/* Длительность прямо в блоке: раньше её показывал
                              только дневной список, а на неделе «сколько это
                              займёт» приходилось прикидывать по высоте. */}
                          {formatMinutes(positioned.startMinutes)} ·{" "}
                          {durationLabel(block.duration_minutes)}
                        </div>
                      ) : null}
                      {height > 62 ? (
                        <div className="mt-0.5 truncate text-[10px] opacity-60">
                          {sourceLabel}
                        </div>
                      ) : null}
                      {height > 78 && !commitment ? (
                        <div className="mt-0.5 truncate text-[10px] opacity-60">
                          {look.label}
                        </div>
                      ) : null}
                      {look.statusLabel && height > 96 ? (
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

            {marquee ? (
              <div
                className="pointer-events-none absolute z-50 rounded-[6px] border border-[#8a5b24] bg-[#8a5b24]/10"
                style={{
                  left: Math.min(marquee.x1, marquee.x2),
                  top: Math.min(marquee.y1, marquee.y2),
                  width: Math.abs(marquee.x2 - marquee.x1),
                  height: Math.abs(marquee.y2 - marquee.y1),
                }}
                aria-hidden
              />
            ) : null}

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

            {empty ? (
              // Раньше здесь висела карточка `absolute top-24`, налезавшая на
              // часовые линейки, — именно это читалось как сломанная вёрстка.
              // Теперь приглашение стоит по центру листа и накрыто мягкой
              // подложкой, а сетка за ним остаётся призраком: видно, что это
              // календарь, а не ошибка загрузки.
              <div
                className="absolute inset-0 z-30 flex items-center justify-center bg-gradient-to-b from-[#fbfaf7]/70 via-[#fbfaf7]/92 to-[#fbfaf7]/70 px-6"
                aria-live="polite"
              >
                <div className="max-w-[380px] text-center">
                  <div className="font-serif text-[17px] tracking-[-0.02em] text-[#3b352f]">
                    Свободная неделя
                  </div>
                  <p className="mx-auto mt-1.5 text-[12.5px] leading-relaxed text-[#7b7168]">
                    Попроси помощника справа поставить учебную программу — её
                    занятия появятся здесь вместе с остальным занятым временем.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

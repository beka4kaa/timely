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
  halfHourMarks,
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
  timeRangeLabel,
  weekdayShort,
} from "@/lib/studyplan-visuals";
import { loadRatio, weekLoad } from "@/lib/studyplan-load";
import { paperFocus } from "@/components/curriculum/paper";

import type { CalendarEntry } from "./use-schedule";

/** На сколько двигают блок стрелками с Alt. */
const KEYBOARD_STEP_MINUTES = 15;

/** Освобождённое время: в ленте нагрузки не участвует. */
const RELEASED_STATUSES = new Set(["cancelled", "rescheduled"]);

/** Высота ленты нагрузки под числом дня. */
const LOAD_BAR_HEIGHT = 18;

/**
 * Колонка времени. Ширина фиксирована и одинакова в шапке и в теле сетки:
 * разъедься они на пиксель — числа дней перестали бы стоять над колонками.
 */
const TIME_COLUMN = "relative w-[68px]";

/**
 * Сколько процентов ширины колонки нужно блоку, чтобы в нём читался текст.
 * Уже этого дорожки не режем: лучше две узкие колонки, чем пять полосок, в
 * которых не видно ни названия, ни времени.
 */
const MAX_READABLE_LANES = 3;

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
  /**
   * Карточка выбранного занятия. Рисуется ВНУТРИ сетки, рядом со своим блоком:
   * геометрию знает только она, а содержимое — страница.
   */
  renderDetails?: (entry: CalendarEntry) => React.ReactNode;
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
  renderDetails,
}: WeekGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Клик приходит ПОСЛЕ pointerup, когда состояние перетаскивания уже снято.
  // Без этой отметки любое перетаскивание вдобавок открывало бы карточку
  // занятия — то есть каждый перенос заканчивался бы всплывшей панелью.
  const draggedRef = useRef(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [now, setNow] = useState(() => new Date());

  // Шкалу больше не растягиваем под высоту экрана: рабочий день теперь всегда
  // входит в диапазон целиком (`visibleRange`), и дотягивать её пустыми часами
  // до полуночи незачем — это была плата за то, что диапазон считался только
  // по занятиям.
  const marks = useMemo(() => hourMarks(range), [range]);
  const halfMarks = useMemo(() => halfHourMarks(range), [range]);
  const bodyHeight = ((range.endMinutes - range.startMinutes) / 60) * HOUR_HEIGHT;
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

  /**
   * Где встанет карточка выбранного занятия.
   *
   * Сбоку от блока, как всплывающее окно события в календарях: сверху её
   * держать негде — там шапка, а снизу она уезжала бы за нижний край при
   * вечернем занятии. С правого края недели раскрывается влево, иначе окно
   * вылезло бы за сетку.
   */
  const detailsAnchor = useMemo(() => {
    if (!renderDetails || selectedIds.length !== 1) return null;
    const id = selectedIds[0];
    for (let index = 0; index < columns.length; index += 1) {
      const found = columns[index].blocks.find((item) => item.block.id === id);
      if (!found) continue;
      const columnWidth = 100 / columns.length;
      const toLeft = index >= columns.length - 2;
      return {
        entry: found.block,
        top: Math.max(0, found.top - 6),
        side: toLeft ? "left" : ("right" as "left" | "right"),
        offset: toLeft
          ? (columns.length - index) * columnWidth
          : (index + 1) * columnWidth,
      };
    }
    return null;
  }, [columns, renderDetails, selectedIds]);

  return (
    // Сетка тянется на всю высоту, которую ей даёт страница: календарь должен
    // занимать экран, а не жить в коробке на 62vh с полосой пустоты под ней.
    <div className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-[20px] border border-[#ddd7cd] bg-[#fbfaf7]/95">
      {/* Шапка дней закреплена: она вне области прокрутки, поэтому при скролле
          расписания не уезжает. Ширина первой ячейки совпадает с колонкой
          времени — так числа стоят ровно над своими колонками. */}
      <div className="flex shrink-0 border-b border-[#e4ded4] bg-[#fffdfa]">
        <div className={`${TIME_COLUMN} shrink-0`} aria-hidden />
        {columns.map((column, index) => {
          const isToday = column.dateKey === todayKey;
          const weekend = column.weekday >= 5;
          const day = load.days[index];
          const dayNumber = Number(column.dateKey.slice(-2));
          return (
            <div
              key={column.dateKey}
              className={`flex-1 border-l border-[#eee9e1] px-1.5 pb-1 pt-1.5 text-center ${
                weekend ? "bg-[#faf7f1]" : ""
              }`}
            >
              <div className="text-[10px] font-medium uppercase tracking-[0.14em] text-[#a1978b]">
                {weekdayShort(column.weekday)}
              </div>
              {/* Число, а не «18 августа»: месяц уже написан в заголовке недели,
                  и семь раз повторять его — значит забить колонку словом. */}
              <div
                className={`mx-auto mt-0.5 grid h-[26px] w-[26px] place-items-center font-serif text-[15px] tabular-nums ${
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
                className="mt-1 flex items-end justify-center gap-px"
                style={{ height: LOAD_BAR_HEIGHT }}
                aria-hidden
              >
                {day && day.totalMinutes > 0 ? (
                  day.segments.map((segment) => (
                    <span
                      key={segment.accent}
                      className="w-[6px] rounded-[2px]"
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
              <div className="text-[10px] tabular-nums leading-tight text-[#a1978b]">
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
          {/* Колонка времени прокручивается вместе с сеткой — иначе подписи
              разошлись бы с линиями. Ширина фиксированная: от неё зависит,
              стоят ли числа шапки над своими колонками. */}
          <div
            className={`${TIME_COLUMN} shrink-0 border-r border-[#e8e2d8] bg-[#fbfaf7]`}
            style={{ minHeight: bodyHeight }}
            aria-hidden
          >
            {marks.map((minutes) => (
              <div
                key={minutes}
                className="absolute"
                style={{
                  // Подпись центрируется ПО линии часа: половина её высоты
                  // вверх. Раньше сдвиг был на глаз, и «17:00» стояло выше
                  // собственной черты.
                  top: minutesToOffset(minutes, range.startMinutes) - 7,
                  right: 8,
                }}
              >
                <span className="text-[11px] font-medium tabular-nums leading-[14px] text-[#8d857b]">
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
            {/* Получасовые засечки светлее часовых: по ним видно, что занятие
                на сорок пять минут не дотягивает до следующего часа, но сами
                они на себя внимания не тянут. */}
            {halfMarks.map((minutes) => (
              <div
                key={`half-${minutes}`}
                className="pointer-events-none absolute inset-x-0 border-t border-[#f4f0e9]"
                style={{ top: minutesToOffset(minutes, range.startMinutes) }}
                aria-hidden
              />
            ))}
            {marks.map((minutes) => (
              <div
                key={minutes}
                className="pointer-events-none absolute inset-x-0 border-t border-[#e8e2d8]"
                style={{ top: minutesToOffset(minutes, range.startMinutes) }}
                aria-hidden
              />
            ))}

            {columns.map((column) => (
              <div
                key={column.dateKey}
                className={`relative min-w-0 flex-1 border-l border-[#eee9e1] ${
                  column.dateKey === todayKey
                    ? "bg-[#fffaf1]/70"
                    : column.weekday >= 5
                      ? "bg-[#faf7f1]/60"
                      : ""
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

                  // Дорожки не режем бесконечно: с четвёртой блок становится
                  // полоской, в которой не читается ничего. Дальше они лежат
                  // внахлёст со сдвигом — как в Google, где четвёртое событие
                  // выглядывает из-под третьего, а не исчезает.
                  const lanes = Math.min(positioned.lanes, MAX_READABLE_LANES);
                  const lane = Math.min(positioned.lane, lanes - 1);
                  const width = 100 / lanes;
                  const overflowShift =
                    positioned.lane >= MAX_READABLE_LANES
                      ? (positioned.lane - MAX_READABLE_LANES + 1) * 6
                      : 0;
                  // Узкая дорожка отдаёт название и время, всё остальное
                  // прячется: лучше две строки, которые видно, чем четыре,
                  // которые слиплись.
                  // Две дорожки — это ещё половина колонки, курс туда влезает.
                  // Прячем третью строку только с третьей дорожки.
                  const narrow = lanes > 2;
                  // А вот диапазон «16:00–17:00 · 1 ч» в половину колонки уже
                  // не помещается и обрезается многоточием на самом нужном
                  // месте. На любой дорожке, кроме единственной, показываем
                  // только начало: конец виден в карточке по клику.
                  const tight = lanes > 1;
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
                      title={`${block.title} · ${formatMinutes(
                        positioned.startMinutes,
                      )} · ${durationLabel(block.duration_minutes)}${
                        sourceLabel ? ` · ${sourceLabel}` : ""
                      }`}
                      className={`group absolute overflow-hidden rounded-[8px] border px-2 py-1 text-left transition-[box-shadow,filter] hover:brightness-[0.97] ${paperFocus} ${
                        block.fixed ? "cursor-default" : "cursor-grab"
                      } ${dragging ? "z-30 cursor-grabbing shadow-lg" : selected ? "z-20" : "z-10"}`}
                      style={{
                        top,
                        height,
                        left: `calc(${lane * width}% + ${2 + overflowShift}px)`,
                        width: `calc(${width}% - ${4 + overflowShift}px)`,
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
                      {/* Три уровня: название — время — курс. Ниже опускается
                          только то, на что хватило высоты; шрифт при этом не
                          уменьшается, иначе на узкой дорожке он превратился бы
                          в нечитаемую крошку. Отменённое гасится и получает
                          тонкую линию по НАЗВАНИЮ, а не по всему блоку. */}
                      <div className="flex items-center gap-1">
                        {look.struck ? (
                          <span
                            className="h-[3px] w-[3px] shrink-0 rounded-full bg-current opacity-50"
                            aria-hidden
                          />
                        ) : null}
                        <span
                          className={`min-w-0 truncate text-[12px] font-medium leading-tight ${
                            look.struck ? "line-through decoration-1" : ""
                          }`}
                        >
                          {block.title}
                        </span>
                      </div>
                      {height > 32 ? (
                        <div className="mt-0.5 truncate text-[11px] tabular-nums opacity-75">
                          {/* Длительность прямо в блоке: раньше её показывал
                              только дневной список, а на неделе «сколько это
                              займёт» приходилось прикидывать по высоте. */}
                          {tight
                            ? formatMinutes(positioned.startMinutes)
                            : timeRangeLabel(
                                positioned.startMinutes,
                                block.duration_minutes,
                              )}
                        </div>
                      ) : null}
                      {height > 58 && !narrow ? (
                        <div className="mt-0.5 truncate text-[11px] opacity-60">
                          {sourceLabel}
                        </div>
                      ) : null}
                      {height > 80 && !narrow && !commitment ? (
                        <div className="mt-0.5 truncate text-[11px] opacity-55">
                          {look.label}
                        </div>
                      ) : null}
                      {look.statusLabel && height > 100 && !narrow ? (
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

            {detailsAnchor ? (
              <div
                className="absolute z-[60] w-[320px] max-w-[86vw]"
                style={{
                  top: detailsAnchor.top,
                  ...(detailsAnchor.side === "right"
                    ? { left: `calc(${detailsAnchor.offset}% + 8px)` }
                    : { right: `calc(${detailsAnchor.offset}% + 8px)` }),
                }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                {renderDetails?.(detailsAnchor.entry)}
              </div>
            ) : null}

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

// Дневной вид: то же расписание, но для телефона и для фокуса.
//
// Недельная сетка на 375 px превращается в семь колонок по сорок пикселей, где
// не читается ни название, ни время. Поэтому на узком экране показывается один
// день списком — и тот же список служит фокусным режимом на десктопе.

"use client";

import {
  commitmentKindLabel,
  entryAccent,
  isCommitmentEntry,
} from "@/lib/studyplan-calendar-entries";
import {
  type DayColumn,
  formatMinutes,
  shiftDateKey,
} from "@/lib/studyplan-calendar";
import {
  blockAppearance,
  dayLabel,
  durationLabel,
  weekdayShort,
} from "@/lib/studyplan-visuals";
import {
  paperButton,
  paperCaption,
  paperFocus,
  paperTile,
} from "@/components/curriculum/paper";

import type { CalendarEntry } from "./use-schedule";

interface DayViewProps {
  column: DayColumn<CalendarEntry> | undefined;
  dateKey: string;
  todayKey: string;
  selectedId: string | null;
  onSelect: (block: CalendarEntry) => void;
  onChangeDay: (dateKey: string) => void;
  /** Цвета программ по порядку списка. Без неё цвет берётся по хешу. */
  accents?: Map<string, string>;
}

export function DayView({
  column,
  dateKey,
  todayKey,
  selectedId,
  onSelect,
  onChangeDay,
  accents,
}: DayViewProps) {
  const blocks = column?.blocks ?? [];
  const total = blocks.reduce(
    (sum, item) => sum + item.block.duration_minutes,
    0,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className={paperButton}
          onClick={() => onChangeDay(shiftDateKey(dateKey, -1))}
        >
          ←
        </button>
        <div className="text-center">
          <div className={paperCaption}>
            {weekdayShort(column?.weekday ?? 0)}
            {dateKey === todayKey ? " · сегодня" : ""}
          </div>
          <div className="text-[15px] text-[#312c27]">{dayLabel(dateKey)}</div>
        </div>
        <button
          type="button"
          className={paperButton}
          onClick={() => onChangeDay(shiftDateKey(dateKey, 1))}
        >
          →
        </button>
      </div>

      {blocks.length === 0 ? (
        <div className={`${paperTile} px-4 py-6 text-center text-[13px] text-[#7b7168]`}>
          В этот день пока ничего нет. Время свободно.
        </div>
      ) : (
        <>
          <div className={paperCaption}>
            {blocks.length} {blockWord(blocks.length)} · {durationLabel(total)}
          </div>
          <ul className="space-y-2">
            {blocks.map((positioned) => {
              const block = positioned.block;
              const commitment = isCommitmentEntry(block);
              const look = blockAppearance(block, {
                accent: entryAccent(block, accents),
                occupied: commitment,
              });
              const sourceLabel = commitment
                ? commitmentKindLabel(block.commitment_kind)
                : block.course_plan_title;
              const selected = selectedId === block.id;
              const isProposal =
                !commitment &&
                (block.schedule_status === "proposed" ||
                  block.schedule_status === "draft");
              return (
                <li key={block.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(block)}
                    aria-current={selected ? "true" : undefined}
                    className={`flex w-full items-stretch gap-3 rounded-[14px] border px-3 py-2.5 text-left ${paperFocus}`}
                    style={{
                      background: look.background,
                      backgroundImage: look.hatched
                        ? "repeating-linear-gradient(135deg, rgba(120,110,98,0.10) 0 3px, transparent 3px 7px)"
                        : undefined,
                      borderColor: look.ring ?? look.border,
                      borderStyle: look.dashed || isProposal ? "dashed" : "solid",
                      borderWidth: look.ring ? 2 : 1,
                      color: look.text,
                      opacity: look.faded ? 0.6 : 1,
                      // Выделение было только в `aria-current`: глазами выбранное
                      // занятие в дневном списке не находилось никак.
                      boxShadow: selected
                        ? `inset 3px 0 0 ${look.accent}, 0 0 0 2px ${look.accent}`
                        : `inset 3px 0 0 ${look.accent}`,
                    }}
                  >
                    <div className="w-14 shrink-0 pt-0.5">
                      <div className="text-[13px] font-medium tabular-nums">
                        {formatMinutes(positioned.startMinutes)}
                      </div>
                      <div className="text-[11px] tabular-nums opacity-65">
                        {durationLabel(block.duration_minutes)}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-[13.5px] font-medium ${
                          look.struck ? "line-through" : ""
                        }`}
                      >
                        {block.title}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[11px] opacity-70">
                        <span>{sourceLabel}</span>
                        {!commitment ? <span>· {look.label}</span> : null}
                        {block.fixed ? <span>· закреплено</span> : null}
                        {isProposal ? <span>· предложение</span> : null}
                        {look.statusLabel ? <span>· {look.statusLabel}</span> : null}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function blockWord(count: number): string {
  const tens = count % 100;
  if (tens >= 11 && tens <= 14) return "блоков";
  const units = count % 10;
  if (units === 1) return "блок";
  if (units >= 2 && units <= 4) return "блока";
  return "блоков";
}

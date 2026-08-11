// Дневной вид: то же расписание, но для телефона и для фокуса.
//
// Недельная сетка на 375 px превращается в семь колонок по сорок пикселей, где
// не читается ни название, ни время. Поэтому на узком экране показывается один
// день списком — и тот же список служит фокусным режимом на десктопе.

"use client";

import type { LearningBlock } from "@/lib/studyplan-api";
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

interface DayViewProps {
  column: DayColumn<LearningBlock> | undefined;
  dateKey: string;
  todayKey: string;
  selectedId: string | null;
  onSelect: (block: LearningBlock) => void;
  onChangeDay: (dateKey: string) => void;
}

export function DayView({
  column,
  dateKey,
  todayKey,
  selectedId,
  onSelect,
  onChangeDay,
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
          В этот день занятий нет. Это не пропуск, а запланированный отдых.
        </div>
      ) : (
        <>
          <div className={paperCaption}>
            {blocks.length} занятий · {durationLabel(total)}
          </div>
          <ul className="space-y-2">
            {blocks.map((positioned) => {
              const block = positioned.block;
              const look = blockAppearance(block);
              return (
                <li key={block.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(block)}
                    aria-current={selectedId === block.id ? "true" : undefined}
                    className={`flex w-full items-stretch gap-3 rounded-[14px] border px-3 py-2.5 text-left ${paperFocus}`}
                    style={{
                      background: look.background,
                      borderColor: look.ring ?? look.border,
                      borderStyle: look.dashed ? "dashed" : "solid",
                      borderWidth: look.ring ? 2 : 1,
                      color: look.text,
                      opacity: look.faded ? 0.6 : 1,
                      boxShadow: `inset 3px 0 0 ${look.accent}`,
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
                        <span>{look.label}</span>
                        {block.fixed ? <span>· закреплено</span> : null}
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

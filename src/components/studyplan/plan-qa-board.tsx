// Стенд календаря: все состояния сетки на одном экране, без бэкенда.
//
// Нужен потому, что живой «План» стоит за `FullAccessGate` и требует поднятого
// Django с данными: посмотреть глазами пересечения, отменённое занятие или
// линию текущего времени иначе нельзя, а это ровно те вещи, которые ломаются
// незаметно для типов и тестов.
//
// Роут закрыт в production (`app/dashboard/plan-qa/page.tsx`).

"use client";

import { useMemo, useState } from "react";

import { paperButton, paperCaption } from "@/components/curriculum/paper";
import { buildCourseAccents } from "@/lib/studyplan-calendar-entries";
import {
  layoutWeek,
  toInstant,
  visibleRange,
  weekDays,
  zonedDateKey,
} from "@/lib/studyplan-calendar";

import { BlockDetails } from "./block-details";
import { DayView } from "./day-view";
import type { CalendarEntry } from "./use-schedule";
import { WeekGrid } from "./week-grid";

const TZ = "Asia/Almaty";

/** «16:00» → минуты от полуночи. */
function hhmm(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

const PLANS = [
  { id: "plan-physics", title: "Механика, 10 класс" },
  { id: "plan-math", title: "Алгебра и начала анализа" },
  { id: "plan-ml", title: "_OceanofPDF.com_Hands-On_Machine_Learning" },
  { id: "plan-english", title: "English Grammar in Use" },
];

const COURSE_TITLE = new Map(PLANS.map((plan) => [plan.id, plan.title]));

interface Spec {
  id: string;
  day: number;
  time: string;
  minutes: number;
  title: string;
  plan: string;
  activity?: string;
  status?: string;
  proposal?: boolean;
}

/** Сценарии из задания: пересечения, длинный, короткий, отменённый, предложение. */
const SPECS: Spec[] = [
  // Два занятия в один час — проверка дорожек.
  { id: "a", day: 1, time: "16:00", minutes: 60, title: "Кинематика: разбор", plan: "plan-physics" },
  { id: "b", day: 1, time: "16:00", minutes: 45, title: "Производная", plan: "plan-math", activity: "independent_practice" },
  // Три в один час — проверка потолка дорожек.
  { id: "c", day: 2, time: "17:00", minutes: 60, title: "Градиентный спуск", plan: "plan-ml", activity: "guided_practice" },
  { id: "d", day: 2, time: "17:00", minutes: 60, title: "Present Perfect", plan: "plan-english" },
  { id: "e", day: 2, time: "17:15", minutes: 45, title: "Интегралы", plan: "plan-math" },
  // Длинный и короткий.
  { id: "f", day: 3, time: "09:00", minutes: 180, title: "Проект: пайплайн распознавания", plan: "plan-ml", activity: "project" },
  { id: "g", day: 3, time: "13:00", minutes: 15, title: "Короткое повторение", plan: "plan-physics", activity: "review" },
  // Предложение и отменённое.
  { id: "h", day: 4, time: "10:00", minutes: 90, title: "Динамика: законы Ньютона", plan: "plan-physics", proposal: true },
  { id: "i", day: 4, time: "15:00", minutes: 60, title: "Отменённое занятие", plan: "plan-math", status: "cancelled" },
  { id: "j", day: 5, time: "11:00", minutes: 60, title: "Пропущено", plan: "plan-english", status: "missed" },
  { id: "k", day: 5, time: "13:00", minutes: 60, title: "Сделано", plan: "plan-ml", status: "completed" },
  // Раннее занятие — проверка расширения шкалы вверх.
  { id: "l", day: 6, time: "06:15", minutes: 45, title: "Утренний повтор", plan: "plan-physics", activity: "review" },
];

function buildEntries(days: string[]): CalendarEntry[] {
  const lessons = SPECS.map((spec) => {
    const start = toInstant(days[spec.day], hhmm(spec.time), TZ);
    return {
      id: spec.id,
      title: spec.title,
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + spec.minutes * 60000).toISOString(),
      duration_minutes: spec.minutes,
      activity_type: spec.activity ?? "theory",
      status: spec.status ?? "scheduled",
      fixed: false,
      detail_level: "detailed",
      source: "plan",
      topic: null,
      review_step: null,
      schedule: "s1",
      course_plan: spec.plan,
      module: null,
      workspace_type: "app",
      priority: 1,
      lesson_payload: {},
      mastery_criteria: "",
      source_section_ids: [],
      source_chunk_ids: [],
      prerequisite_block_ids: [],
      review_of_topic: null,
      version: 1,
      schedule_version: 1,
      schedule_status: spec.proposal ? "proposed" : "active",
      schedule_timezone: TZ,
      course_plan_title: COURSE_TITLE.get(spec.plan) ?? "Программа",
      calendar_entry: "learning_block",
    } as unknown as CalendarEntry;
  });

  // Занятое время: школа по будням — проверка штриховки и запрета перетаскивания.
  const school = [0, 1, 2, 3, 4].map((index) => {
    const start = toInstant(days[index], 8 * 60, TZ);
    return {
      id: `school-${index}`,
      title: "Школа",
      start_at: start.toISOString(),
      end_at: new Date(start.getTime() + 6 * 3600000).toISOString(),
      duration_minutes: 360,
      activity_type: "commitment_school",
      status: "scheduled",
      fixed: true,
      detail_level: "outline",
      source: "commitment",
      topic: null,
      review_step: null,
      calendar_entry: "commitment",
      commitment_id: "school",
      commitment_kind: "school",
      commitment_source: "manual",
    } as unknown as CalendarEntry;
  });

  return [...lessons, ...school];
}

export function PlanQaBoard() {
  const [empty, setEmpty] = useState(false);
  const [mode, setMode] = useState<"week" | "day">("week");
  const [selectedIds, setSelectedIds] = useState<string[]>(["c"]);

  const todayKey = zonedDateKey(new Date(), TZ);
  const days = useMemo(() => weekDays(todayKey), [todayKey]);
  const entries = useMemo(() => (empty ? [] : buildEntries(days)), [days, empty]);
  const range = useMemo(() => visibleRange(entries, TZ), [entries]);
  const columns = useMemo(
    () => layoutWeek(entries, { timeZone: TZ, days, range }),
    [days, entries, range],
  );
  const accents = useMemo(() => buildCourseAccents(PLANS), []);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className={paperCaption}>Стенд календаря</div>
          <p className="mt-0.5 text-[12.5px] text-[#7b7168]">
            Пересечения, длинный и короткий блок, предложение, отменённое,
            занятое время, линия «сейчас», пустая неделя.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={paperButton}
            onClick={() => setEmpty((value) => !value)}
          >
            {empty ? "С занятиями" : "Пустая неделя"}
          </button>
          <button
            type="button"
            className={paperButton}
            onClick={() => setMode((value) => (value === "week" ? "day" : "week"))}
          >
            {mode === "week" ? "День" : "Неделя"}
          </button>
          <span className="text-[12px] text-[#8d857b]">
            выделено: {selectedIds.length}
          </span>
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {mode === "week" ? (
          <WeekGrid
            columns={columns}
            range={range}
            timeZone={TZ}
            todayKey={todayKey}
            selectedIds={selectedIds}
            accents={accents}
            onSelect={(entry, additive) =>
              setSelectedIds((current) =>
                additive
                  ? current.includes(entry.id)
                    ? current.filter((item) => item !== entry.id)
                    : [...current, entry.id]
                  : [entry.id],
              )
            }
            onSelectMany={setSelectedIds}
            onMove={() => {}}
            renderDetails={(entry) => (
              <BlockDetails
                block={entry}
                timeZone={TZ}
                onClose={() => setSelectedIds([])}
                onTogglePinned={() => {}}
              />
            )}
          />
        ) : (
          <div className="h-full overflow-y-auto">
            <DayView
              column={columns.find((column) => column.dateKey === todayKey)}
              dateKey={todayKey}
              todayKey={todayKey}
              selectedId={selectedIds[0] ?? null}
              accents={accents}
              onSelect={(entry) => setSelectedIds([entry.id])}
              onChangeDay={() => {}}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// «План» — один календарь времени ученика, а не календарь отдельного курса.

"use client";

import { useMemo, useState } from "react";

import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";
import {
  paperButton,
  paperCaption,
  paperCard,
  paperPrimaryButton,
  paperTile,
} from "@/components/curriculum/paper";
import {
  courseAccent,
  isCommitmentEntry,
} from "@/lib/studyplan-calendar-entries";
import { createCommitment, type StudySchedule } from "@/lib/studyplan-api";
import { layoutWeek, visibleRange, zonedDateKey } from "@/lib/studyplan-calendar";
import { durationLabel, weekLabel } from "@/lib/studyplan-visuals";

import { AssistantPanel } from "./assistant-panel";
import { BlockDetails } from "./block-details";
import { DayView } from "./day-view";
import { type CalendarEntry, useSchedule } from "./use-schedule";
import { WeekGrid } from "./week-grid";

type Mode = "week" | "day";

const EMPTY_ENTRIES: CalendarEntry[] = [];
const RELEASED_STATUSES = new Set(["cancelled", "rescheduled"]);

export function StudyPlanPage() {
  const schedule = useSchedule();
  const [mode, setMode] = useState<Mode>("week");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);

  const entries = useMemo(() => {
    if (schedule.data.state !== "ready") return EMPTY_ENTRIES;
    return [...schedule.data.blocks, ...schedule.data.commitments];
  }, [schedule.data]);
  const range = useMemo(
    () => visibleRange(entries, schedule.timeZone),
    [entries, schedule.timeZone],
  );
  const columns = useMemo(
    () =>
      layoutWeek(entries, {
        timeZone: schedule.timeZone,
        days: schedule.days,
        range,
      }),
    [entries, schedule.timeZone, schedule.days, range],
  );

  const todayKey = zonedDateKey(new Date(), schedule.timeZone);
  const activeDay =
    dayKey && schedule.days.includes(dayKey)
      ? dayKey
      : schedule.days.includes(todayKey)
        ? todayKey
        : schedule.days[0];
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const weekMinutes = columns.reduce(
    (sum, column) =>
      sum +
      column.blocks.reduce(
        (inner, item) =>
          inner +
          (!isCommitmentEntry(item.block) &&
          RELEASED_STATUSES.has(item.block.status)
            ? 0
            : item.block.duration_minutes),
        0,
      ),
    0,
  );

  if (schedule.data.state === "loading") {
    return (
      <CoffeePageShell>
        <div className={`${paperCard} h-[60vh] animate-pulse`} />
      </CoffeePageShell>
    );
  }

  if (schedule.data.state === "error") {
    return (
      <CoffeePageShell>
        <div className={`${paperCard} p-6`}>
          <p className="text-[14px] text-[#4a443d]">{schedule.data.message}</p>
          <button
            type="button"
            className={`${paperButton} mt-4`}
            onClick={() => void schedule.reload()}
          >
            Попробовать снова
          </button>
        </div>
      </CoffeePageShell>
    );
  }

  const data = schedule.data;
  const planById = new Map(data.plans.map((plan) => [plan.id, plan]));
  const visibleByPlan = new Map(
    data.schedules.map((item) => [item.course_plan, item]),
  );
  const proposalByPlan = new Map(
    data.proposals.map((item) => [item.course_plan, item]),
  );

  const selectedLearning =
    selected && !isCommitmentEntry(selected) ? selected : null;
  const assistantSchedule = selectedLearning
    ? data.schedules.find((item) => item.id === selectedLearning.schedule) ?? null
    : data.schedules.length === 1
      ? data.schedules[0]
      : null;
  const assistantScheduleId =
    data.schedules.length === 0 ? "" : assistantSchedule?.id ?? null;

  return (
    <CoffeePageShell>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className={paperCaption}>Моё время · неделя</div>
            <h1 className="mt-0.5 text-[19px] text-[#312c27]">
              {weekLabel(schedule.days)}
            </h1>
            <p className="mt-1 text-[12.5px] text-[#7b7168]">
              {weekMinutes > 0
                ? `${durationLabel(weekMinutes)} запланировано на этой неделе`
                : "Неделя пока свободна"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Предыдущая неделя"
              className={paperButton}
              onClick={() => {
                setDayKey(null);
                schedule.goToWeek(-1);
              }}
            >
              ←
            </button>
            <button
              type="button"
              className={paperButton}
              onClick={() => {
                setDayKey(null);
                schedule.goToWeek(0);
              }}
            >
              Сегодня
            </button>
            <button
              type="button"
              aria-label="Следующая неделя"
              className={paperButton}
              onClick={() => {
                setDayKey(null);
                schedule.goToWeek(1);
              }}
            >
              →
            </button>
            <div className="ml-1 inline-flex overflow-hidden rounded-full border border-[#d8d1c7]">
              {(["week", "day"] as Mode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMode(value)}
                  className={`px-3 py-1.5 text-[12.5px] transition-colors ${
                    mode === value
                      ? "bg-[#8a5b24] text-[#fdf8ef]"
                      : "bg-[#fffdfa] text-[#5f584f] hover:bg-[#fff8ec]"
                  }`}
                >
                  {value === "week" ? "Неделя" : "День"}
                </button>
              ))}
            </div>
          </div>
        </header>

        {data.proposals.map((proposal) => (
          <ProposalNotice
            key={proposal.id}
            schedule={proposal}
            title={
              planById.get(proposal.course_plan)?.title ?? "Учебная программа"
            }
            busy={schedule.busy}
            onConfirm={() => void schedule.confirm(proposal.id)}
          />
        ))}

        {schedule.notice ? (
          <div
            className={`${paperTile} flex items-center justify-between gap-3 px-4 py-2.5`}
          >
            <span className="text-[13px] text-[#a2543a]">
              {schedule.notice}
            </span>
            <button
              type="button"
              className={paperButton}
              onClick={schedule.dismissNotice}
            >
              Понятно
            </button>
          </div>
        ) : null}

        {schedule.lastRevision ? (
          <div
            className={`${paperTile} flex items-center justify-between gap-3 px-4 py-2.5`}
          >
            <span className="text-[13px] text-[#5f584f]">
              Занятие перенесено.
            </span>
            <button
              type="button"
              className={paperButton}
              disabled={schedule.busy}
              onClick={() => void schedule.undoLast()}
            >
              Вернуть как было
            </button>
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0">
            <div className={mode === "week" ? "hidden lg:block" : "hidden"}>
              <WeekGrid
                columns={columns}
                range={range}
                timeZone={schedule.timeZone}
                todayKey={todayKey}
                selectedId={selectedId}
                busy={schedule.busy}
                onSelect={(entry) => setSelectedId(entry.id)}
                onMove={(entry, startAt, duration) => {
                  if (!isCommitmentEntry(entry)) {
                    void schedule.move(entry, startAt, duration);
                  }
                }}
              />
            </div>
            <div className={mode === "week" ? "lg:hidden" : ""}>
              <DayView
                column={columns.find(
                  (column) => column.dateKey === activeDay,
                )}
                dateKey={activeDay}
                todayKey={todayKey}
                selectedId={selectedId}
                onSelect={(entry) => setSelectedId(entry.id)}
                onChangeDay={(nextDay) => {
                  setDayKey(nextDay);
                  if (nextDay < schedule.days[0]) schedule.goToWeek(-1);
                  else if (nextDay > schedule.days[schedule.days.length - 1]) {
                    schedule.goToWeek(1);
                  }
                }}
              />
            </div>
          </div>

          <aside className="min-w-0 space-y-3">
            <ProgramsPanel
              plans={data.plans}
              visibleByPlan={visibleByPlan}
              proposalByPlan={proposalByPlan}
              busy={schedule.busy}
              onBuild={(planId) => void schedule.build(planId)}
            />

            <BlockDetails
              block={selected}
              timeZone={schedule.timeZone}
              onClose={() => setSelectedId(null)}
            />

            {assistantScheduleId !== null ? (
              <AssistantPanel
                key={assistantScheduleId || "calendar"}
                scheduleId={assistantScheduleId}
                timeZone={assistantSchedule?.timezone ?? schedule.timeZone}
                onApplied={() => void schedule.reload()}
                onCommitments={async (items) => {
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
                }}
              />
            ) : (
              <div
                className={`${paperCard} px-4 py-5 text-[13px] leading-relaxed text-[#7b7168]`}
              >
                Выбери учебное занятие в календаре, чтобы помощник понял,
                расписание какой программы менять.
              </div>
            )}
          </aside>
        </div>
      </div>
    </CoffeePageShell>
  );
}

function ProposalNotice({
  schedule,
  title,
  busy,
  onConfirm,
}: {
  schedule: StudySchedule;
  title: string;
  busy: boolean;
  onConfirm: () => void;
}) {
  const conflict = schedule.conflict_report;

  if (!schedule.feasible) {
    return (
      <div className={`${paperTile} px-4 py-3`}>
        <div className={paperCaption}>{title} · не помещается</div>
        <p className="mt-1 text-[13px] text-[#5f584f]">
          Нужно {durationLabel(conflict?.required_minutes ?? 0)}, а в расписании
          есть {durationLabel(conflict?.available_minutes ?? 0)}.
        </p>
        {(conflict?.suggestions ?? []).length > 0 ? (
          <ul className="mt-2 space-y-1 text-[13px] text-[#4a443d]">
            {(conflict?.suggestions ?? []).map((suggestion) => (
              <li key={suggestion}>— {suggestion}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={`${paperTile} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}
    >
      <p className="text-[13px] text-[#5f584f]">
        <span className="font-medium text-[#3d382f]">{title}.</span>{" "}
        Предложенное время показано пунктиром. Подтверди его, если всё подходит.
      </p>
      <button
        type="button"
        className={paperPrimaryButton}
        disabled={busy}
        onClick={onConfirm}
      >
        Подтвердить программу
      </button>
    </div>
  );
}

function ProgramsPanel({
  plans,
  visibleByPlan,
  proposalByPlan,
  busy,
  onBuild,
}: {
  plans: Array<{ id: string; title: string }>;
  visibleByPlan: Map<string, StudySchedule>;
  proposalByPlan: Map<string, StudySchedule>;
  busy: boolean;
  onBuild: (planId: string) => void;
}) {
  return (
    <div className={`${paperCard} p-4`}>
      <div className={paperCaption}>Программы</div>
      <p className="mt-1 text-[12.5px] leading-relaxed text-[#7b7168]">
        Все программы добавляются в этот общий календарь.
      </p>

      {plans.length === 0 ? (
        <p className={`${paperTile} mt-3 px-3 py-2 text-[12.5px] text-[#7b7168]`}>
          Пока нет учебных программ. Создай программу в разделе «Курс по
          книге».
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {plans.map((plan) => {
            const current = visibleByPlan.get(plan.id);
            const proposal = proposalByPlan.get(plan.id);
            const active = current?.status === "active" || current?.status === "confirmed";
            const pending = proposal && proposal.feasible;
            const blocked = proposal && !proposal.feasible;

            return (
              <li
                key={plan.id}
                className={`${paperTile} px-3 py-2.5`}
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: courseAccent(plan.id) }}
                      aria-hidden
                    />
                    <span className="truncate text-[13px] text-[#312c27]">
                      {plan.title}
                    </span>
                  </div>
                  {active || pending || blocked ? (
                    <div className="mt-0.5 pl-4 text-[11px] text-[#8d857b]">
                      {blocked
                        ? "Нужно освободить время"
                        : pending
                          ? "Ожидает подтверждения"
                          : "В расписании"}
                    </div>
                  ) : null}
                </div>

                {!current && !proposal ? (
                  <button
                    type="button"
                    className={`${paperPrimaryButton} mt-2 w-full justify-center px-3 text-[11.5px]`}
                    disabled={busy}
                    onClick={() => onBuild(plan.id)}
                  >
                    Добавить программу в расписание
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

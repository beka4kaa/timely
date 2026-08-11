// «План» — один календарь времени ученика, а не календарь отдельного курса.

"use client";

import { useMemo, useState } from "react";

import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";
import { usePageSchedule } from "@/contexts/active-schedule";
import {
  paperButton,
  paperCaption,
  paperCard,
  paperPrimaryButton,
  paperTile,
} from "@/components/curriculum/paper";
import {
  buildCourseAccents,
  isCommitmentEntry,
} from "@/lib/studyplan-calendar-entries";
import { weekLoad } from "@/lib/studyplan-load";
import { createCommitment, type StudySchedule } from "@/lib/studyplan-api";
import { layoutWeek, visibleRange, zonedDateKey } from "@/lib/studyplan-calendar";
import {
  durationLabel,
  weekLabel,
  weekdayOnLabel,
} from "@/lib/studyplan-visuals";

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

  // Считаем УЧЕБНОЕ время, без школы и репетитора: столько же показывает лента
  // в шапке сетки, и это единственное время, которое ученик здесь двигает.
  // Занятое время видно в самом календаре.
  const load = useMemo(
    () =>
      weekLoad(
        columns.map((column) => column.dateKey),
        columns.flatMap((column) =>
          column.blocks.flatMap((item) => {
            const entry = item.block;
            if (isCommitmentEntry(entry)) return [];
            return [
              {
                dateKey: column.dateKey,
                minutes: entry.duration_minutes,
                // Здесь цвет не нужен — важны только суммы и пик, — поэтому
                // группируем прямо по программе.
                accent: entry.course_plan,
                released: RELEASED_STATUSES.has(entry.status),
              },
            ];
          }),
        ),
      ),
    [columns],
  );
  const weekMinutes = load.totalMinutes;

  // «Плотнее всего в среду» имеет смысл, только когда занятых дней больше
  // одного: у единственного дня недели пик — он сам, и подпись превращается
  // в тавтологию.
  const busyDays = load.days.filter((day) => day.totalMinutes > 0).length;
  const peakColumn =
    busyDays > 1
      ? columns.find((column) => column.dateKey === load.peakDateKey) ?? null
      : null;

  // Какое расписание правит помощник в панели справа.
  //
  // Считается ДО ранних возвратов ниже: `usePageSchedule` — хук, и после
  // `return` его вызвать нельзя. Пока данные грузятся, расписания нет, и панель
  // честно говорит, что выбрать нечего.
  const ready = schedule.data.state === "ready" ? schedule.data : null;
  const selectedLearning =
    selected && !isCommitmentEntry(selected) ? selected : null;
  const assistantSchedule = ready
    ? selectedLearning
      ? ready.schedules.find((item) => item.id === selectedLearning.schedule) ??
        null
      : ready.schedules.length === 1
        ? ready.schedules[0]
        : null
    : null;
  // `""` — расписаний нет вовсе, бэкенд возьмёт последнее неархивное сам.
  // `null` — программ несколько, а занятие не выбрано: чью двигать, неясно.
  const assistantScheduleId = !ready
    ? null
    : ready.schedules.length === 0
      ? ""
      : assistantSchedule?.id ?? null;

  usePageSchedule({
    scheduleId: assistantScheduleId,
    timeZone: assistantSchedule?.timezone ?? schedule.timeZone,
    onApplied: () => void schedule.reload(),
    onCommitments: async (items) => {
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
    },
  });

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
  // Цвета программ раздаются по порядку списка, а не по хешу: иначе два курса
  // могли достаться одному цвету, и правило «цвет = предмет» ломалось бы ровно
  // там, где оно нужнее всего.
  const accents = buildCourseAccents(data.plans.map((plan) => plan.id));

  /** Что предложить добавить, когда календарь пуст. */
  const firstUnscheduledPlan =
    data.plans.find(
      (plan) => !visibleByPlan.has(plan.id) && !proposalByPlan.has(plan.id),
    ) ?? null;

  return (
    <CoffeePageShell fillHeight maxWidthClassName="max-w-none">
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className={paperCaption}>Моё время · неделя</div>
            <h1 className="mt-0.5 text-[19px] text-[#312c27]">
              {weekLabel(schedule.days)}
            </h1>
            <p className="mt-1 text-[12.5px] text-[#7b7168]">
              {weekMinutes > 0 ? (
                <>
                  {durationLabel(weekMinutes)} учёбы на этой неделе
                  {peakColumn ? (
                    <>
                      {" · плотнее всего "}
                      <span className="text-[#5f584f]">
                        {weekdayOnLabel(peakColumn.weekday)}
                      </span>
                    </>
                  ) : null}
                </>
              ) : (
                "Неделя пока свободна"
              )}
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

        <ProgramsStrip
          plans={data.plans}
          visibleByPlan={visibleByPlan}
          proposalByPlan={proposalByPlan}
          busy={schedule.busy}
          accents={accents}
          onBuild={(planId) => void schedule.build(planId)}
        />

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

        {/* Календарь занимает всё оставшееся место, как в любом календарном
            приложении. Раньше рядом стояла колонка в 320 px, которая почти
            всегда пустовала, — из-за неё неделя жалась, а под сеткой оставалась
            полоса мёртвого пространства. Программы уехали строкой наверх,
            карточка занятия всплывает поверх сетки и только когда нужна. */}
        <div className="relative min-h-0 flex-1">
          <div
            className={`h-full ${mode === "week" ? "hidden lg:block" : "hidden"}`}
          >
            <WeekGrid
                columns={columns}
                range={range}
                timeZone={schedule.timeZone}
                todayKey={todayKey}
                selectedId={selectedId}
                busy={schedule.busy}
                accents={accents}
                onSelect={(entry) => setSelectedId(entry.id)}
                onMove={(entry, startAt, duration) => {
                  if (!isCommitmentEntry(entry)) {
                    void schedule.move(entry, startAt, duration);
                  }
                }}
                // Единственная главная кнопка экрана стоит здесь, в пустом
                // календаре, — там, где ученик и упирается в вопрос «а что
                // дальше». В списке программ кнопки при этом тихие.
                emptyAction={
                  firstUnscheduledPlan ? (
                    <button
                      type="button"
                      className={paperPrimaryButton}
                      disabled={schedule.busy}
                      onClick={() => void schedule.build(firstUnscheduledPlan.id)}
                    >
                      Добавить программу в расписание
                    </button>
                  ) : null
                }
            />
          </div>

          <div
            className={`h-full overflow-y-auto ${
              mode === "week" ? "lg:hidden" : ""
            }`}
          >
            <DayView
              column={columns.find((column) => column.dateKey === activeDay)}
              dateKey={activeDay}
              todayKey={todayKey}
              selectedId={selectedId}
              accents={accents}
              onSelect={(entry) => setSelectedId(entry.id)}
              onChangeDay={(nextDay) => {
                setDayKey(nextDay);
                if (nextDay < schedule.days[0]) schedule.goToWeek(-1);
                else if (nextDay > schedule.days[schedule.days.length - 1]) {
                  schedule.goToWeek(1);
                }
              }}
            />

            {/* На узком экране всплывающей карточке негде встать, поэтому там
                разбор занятия идёт следом за списком. */}
            {selected ? (
              <div className="mt-3 lg:hidden">
                <BlockDetails
                  block={selected}
                  timeZone={schedule.timeZone}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            ) : null}
          </div>

          {/* Карточка занятия всплывает поверх календаря и только по выбору —
              как попап события в календарных приложениях. Постоянная колонка
              под неё девять раз из десяти показывала «выбери занятие». */}
          {selected ? (
            <div className="pointer-events-none absolute inset-y-0 right-0 z-40 hidden w-[340px] items-start p-3 lg:flex">
              <div className="pointer-events-auto max-h-full w-full overflow-y-auto">
                <BlockDetails
                  block={selected}
                  timeZone={schedule.timeZone}
                  onClose={() => setSelectedId(null)}
                />
              </div>
            </div>
          ) : null}

          {/* Помощник по расписанию живёт в панели справа: два разговора в одном
              углу экрана заставляли выбирать между ними глазами. Страница
              только сообщает панели, какое расписание на экране, — см.
              `usePageSchedule` выше. */}
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

/**
 * Программы одной строкой над календарём.
 *
 * Раньше это была карточка в колонке 320 px справа. Колонка забирала шестую
 * часть ширины экрана ради списка из двух строк, а календарь — то, ради чего
 * страницу открывают, — жался. Легенда календаря и должна читаться как
 * легенда: цвет, название, состояние.
 */
function ProgramsStrip({
  plans,
  visibleByPlan,
  proposalByPlan,
  busy,
  onBuild,
  accents,
}: {
  plans: Array<{ id: string; title: string }>;
  visibleByPlan: Map<string, StudySchedule>;
  proposalByPlan: Map<string, StudySchedule>;
  busy: boolean;
  onBuild: (planId: string) => void;
  accents: Map<string, string>;
}) {
  if (plans.length === 0) {
    return (
      <p className="text-[12.5px] text-[#8d857b]">
        Пока нет учебных программ. Создай программу в разделе «Курс по книге».
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className={`${paperCaption} mr-1`}>Программы</span>
      {plans.map((plan) => {
        const current = visibleByPlan.get(plan.id);
        const proposal = proposalByPlan.get(plan.id);
        const pending = proposal && proposal.feasible;
        const blocked = proposal && !proposal.feasible;
        const status = blocked
          ? "нужно освободить время"
          : pending
            ? "ждёт подтверждения"
            : null;

        return (
          <span
            key={plan.id}
            className={`${paperTile} inline-flex max-w-[280px] items-center gap-1.5 py-1 pl-2.5 pr-2 text-[12px]`}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: accents.get(plan.id) ?? "#8a5b24" }}
              aria-hidden
            />
            <span className="truncate text-[#4a443d]">{plan.title}</span>
            {status ? (
              <span className="shrink-0 text-[11px] text-[#8d857b]">
                · {status}
              </span>
            ) : null}
            {!current && !proposal ? (
              <button
                type="button"
                className={`${paperButton} ml-0.5 shrink-0 px-2 py-0.5 text-[11px]`}
                disabled={busy}
                onClick={() => onBuild(plan.id)}
              >
                В расписание
              </button>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

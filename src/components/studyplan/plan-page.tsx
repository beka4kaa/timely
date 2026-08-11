// Страница «План»: календарь самостоятельного обучения.
//
// Разделение с дневником продуктовое, а не техническое. Дневник — это школа:
// уроки, оценки, заданное на дом. План — это то, что ученик делает сам по
// своей программе. Смешать их значило бы потерять единственный ответ, ради
// которого раздел существует: что я сегодня делаю по СВОЕЙ учёбе.

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
import { createCommitment, type LearningBlock } from "@/lib/studyplan-api";
import { layoutWeek, visibleRange, zonedDateKey } from "@/lib/studyplan-calendar";
import { durationLabel, weekLabel } from "@/lib/studyplan-visuals";

import { AssistantPanel } from "./assistant-panel";
import { BlockDetails } from "./block-details";
import { DayView } from "./day-view";
import { useSchedule } from "./use-schedule";
import { WeekGrid } from "./week-grid";

type Mode = "week" | "day";

/** Общая пустая ссылка: см. комментарий у `blocks` ниже. */
const EMPTY_BLOCKS: LearningBlock[] = [];

export function StudyPlanPage() {
  const schedule = useSchedule();
  const [mode, setMode] = useState<Mode>("week");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dayKey, setDayKey] = useState<string | null>(null);

  // Через `useMemo`, а не тернарником по месту: литерал `[]` — новая ссылка на
  // каждый рендер, и раскладка недели пересчитывалась бы на каждое движение
  // мыши, хотя блоки не менялись.
  const blocks = useMemo(
    () => (schedule.data.state === "ready" ? schedule.data.blocks : EMPTY_BLOCKS),
    [schedule.data],
  );
  const range = useMemo(
    () => visibleRange(blocks, schedule.timeZone),
    [blocks, schedule.timeZone],
  );
  const columns = useMemo(
    () =>
      layoutWeek(blocks, {
        timeZone: schedule.timeZone,
        days: schedule.days,
        range,
      }),
    [blocks, schedule.timeZone, schedule.days, range],
  );

  const todayKey = zonedDateKey(new Date(), schedule.timeZone);
  const activeDay = dayKey ?? (schedule.days.includes(todayKey) ? todayKey : schedule.days[0]);
  const selected = blocks.find((block) => block.id === selectedId) ?? null;

  const weekMinutes = columns.reduce(
    (sum, column) =>
      sum + column.blocks.reduce((inner, item) => inner + item.block.duration_minutes, 0),
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

  if (schedule.data.state === "empty") {
    const plans = schedule.data.plans;
    return (
      <CoffeePageShell>
        <div className={`${paperCard} p-6`}>
          <h1 className="text-[18px] text-[#312c27]">Календаря пока нет</h1>
          <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-[#5f584f]">
            План раскладывает утверждённую программу по конкретным дням и часам:
            во вторник в 17:00 — такая-то тема, столько-то минут. Выбери
            программу, и я построю календарь на ближайшие месяцы.
          </p>

          {plans.length === 0 ? (
            <p className={`${paperTile} mt-4 px-3 py-2 text-[13px] text-[#7b7168]`}>
              Сначала нужна программа: раздел «Курс по книге» соберёт её по
              твоему учебнику.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {plans.map((plan) => (
                <li
                  key={plan.id}
                  className={`${paperTile} flex items-center justify-between gap-3 px-3 py-2`}
                >
                  <span className="min-w-0 truncate text-[13.5px] text-[#312c27]">
                    {plan.title}
                  </span>
                  <button
                    type="button"
                    className={paperPrimaryButton}
                    disabled={schedule.busy}
                    onClick={() => void schedule.build(plan.id)}
                  >
                    Построить календарь
                  </button>
                </li>
              ))}
            </ul>
          )}

          {schedule.notice ? (
            <p className="mt-3 text-[13px] text-[#a2543a]">{schedule.notice}</p>
          ) : null}
        </div>
      </CoffeePageShell>
    );
  }

  const current = schedule.data.schedule;
  const conflict = current.conflict_report;
  const isProposal = current.status === "proposed" || current.status === "draft";

  return (
    <CoffeePageShell>
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className={paperCaption}>Неделя</div>
            <h1 className="mt-0.5 text-[19px] text-[#312c27]">
              {weekLabel(schedule.days)}
            </h1>
            <p className="mt-1 text-[12.5px] text-[#7b7168]">
              {weekMinutes > 0
                ? `${durationLabel(weekMinutes)} занятий на этой неделе`
                : "На этой неделе занятий нет"}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={paperButton} onClick={() => schedule.goToWeek(-1)}>
              ←
            </button>
            <button type="button" className={paperButton} onClick={() => schedule.goToWeek(0)}>
              Сегодня
            </button>
            <button type="button" className={paperButton} onClick={() => schedule.goToWeek(1)}>
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

        {isProposal ? (
          <div className={`${paperTile} flex flex-wrap items-center justify-between gap-3 px-4 py-3`}>
            <p className="text-[13px] text-[#5f584f]">
              Это предложенный календарь. Посмотри неделю и подтверди — после
              этого он станет твоим расписанием.
            </p>
            <button
              type="button"
              className={paperPrimaryButton}
              disabled={schedule.busy || !current.feasible}
              onClick={() => void schedule.confirm()}
            >
              Подтвердить
            </button>
          </div>
        ) : null}

        {conflict && conflict.feasible === false ? (
          <div className={`${paperTile} px-4 py-3`}>
            <div className={paperCaption}>Программа не помещается</div>
            <p className="mt-1 text-[13px] text-[#5f584f]">
              Нужно {durationLabel(conflict.required_minutes ?? 0)}, а в ритме есть{" "}
              {durationLabel(conflict.available_minutes ?? 0)}.
            </p>
            <ul className="mt-2 space-y-1 text-[13px] text-[#4a443d]">
              {(conflict.suggestions ?? []).map((suggestion) => (
                <li key={suggestion}>— {suggestion}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {schedule.notice ? (
          <div className={`${paperTile} flex items-center justify-between gap-3 px-4 py-2.5`}>
            <span className="text-[13px] text-[#a2543a]">{schedule.notice}</span>
            <button type="button" className={paperButton} onClick={schedule.dismissNotice}>
              Понятно
            </button>
          </div>
        ) : null}

        {schedule.lastRevision ? (
          <div className={`${paperTile} flex items-center justify-between gap-3 px-4 py-2.5`}>
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
            {/* Недельная сетка на телефоне нечитаема, поэтому там всегда день. */}
            <div className={mode === "week" ? "hidden lg:block" : "hidden"}>
              <WeekGrid
                columns={columns}
                range={range}
                timeZone={schedule.timeZone}
                todayKey={todayKey}
                selectedId={selectedId}
                busy={schedule.busy}
                onSelect={(block: LearningBlock) => setSelectedId(block.id)}
                onMove={(blockId, startAt, duration) =>
                  void schedule.move(blockId, startAt, duration)
                }
              />
            </div>
            <div className={mode === "week" ? "lg:hidden" : ""}>
              <DayView
                column={columns.find((column) => column.dateKey === activeDay)}
                dateKey={activeDay}
                todayKey={todayKey}
                selectedId={selectedId}
                onSelect={(block) => setSelectedId(block.id)}
                onChangeDay={setDayKey}
              />
            </div>
          </div>

          <aside className="min-w-0 space-y-3">
            {/* Две панели одна под другой, а не вкладками: карточка занятия и
                помощник отвечают на разные вопросы, и ученик обращается к ним
                одновременно — «что тут стоит» и «переставь мне это». */}
            <BlockDetails
              block={selected}
              timeZone={schedule.timeZone}
              onClose={() => setSelectedId(null)}
            />
            <AssistantPanel
              scheduleId={current.id}
              timeZone={schedule.timeZone}
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
          </aside>
        </div>
      </div>
    </CoffeePageShell>
  );
}

"use client";

// «Задано» рядом с календарём недели: задания по дням сдачи, те же карточки, что были
// в дневнике. Отметить, поставить в план, записать новое можно прямо отсюда.

import { useEffect, useMemo, useState } from "react";

import { DayGroupCard } from "@/components/diary/day-group";
import { useSubjects } from "@/components/diary/lesson-dialog";
import { useDiaryPlan } from "@/components/diary/use-diary-plan";
import type { DiaryWeekApi } from "@/components/diary/use-diary-week";
import { groupWeek, localDateKey, mondayOf, taskCount } from "@/lib/diary-tasks";
import { plural } from "@/lib/now-feed";

export function WeekTasks({ api, weekStart }: { api: DiaryWeekApi; weekStart: string | null }) {
  const plan = useDiaryPlan();
  const { week, status } = api;

  // Дата только с клиента: сервер живёт в другом часовом поясе.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = now ? localDateKey(now) : null;
  const nowMinutes = now ? now.getHours() * 60 + now.getMinutes() : 0;

  const [showPast, setShowPast] = useState(false);
  const closePlan = plan.close;
  useEffect(() => {
    setShowPast(false);
    closePlan();
  }, [closePlan, weekStart]);

  const tasks = useMemo(() => (week && today ? groupWeek(week, today, nowMinutes) : null), [nowMinutes, today, week]);
  const hasLinkedTests = Boolean(week?.days.some((day) => day.lessons.some((lesson) => lesson.linkedSubjectIds?.length)));
  const subjects = useSubjects(hasLinkedTests);
  const subjectNames = useMemo(() => new Map(subjects.map((subject) => [subject.id, subject.name])), [subjects]);

  const thisMonday = today ? mondayOf(today) : null;
  const isPastWeek = weekStart !== null && thisMonday !== null && weekStart < thisMonday;
  const upcoming = tasks?.upcoming ?? [];
  const past = tasks?.past ?? [];
  const pastCount = taskCount(past);

  return (
    <section className="wk-tasks" aria-label="Задано">
      <h2 className="wk-tasks-h">Задано</h2>

      {status === "loading" || !week ? (
        <div className="card wk-tasks-skel" aria-busy="true">
          <span className="dy-skel dy-skel-row" />
          <span className="dy-skel dy-skel-row" />
        </div>
      ) : null}

      {status === "error" ? (
        <div className="card wk-tasks-note" role="alert">
          <p>Дневник не загрузился.</p>
          <button type="button" className="btn btn-line" onClick={api.reload}>
            Попробовать снова
          </button>
        </div>
      ) : null}

      {week && status === "ready" ? (
        <>
          {(isPastWeek ? past : upcoming).map((group) => (
            <DayGroupCard
              key={group.day.id}
              group={group}
              week={week}
              canPlan={!isPastWeek}
              api={api}
              plan={plan}
              subjectNames={subjectNames}
            />
          ))}

          {!isPastWeek && !upcoming.length ? (
            <p className="wk-tasks-empty">На этой неделе больше ничего не задано.</p>
          ) : null}
          {isPastWeek && !past.length ? <p className="wk-tasks-empty">На этой неделе ничего не было задано.</p> : null}

          {!isPastWeek && past.length ? (
            <button
              type="button"
              className="btn btn-text wk-tasks-more"
              aria-expanded={showPast}
              onClick={() => setShowPast((value) => !value)}
            >
              {showPast
                ? "Скрыть прошедшие дни"
                : `Прошедшие дни${pastCount ? `, ${pastCount} ${plural(pastCount, ["задание", "задания", "заданий"])}` : ""}`}
            </button>
          ) : null}
          {!isPastWeek && showPast
            ? past.map((group) => (
                <DayGroupCard
                  key={`past-${group.day.id}`}
                  group={group}
                  week={week}
                  canPlan={false}
                  api={api}
                  plan={plan}
                  subjectNames={subjectNames}
                />
              ))
            : null}
        </>
      ) : null}
    </section>
  );
}

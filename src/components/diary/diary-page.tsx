"use client";

// Дневник в варианте «Задания»: не таблица недели, а список того, что задано, по дням
// сдачи. Сбоку карточки уроков с оценками. Данные и записи живут в `use-diary-week.ts`,
// поставить задание в план помогает `use-diary-plan.ts`.
//
// Всем остальным дневник показывает «Неделя» вместе с планом. Эта страница остаётся для
// тех, кому план закрыт: без неё они потеряли бы уроки и задания.

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DayGroupCard } from "@/components/diary/day-group";
import { LessonDialog, useSubjects } from "@/components/diary/lesson-dialog";
import { SchoolCard } from "@/components/diary/school-card";
import { useDiaryPlan } from "@/components/diary/use-diary-plan";
import { useDiaryWeek } from "@/components/diary/use-diary-week";
import { WeekVideos, weekLinkCount } from "@/components/diary/week-videos";
import { Icon } from "@/components/shell/icons";
import { SubNav } from "@/components/shell/tab-bar";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { nextUndoLabel } from "@/lib/diary-undo";
import {
  classesOfDay,
  defaultWeekStart,
  groupWeek,
  localDateKey,
  mondayOf,
  taskCount,
  weekRangeLabel,
} from "@/lib/diary-tasks";
import { dayMonthLabel, plural, weekdayLabel } from "@/lib/now-feed";
import { shiftDateKey } from "@/lib/studyplan-calendar";
import type { DiaryDay, DiaryLesson } from "@/types/diary";

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function WeekSkeleton() {
  return (
    <div className="todo" role="status" aria-label="Загружаю неделю">
      <div>
        {[3, 2].map((rows, group) => (
          <section className="td-day" key={group}>
            <span className="dy-skel dy-skel-title" />
            <div className="card dy-skel-card">
              {Array.from({ length: rows }, (_, row) => (
                <span className="dy-skel dy-skel-row" key={row} />
              ))}
            </div>
          </section>
        ))}
      </div>
      <aside className="todo-side">
        <div className="tcard card dy-skel-card">
          <span className="dy-skel dy-skel-row" />
          <span className="dy-skel dy-skel-row" />
        </div>
      </aside>
    </div>
  );
}

export function DiaryPage() {
  // Дата только с клиента: сервер живёт в другом часовом поясе, и первый кадр разошёлся бы.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const today = now ? localDateKey(now) : null;

  const [weekStart, setWeekStart] = useState<string | null>(null);
  useEffect(() => {
    if (today && weekStart === null) setWeekStart(defaultWeekStart(today));
  }, [today, weekStart]);

  const api = useDiaryWeek(weekStart);
  const plan = useDiaryPlan();
  const { week, status } = api;

  const [hasTemplate, setHasTemplate] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/diary/template")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (alive) setHasTemplate(Boolean(body?.active));
      })
      .catch(() => {
        if (alive) setHasTemplate(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [showWeek, setShowWeek] = useState(false);
  const [showVideos, setShowVideos] = useState(false);
  const [lessonTarget, setLessonTarget] = useState<{ day: DiaryDay; lesson: DiaryLesson } | null>(null);

  // Другая неделя: всё развёрнутое и начатое относилось к прежней.
  const closePlan = plan.close;
  useEffect(() => {
    setShowPast(false);
    setShowWeek(false);
    closePlan();
  }, [closePlan, weekStart]);

  // Горячие клавиши как раньше: отмена и переход по неделям, вне полей ввода.
  const { undo, redo } = api;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement | null;
      const tag = element?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || element?.isContentEditable) return;
      if (!event.ctrlKey && !event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        setWeekStart((current) =>
          current ? shiftDateKey(current, event.key === "ArrowLeft" ? -7 : 7) : current,
        );
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [redo, undo]);

  const nowMinutes = now ? now.getHours() * 60 + now.getMinutes() : 0;
  const tasks = useMemo(
    () => (week && today ? groupWeek(week, today, nowMinutes) : null),
    [nowMinutes, today, week],
  );

  const hasLinkedTests = Boolean(
    week?.days.some((day) => day.lessons.some((lesson) => lesson.linkedSubjectIds?.length)),
  );
  const subjects = useSubjects(hasLinkedTests);
  const subjectNames = useMemo(
    () => new Map(subjects.map((subject) => [subject.id, subject.name])),
    [subjects],
  );

  const thisMonday = today ? mondayOf(today) : null;
  const isCurrentWeek = weekStart !== null && weekStart === thisMonday;
  const isPastWeek = weekStart !== null && thisMonday !== null && weekStart < thisMonday;

  const hasLessons = Boolean(week?.days.some((day) => classesOfDay(day).length));
  const upcoming = tasks?.upcoming ?? [];
  const past = tasks?.past ?? [];
  const totalTasks = taskCount(upcoming) + taskCount(past);
  const pastTaskCount = taskCount(past);
  const openDialog = (day: DiaryDay, lesson: DiaryLesson) => setLessonTarget({ day, lesson });

  const applyTemplate = () => {
    setConfirmOpen(false);
    void api.applyTemplate();
  };

  // Боковая колонка. На этой неделе сначала сегодня и вчера, остальное по кнопке.
  const todayDay = today ? week?.days.find((day) => day.date === today) : undefined;
  const yesterday = today ? shiftDateKey(today, -1) : "";
  const yesterdayDay = week?.days.find((day) => day.date === yesterday);
  const otherDays = (week?.days ?? [])
    .filter((day) => classesOfDay(day).length)
    .filter((day) => !isCurrentWeek || (day.date !== today && day.date !== yesterday))
    .sort((left, right) => left.date.localeCompare(right.date));
  const dayCardTitle = (day: DiaryDay) => `${capitalize(weekdayLabel(day.date))}, ${dayMonthLabel(day.date)}`;

  const linkCount = week ? weekLinkCount(week) : 0;

  return (
    <div className="content view">
      <SubNav group="study" />
      <header className="head dy-head">
        <h1 className="title">Дневник</h1>
        <div className="head-tools">
          <div className="dy-links">
            <Link className="btn btn-text" href="/dashboard/diary/grades">
              <span className="dy-w">Итоговые оценки</span>
              <span className="dy-n">Оценки</span>
            </Link>
            <Link className="btn btn-text" href="/dashboard/diary/schedule">
              <span className="dy-w">Шаблон расписания</span>
              <span className="dy-n">Шаблон</span>
            </Link>
            {hasTemplate ? (
              <button
                type="button"
                className="btn btn-text"
                disabled={api.applying || status !== "ready"}
                onClick={() => setConfirmOpen(true)}
              >
                <span className="dy-w">{api.applying ? "Применяю…" : "Применить шаблон"}</span>
                <span className="dy-n">{api.applying ? "Применяю…" : "Применить"}</span>
              </button>
            ) : null}
            {api.hasUndo ? (
              <button
                type="button"
                className="btn btn-text"
                title={nextUndoLabel() ?? undefined}
                onClick={undo}
              >
                <Icon name="undo" />
                Отменить
              </button>
            ) : null}
            {!isCurrentWeek && thisMonday ? (
              <button type="button" className="btn btn-text" onClick={() => setWeekStart(thisMonday)}>
                Эта неделя
              </button>
            ) : null}
          </div>
          <div className="pager">
            <button
              type="button"
              className="icon-btn"
              aria-label="Прошлая неделя"
              disabled={!weekStart}
              onClick={() => weekStart && setWeekStart(shiftDateKey(weekStart, -7))}
            >
              <Icon name="chev-l" />
            </button>
            <span aria-live="polite">{weekStart ? weekRangeLabel(weekStart) : " "}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Следующая неделя"
              disabled={!weekStart}
              onClick={() => weekStart && setWeekStart(shiftDateKey(weekStart, 7))}
            >
              <Icon name="chev-r" />
            </button>
          </div>
        </div>
      </header>

      {status === "error" ? (
        <div className="card dy-empty" role="alert">
          <h2>Дневник не загрузился</h2>
          <p>Записи на месте, это ошибка связи. Попробуй ещё раз.</p>
          <button type="button" className="btn btn-line" onClick={api.reload}>
            Повторить
          </button>
        </div>
      ) : !week || !today || !tasks || (!hasLessons && !totalTasks && hasTemplate === null) ? (
        <WeekSkeleton />
      ) : !hasLessons && !totalTasks ? (
        <div className="card dy-empty">
          <h2>{hasTemplate ? "На этой неделе нет уроков" : "Пока нет расписания"}</h2>
          <p>
            {hasTemplate
              ? "В шаблоне нет уроков, или неделя собралась раньше него. Заполни шаблон или примени его к этой неделе."
              : "Дневник собирается из шаблона: какие уроки в какой день. Заполни его один раз, и здесь появятся задания и оценки на каждую неделю."}
          </p>
          <div className="dy-empty-acts">
            <Link className="btn btn-main" href="/dashboard/diary/schedule">
              Настроить расписание
            </Link>
            {hasTemplate ? (
              <button type="button" className="btn btn-line" onClick={() => setConfirmOpen(true)}>
                Применить шаблон
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="todo">
          <div>
            {totalTasks === 0 ? (
              <p className="dy-note">
                {upcoming.length
                  ? "На этой неделе пока ничего не записано. Нажми «Добавить задание» у нужного дня."
                  : "На этой неделе ничего не было записано."}
              </p>
            ) : null}

            {upcoming.map((group) => (
              <DayGroupCard
                key={group.day.id}
                group={group}
                week={week}
                canPlan
                api={api}
                plan={plan}
                subjectNames={subjectNames}
              />
            ))}

            {isCurrentWeek && upcoming.length === 0 ? (
              <div className="card dy-empty">
                <h2>На этой неделе больше ничего не задано</h2>
                <p>Задания на понедельник записываются в следующую неделю.</p>
                {thisMonday ? (
                  <button
                    type="button"
                    className="btn btn-line"
                    onClick={() => setWeekStart(shiftDateKey(thisMonday, 7))}
                  >
                    Следующая неделя
                  </button>
                ) : null}
              </div>
            ) : null}

            {isPastWeek
              ? past.map((group) => (
                  <DayGroupCard
                    key={group.day.id}
                    group={group}
                    week={week}
                    canPlan={false}
                    api={api}
                    plan={plan}
                    subjectNames={subjectNames}
                  />
                ))
              : null}

            {isCurrentWeek && past.length ? (
              <div className="dy-more">
                <button
                  type="button"
                  className="btn btn-text"
                  aria-expanded={showPast}
                  onClick={() => setShowPast((value) => !value)}
                >
                  {showPast
                    ? "Скрыть прошедшие дни"
                    : `Прошедшие дни${
                        pastTaskCount
                          ? `, ${pastTaskCount} ${plural(pastTaskCount, ["задание", "задания", "заданий"])}`
                          : ""
                      }`}
                </button>
              </div>
            ) : null}

            {isCurrentWeek && showPast
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
          </div>

          <aside className={showWeek ? "todo-side is-all" : "todo-side"}>
            {isCurrentWeek ? (
              <>
                <SchoolCard title="Сегодня в школе" day={todayDay} today={today} api={api} onOpenLesson={openDialog} />
                {yesterdayDay && classesOfDay(yesterdayDay).length ? (
                  <SchoolCard
                    title="Вчера"
                    day={yesterdayDay}
                    today={today}
                    quiet
                    past
                    api={api}
                    onOpenLesson={openDialog}
                  />
                ) : null}
                {showWeek
                  ? otherDays.map((day) => (
                      <SchoolCard
                        key={day.id}
                        title={dayCardTitle(day)}
                        day={day}
                        today={today}
                        quiet
                        api={api}
                        onOpenLesson={openDialog}
                      />
                    ))
                  : null}
                {otherDays.length ? (
                  <button
                    type="button"
                    className="btn btn-text dy-all"
                    aria-expanded={showWeek}
                    onClick={() => setShowWeek((value) => !value)}
                  >
                    {showWeek ? "Свернуть" : "Вся неделя"}
                  </button>
                ) : null}
              </>
            ) : (
              otherDays.map((day) => (
                <SchoolCard
                  key={day.id}
                  title={dayCardTitle(day)}
                  day={day}
                  today={today}
                  quiet
                  api={api}
                  onOpenLesson={openDialog}
                />
              ))
            )}
          </aside>
        </div>
      )}

      {week && today && (hasLessons || totalTasks > 0) ? (
        <>
          {showVideos ? <WeekVideos key={week.id} week={week} today={today} api={api} /> : null}
          <div className="page-foot">
            <button
              type="button"
              className="link"
              aria-expanded={showVideos}
              onClick={() => setShowVideos((value) => !value)}
            >
              {showVideos ? "Скрыть видео" : "Видео и трансляции"}
              {!showVideos && linkCount ? `, ${linkCount}` : ""}
            </button>
          </div>
        </>
      ) : null}

      <LessonDialog target={lessonTarget} api={api} onClose={() => setLessonTarget(null)} />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="dy-dialog">
          <DialogTitle className="dy-dialog-title">Применить шаблон?</DialogTitle>
          <DialogDescription className="dy-dialog-sub">
            Все оценки и задания недели {weekStart ? weekRangeLabel(weekStart) : ""} сбросятся, а
            уроки заполнятся из шаблона расписания. Вернуть всё можно кнопкой «Отменить».
          </DialogDescription>
          <div className="pop-acts">
            <button type="button" className="btn btn-main" disabled={api.applying} onClick={applyTemplate}>
              Применить
            </button>
            <button type="button" className="btn btn-text" onClick={() => setConfirmOpen(false)}>
              Отмена
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

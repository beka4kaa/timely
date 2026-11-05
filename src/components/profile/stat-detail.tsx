"use client";

// Что открывается под счётчиком: год занятий, часы, решения и места.

import Link from "next/link";
import { useEffect, useRef } from "react";

import { ru } from "@/lib/contest-view";
import type { Submission } from "@/lib/contest-api";
import type { PomodoroSummary } from "@/lib/pomodoro";
import {
  heatCells,
  hoursAndMinutes,
  monthAxis,
  weekBars,
  type DayActivity,
  type Streaks,
} from "@/lib/profile-view";
import { grouped } from "@/lib/rating-view";

const days = (n: number) => ru(n, "день", "дня", "дней");

export function DaysDetail({
  activity,
  streaks,
  now,
}: {
  activity: ReadonlyMap<string, DayActivity>;
  streaks: Streaks;
  now: Date;
}) {
  const cells = heatCells(activity, now);
  const scroller = useRef<HTMLDivElement>(null);

  // На телефоне год шире экрана, а смотреть хочется на последние недели.
  useEffect(() => {
    const element = scroller.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, []);

  return (
    <>
      <div className="pf-d-head">
        <h3>
          {streaks.current > 0
            ? `Серия ${streaks.current} ${days(streaks.current)} подряд`
            : `${grouped(streaks.total)} ${days(streaks.total)} занятий`}
        </h3>
        <span>
          лучшая {streaks.best}, всего {grouped(streaks.total)}
        </span>
      </div>
      <div
        ref={scroller}
        className="heat-wrap"
        tabIndex={0}
        role="img"
        aria-label={`Занятия за год по дням: всего ${streaks.total}`}
      >
        <div className="heat">
          {cells.map((cell) => (
            <i
              key={cell.key}
              className={`h${cell.level}${cell.future ? " future" : ""}${cell.today ? " today" : ""}`}
              title={cell.title || undefined}
            />
          ))}
        </div>
      </div>
    </>
  );
}

export function HoursDetail({ summary, now }: { summary: PomodoroSummary; now: Date }) {
  const bars = weekBars(summary.daily, now);
  const months = monthAxis(bars);
  const best = summary.best_day;
  const thisWeek = bars[bars.length - 1]?.seconds ?? 0;
  const inBars = bars.reduce((sum, bar) => sum + bar.seconds, 0);
  return (
    <>
      <div className="pf-d-head">
        <h3>{hoursAndMinutes(summary.total_seconds)} в фокусе</h3>
        <span>последние 12 недель</span>
      </div>
      <div className="pf-two">
        <div>
          <div className="pf-bars" aria-hidden="true">
            {bars.map((bar) => (
              <i
                key={bar.monday.getTime()}
                className={bar.now ? "now" : undefined}
                style={{ height: `${Math.max(3, bar.height)}%` }}
                title={hoursAndMinutes(bar.seconds)}
              />
            ))}
          </div>
          <div className="pf-axis" aria-hidden="true">
            {months.map((month) => (
              <span key={month}>{month}</span>
            ))}
          </div>
        </div>
        <ul className="pf-list pf-list-wide">
          <li>
            <span className="m">Эта неделя</span>
            <span />
            <b>{hoursAndMinutes(thisWeek)}</b>
          </li>
          <li>
            <span className="m">За 12 недель</span>
            <span />
            <b>{hoursAndMinutes(inBars)}</b>
          </li>
          {best ? (
            <li>
              <span className="m">Лучший день</span>
              <span className="m">{shortDay(`${best.date}T12:00:00`)}</span>
              <b>{hoursAndMinutes(best.seconds)}</b>
            </li>
          ) : null}
        </ul>
      </div>
    </>
  );
}

function shortDay(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short" })
    .format(new Date(iso))
    .replace(".", "");
}

export function TasksDetail({ solved, pending }: { solved: readonly Submission[]; pending: number }) {
  return (
    <>
      <div className="pf-d-head">
        <h3>
          {grouped(solved.length)} {ru(solved.length, "задача решена", "задачи решено", "задач решено")}
        </h3>
        {pending ? <span>ещё {pending} на проверке</span> : null}
      </div>
      <ul className="pf-list">
        {solved.slice(0, 5).map((row) => (
          <li key={row.id}>
            <span className="m">{shortDay(row.reviewed_at ?? row.created_at)}</span>
            <span>{row.task_title || "Задача"}</span>
            <b className="up">+{grouped(row.task_points)}</b>
          </li>
        ))}
      </ul>
    </>
  );
}

export interface PlaceLine {
  label: string;
  place: number;
}

export function PlaceDetail({ points, lines }: { points: number; lines: readonly PlaceLine[] }) {
  return (
    <>
      <div className="pf-d-head">
        <h3>Место {grouped(lines[0]?.place ?? 0)} среди всех</h3>
        <span>
          {grouped(points)} {ru(points, "балл", "балла", "баллов")}
        </span>
      </div>
      <ul className="pf-list pf-list-wide">
        {lines.map((line) => (
          <li key={line.label}>
            <span className="m">{line.label}</span>
            <span />
            <b>#{grouped(line.place)}</b>
          </li>
        ))}
      </ul>
      <p className="pf-more">
        <Link className="link" href="/dashboard/leaderboard">
          Открыть рейтинг
        </Link>
      </p>
    </>
  );
}

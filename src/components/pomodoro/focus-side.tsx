"use client";

// Боковая колонка помодоро: сегодня, сессии, неделя. Стопка карточек на настоящих данных.

import { useState } from "react";

import { DAY_GOAL_MIN, hm } from "@/lib/pomodoro";
import type { DayBar, HistoryRow, TodayStats } from "@/lib/pomodoro.logic";
import { sumSeconds } from "@/lib/pomodoro.logic";
import { cn } from "@/lib/utils";

export function TodayCard({ stats }: { stats: TodayStats }) {
  const goalHours = DAY_GOAL_MIN / 60;
  return (
    <section className="scard card">
      <h2>Сегодня</h2>
      <p className="fp-today">
        {hm(stats.focusSeconds)}
        <small>из {goalHours} ч</small>
      </p>
      <span
        className="tube"
        role="progressbar"
        aria-label="Цель на день"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={stats.goalPercent}
      >
        {stats.goalPercent > 0 ? <i style={{ width: `${stats.goalPercent}%` }} /> : null}
      </span>
    </section>
  );
}

export interface SessionRow {
  key: string;
  time: string;
  name: string;
  duration: string;
  isFocus: boolean;
  stoppedEarly: boolean;
}

export function sessionRowFrom(row: HistoryRow, name: string): SessionRow {
  return {
    key: String(row.id),
    time: row.time,
    name: row.isFocus ? name || "Фокус" : row.isLong ? "Длинный перерыв" : "Перерыв",
    duration: `${row.minutes} мин`,
    isFocus: row.isFocus,
    stoppedEarly: row.isFocus && row.stoppedEarly,
  };
}

export function SessionsCard({
  rows,
  loading,
  clearing,
  canClear,
  onClearDay,
}: {
  rows: SessionRow[];
  loading: boolean;
  clearing: boolean;
  /** Есть что стирать на сервере. Идущая сессия туда ещё не попала. */
  canClear: boolean;
  onClearDay: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="scard card">
      <h2>Сессии</h2>
      {rows.length ? (
        <ul className="sess">
          {rows.map((row) => (
            <li key={row.key}>
              <span className="m">{row.time}</span>
              <span className={cn(!row.isFocus && "muted")}>
                {row.name}
                {row.stoppedEarly ? <small>остановлена раньше</small> : null}
              </span>
              <span className="m">{row.duration}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small-note">
          {loading
            ? "Загружаю…"
            : "Сегодня пока пусто. Запусти таймер: сессии от минуты появятся здесь."}
        </p>
      )}
      {canClear ? (
        confirming ? (
          <div className="fp-clear" role="alert">
            <span className="small-note">Стереть сессии за сегодня? Вернуть их не получится.</span>
            <button
              className="btn btn-text danger"
              type="button"
              disabled={clearing}
              onClick={() => {
                onClearDay();
                setConfirming(false);
              }}
            >
              Стереть
            </button>
            <button className="btn btn-text" type="button" onClick={() => setConfirming(false)}>
              Не надо
            </button>
          </div>
        ) : (
          <div className="fp-clear">
            <button className="btn btn-text" type="button" disabled={clearing} onClick={() => setConfirming(true)}>
              {clearing ? "Стираю…" : "Очистить день"}
            </button>
          </div>
        )
      ) : null}
    </section>
  );
}

const WEEKDAY_NAMES = ["воскресенье", "понедельник", "вторник", "среду", "четверг", "пятницу", "субботу"];

export function WeekCard({ bars, loading }: { bars: DayBar[]; loading: boolean }) {
  const total = sumSeconds(bars);
  const best = bars.reduce<DayBar | null>(
    (current, bar) => (bar.seconds > (current?.seconds ?? 0) ? bar : current),
    null,
  );
  const summary = best
    ? `За неделю ${hm(total)}, больше всего в ${WEEKDAY_NAMES[best.date.getDay()]}`
    : "На этой неделе занятий пока не было";

  return (
    <section className="scard card">
      <h2>
        Неделя
        {total > 0 ? <small className="fp-week-total">{hm(total)}</small> : null}
      </h2>
      <div className="days7" role="img" aria-label={summary}>
        {bars.map((bar) => (
          <div
            key={bar.key}
            className={cn(bar.isToday && "today")}
            title={`${bar.tooltipSub}: ${bar.tooltipTitle.toLowerCase()}`}
          >
            {/* Самый длинный день занимает около 70% колонки, остальное остаётся подписи и воздуху. */}
            <i style={{ height: bar.seconds > 0 ? `${Math.round(bar.ratio * 70)}%` : undefined }} />
            {bar.label}
          </div>
        ))}
      </div>
      {!loading && !best ? <p className="small-note fp-week-note">Столбики вырастут после первой сессии.</p> : null}
    </section>
  );
}

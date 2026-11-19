"use client";

// Боковая колонка помодоро: сегодня, сессии, неделя. Стопка карточек на настоящих данных.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { msg, t } from "@/lib/i18n";

import { DAY_GOAL_MIN, dayKey, hm } from "@/lib/pomodoro";
import type { DayBar, HistoryRow, TodayStats } from "@/lib/pomodoro.logic";
import { sumSeconds } from "@/lib/pomodoro.logic";
import { cn } from "@/lib/utils";

export function TodayCard({ stats }: { stats: TodayStats }) {
  const goalHours = DAY_GOAL_MIN / 60;
  return (
    <section className="scard card">
      <h2>{t("Сегодня")}</h2>
      <p className="fp-today">
        {hm(stats.focusSeconds)}
        <small>{t("из {n} ч", { n: goalHours })}</small>
      </p>
      <span
        className="tube"
        role="progressbar"
        aria-label={t("Цель на день")}
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
    name: row.isFocus ? name || t("Фокус") : row.isLong ? t("Длинный перерыв") : t("Перерыв"),
    duration: t("{n} мин", { n: row.minutes }),
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
  const scrollRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  // Список длиннее карточки: низ мягко тает, пока ниже есть ещё строки.
  useEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const update = () => setMore(box.scrollHeight - box.scrollTop - box.clientHeight > 4);
    update();
    box.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(box);
    if (box.firstElementChild) observer.observe(box.firstElementChild);
    return () => {
      box.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [rows.length]);

  return (
    <section className="scard card fp-sess">
      <h2>{t("Сессии")}</h2>
      <div className="sess-scroll" ref={scrollRef} data-more={more || undefined}>
      {rows.length ? (
        <Link
          className="sess-link"
          href={`/dashboard/pomodoro/history/${dayKey(new Date())}`}
          title={t("Подробнее о сегодняшнем дне")}
        >
          <ul className="sess">
            {rows.map((row) => (
              <li key={row.key}>
                <span className="m">{row.time}</span>
                <span className={cn(!row.isFocus && "muted")}>
                  {row.name}
                  {row.stoppedEarly ? <small>{t("остановлена раньше")}</small> : null}
                </span>
                <span className="m">{row.duration}</span>
              </li>
            ))}
          </ul>
        </Link>
      ) : (
        <p className="small-note">
          {loading
            ? t("Загружаю…")
            : t("Сегодня пока пусто. Запусти таймер: сессии от минуты появятся здесь.")}
        </p>
      )}
      </div>
      <Link className="fh-all" href="/dashboard/pomodoro/history">
        {t("История занятий")}
        <Icon name="chev-r" />
      </Link>
      {canClear ? (
        confirming ? (
          <div className="fp-clear" role="alert">
            <span className="small-note">{t("Стереть сессии за сегодня? Вернуть их не получится.")}</span>
            <button
              className="btn btn-text danger"
              type="button"
              disabled={clearing}
              onClick={() => {
                onClearDay();
                setConfirming(false);
              }}
            >
              {t("Стереть")}
            </button>
            <button className="btn btn-text" type="button" onClick={() => setConfirming(false)}>
              {t("Не надо")}
            </button>
          </div>
        ) : (
          <div className="fp-clear">
            <button className="btn btn-text" type="button" disabled={clearing} onClick={() => setConfirming(true)}>
              {clearing ? t("Стираю…") : t("Очистить день")}
            </button>
          </div>
        )
      ) : null}
    </section>
  );
}

const WEEKDAY_NAMES = [
  msg("воскресенье"),
  msg("понедельник"),
  msg("вторник"),
  msg("среду"),
  msg("четверг"),
  msg("пятницу"),
  msg("субботу"),
];

export function WeekCard({ bars, loading }: { bars: DayBar[]; loading: boolean }) {
  const total = sumSeconds(bars);
  const best = bars.reduce<DayBar | null>(
    (current, bar) => (bar.seconds > (current?.seconds ?? 0) ? bar : current),
    null,
  );
  const summary = best
    ? t("За неделю {time}, больше всего в {day}", { time: hm(total), day: t(WEEKDAY_NAMES[best.date.getDay()]) })
    : t("На этой неделе занятий пока не было");

  return (
    <section className="scard card">
      <h2>
        {t("Неделя")}
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
      {!loading && !best ? <p className="small-note fp-week-note">{t("Столбики вырастут после первой сессии.")}</p> : null}
    </section>
  );
}

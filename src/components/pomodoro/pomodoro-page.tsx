"use client";

import { Flame, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

import { CoffeePageShell } from "@/components/dashboard/coffee-page-shell";
import {
  CHART_DAYS,
  EMPTY_SUMMARY,
  HEAT_WEEKS,
  dayKey,
  hm,
  streakLabel,
  type FocusSessionRow,
  type PomodoroSummary,
} from "@/lib/pomodoro";
import {
  buildChartBars,
  buildHeatWeeks,
  buildHistoryRows,
  buildTodayStats,
  buildWeekBars,
  sumSeconds,
} from "@/lib/pomodoro.logic";
import { clearDay, fetchSessions, fetchSummary } from "@/lib/pomodoro-api";
import {
  selectElapsed,
  selectHasStarted,
  selectPlanned,
  selectRemaining,
  usePomodoroStore,
} from "@/stores/pomodoro-store";

import { ActivityPanel } from "./activity-panel";
import { MetricsStrip, type Metric } from "./metrics-strip";
import { RhythmBar } from "./rhythm-bar";
import { SessionHistory } from "./session-history";
import { TimerDial } from "./timer-dial";
import { TodayCard } from "./today-card";
import { WeekChart } from "./week-chart";

// Сколько дней истории тянем для таблицы сессий: сегодня плюс запас на
// расхождение часовых поясов клиента и сервера.
const HISTORY_DAYS = 2;
const SUMMARY_DAYS = HEAT_WEEKS * 7;

export function PomodoroPage() {
  const { data: authSession } = useSession();
  const email = authSession?.user?.email ?? null;

  const [summary, setSummary] = useState<PomodoroSummary>(EMPTY_SUMMARY);
  const [sessions, setSessions] = useState<FocusSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const presetIdx = usePomodoroStore((state) => state.presetIdx);
  const phase = usePomodoroStore((state) => state.phase);
  const running = usePomodoroStore((state) => state.running);
  const cycles = usePomodoroStore((state) => state.cycles);
  const syncedAt = usePomodoroStore((state) => state.syncedAt);
  const remaining = usePomodoroStore(selectRemaining);
  const planned = usePomodoroStore(selectPlanned);
  const elapsed = usePomodoroStore(selectElapsed);
  const hasStarted = usePomodoroStore(selectHasStarted);
  const toggle = usePomodoroStore((state) => state.toggle);
  const skip = usePomodoroStore((state) => state.skip);
  const reset = usePomodoroStore((state) => state.reset);
  const choosePreset = usePomodoroStore((state) => state.choosePreset);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!email) return;
      try {
        const [nextSummary, nextSessions] = await Promise.all([
          fetchSummary(email, SUMMARY_DAYS, signal),
          fetchSessions(email, HISTORY_DAYS, signal),
        ]);
        if (signal?.aborted) return;
        setSummary(nextSummary);
        setSessions(nextSessions);
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Не удалось загрузить статистику",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [email],
  );

  useEffect(() => {
    if (!email) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
    // syncedAt растёт после отправки завершённой сессии — тогда перезагружаем.
  }, [email, load, syncedAt]);

  const today = useMemo(() => new Date(), []);
  const todayKey = dayKey(today);

  // Незавершённый фокус показываем в статистике «на лету», чтобы цифры росли
  // вместе с таймером, а не только после конца фазы.
  const liveSeconds = phase === "focus" ? elapsed : 0;

  const todaySessions = useMemo(
    () =>
      sessions.filter(
        (session) => dayKey(new Date(session.started_at)) === todayKey,
      ),
    [sessions, todayKey],
  );

  // Графики строятся из 364 ячеек календаря, поэтому в агрегаты живое время
  // добавляем с точностью до минуты: иначе всё это пересобиралось бы каждую
  // секунду тика. Карточка «Сегодня» при этом считает посекундно.
  const liveMinuteSeconds = Math.floor(liveSeconds / 60) * 60;

  const dailyWithLive = useMemo(() => {
    if (!liveMinuteSeconds) return summary.daily;
    return {
      ...summary.daily,
      [todayKey]: (summary.daily[todayKey] ?? 0) + liveMinuteSeconds,
    };
  }, [summary.daily, liveMinuteSeconds, todayKey]);

  const todayStats = useMemo(
    () => buildTodayStats(todaySessions, liveSeconds),
    [todaySessions, liveSeconds],
  );
  const weekBars = useMemo(
    () => buildWeekBars(dailyWithLive, today),
    [dailyWithLive, today],
  );
  const heatWeeks = useMemo(
    () => buildHeatWeeks(dailyWithLive, today),
    [dailyWithLive, today],
  );
  const chartBars = useMemo(
    () => buildChartBars(dailyWithLive, today, CHART_DAYS),
    [dailyWithLive, today],
  );
  const historyRows = useMemo(
    () => buildHistoryRows(todaySessions),
    [todaySessions],
  );

  const weekSeconds = sumSeconds(weekBars);

  const metrics: Metric[] = useMemo(() => {
    const activeDays = summary.active_days;
    const average = activeDays > 0 ? summary.total_seconds / activeDays : 0;
    return [
      { key: "streak", value: String(summary.streak), label: "дней подряд" },
      { key: "today", value: hm(todayStats.focusSeconds), label: "сегодня" },
      { key: "week", value: hm(weekSeconds), label: "за неделю" },
      { key: "active", value: String(activeDays), label: "активных дней" },
      { key: "average", value: hm(average), label: "в среднем за день" },
    ];
  }, [summary, todayStats.focusSeconds, weekSeconds]);

  const handleClearDay = useCallback(async () => {
    if (!email) return;
    setClearing(true);
    try {
      await clearDay(email, todayKey);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Не удалось очистить день",
      );
    } finally {
      setClearing(false);
    }
  }, [email, todayKey, load]);

  return (
    <CoffeePageShell
      eyebrow="Фокус"
      title="Помодоро"
      description="Выберите ритм, запустите таймер и следите, сколько времени вы отучились за день."
      icon={<Timer className="h-5 w-5" />}
      actions={
        <div className="flex items-center gap-2.5 rounded-[18px] border border-[#ded7cd] bg-[#fbfaf7] px-4 py-2.5 shadow-[0_8px_28px_rgba(67,50,31,0.05)]">
          <Flame className="h-4 w-4 text-[#a76b22]" />
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-[#9b9186]">
              Серия
            </p>
            <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#3a3530]">
              {streakLabel(summary.streak)}
            </p>
          </div>
        </div>
      }
    >
      {error && (
        <div className="mb-5 rounded-[14px] border border-[#e0c4c0] bg-[#fdf3f1] px-4 py-3 text-[12px] text-[#8c4b41]">
          {error}. Таймер продолжает работать, а сессии сохранятся, когда связь
          восстановится.
        </div>
      )}

      <RhythmBar presetIdx={presetIdx} onSelect={choosePreset} />

      <div className="grid items-start gap-5 lg:grid-cols-[1.35fr_1fr]">
        <TimerDial
          phase={phase}
          remaining={remaining}
          planned={planned}
          running={running}
          hasStarted={hasStarted}
          cycles={cycles}
          presetIdx={presetIdx}
          onToggle={toggle}
          onSkip={skip}
          onReset={reset}
        />

        <div className="flex flex-col gap-5">
          <TodayCard stats={todayStats} />
          {loading ? (
            <div className="h-[188px] animate-pulse rounded-[20px] border border-[#ddd7cd] bg-[#f3efe8]" />
          ) : (
            <WeekChart bars={weekBars} />
          )}
        </div>
      </div>

      <MetricsStrip metrics={metrics} />

      <ActivityPanel weeks={heatWeeks} bars={chartBars} />

      <SessionHistory
        rows={historyRows}
        weekSeconds={weekSeconds}
        clearing={clearing}
        onClearDay={handleClearDay}
      />
    </CoffeePageShell>
  );
}


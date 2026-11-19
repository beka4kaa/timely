"use client";

// Помодоро: циферблат по центру, стопка карточек сбоку и год снизу.
// Таймер живёт в сторе, эта страница только показывает его и статистику с сервера.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TTL, blocksKey, fetchBlocks } from "@/components/now/now-resources";
import { Icon } from "@/components/shell/icons";
import { t } from "@/lib/i18n";
import { openSettings } from "@/stores/settings-dialog";
import { isOpenBlock, splitBlockTitle } from "@/lib/now-feed";
import {
  EMPTY_SUMMARY,
  HEAT_WEEKS,
  dayKey,
  streakLabel,
  type FocusSessionRow,
  type PomodoroSummary,
} from "@/lib/pomodoro";
import { clearDay, fetchSessions, fetchSummary } from "@/lib/pomodoro-api";
import { cycleDots } from "@/lib/pomodoro-cycle";
import {
  buildHeatWeeks,
  buildHistoryRows,
  buildTodayStats,
  buildWeekBars,
  clockTime,
} from "@/lib/pomodoro.logic";
import { onSessionName, readSessionName, readSessionNames, sessionNameOf, writeSessionName } from "@/lib/pomodoro-names";
import { useResource } from "@/lib/resource-cache";
import { formatMinutes, zonedDateKey, zonedMinutes } from "@/lib/studyplan-calendar";
import { browserTimeZone, useNow } from "@/lib/use-now";
import {
  selectElapsed,
  selectHasStarted,
  selectPlanned,
  selectRemaining,
  selectRhythm,
  usePomodoroStore,
} from "@/stores/pomodoro-store";

import { SessionsCard, TodayCard, WeekCard, sessionRowFrom, type SessionRow } from "./focus-side";
import { START_LABEL, primeAlerts } from "./pomodoro-alerts";
import { PomodoroTip } from "./pomodoro-tip";
import { SessionName, type PlanOption } from "./session-name";
import { TimerDial } from "./timer-dial";
import { useFocusUser } from "./use-focus-user";
import { YearHeat } from "./year-heat";


// Сколько дней истории тянем для списка сессий: сегодня плюс запас на
// расхождение часовых поясов клиента и сервера.
const HISTORY_DAYS = 2;
const SUMMARY_DAYS = HEAT_WEEKS * 7;

export function PomodoroPage() {
  const email = useFocusUser();
  const now = useNow(60_000);

  const [summary, setSummary] = useState<PomodoroSummary>(EMPTY_SUMMARY);
  const [sessions, setSessions] = useState<FocusSessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [sessionName, setSessionName] = useState("");

  const phase = usePomodoroStore((state) => state.phase);
  const running = usePomodoroStore((state) => state.running);
  const syncedAt = usePomodoroStore((state) => state.syncedAt);
  const nowTs = usePomodoroStore((state) => state.nowTs);
  const phaseStartedAt = usePomodoroStore((state) => state.phaseStartedAt);
  const remaining = usePomodoroStore(selectRemaining);
  const planned = usePomodoroStore(selectPlanned);
  const elapsed = usePomodoroStore(selectElapsed);
  const hasStarted = usePomodoroStore(selectHasStarted);
  const rhythm = usePomodoroStore(selectRhythm);
  const done = usePomodoroStore((state) => state.done);
  const toggle = usePomodoroStore((state) => state.toggle);
  const skip = usePomodoroStore((state) => state.skip);
  const reset = usePomodoroStore((state) => state.reset);

  const cycle = useMemo(() => cycleDots(phase, done, rhythm.every), [phase, done, rhythm.every]);

  // «Над чем работаешь?» спрашиваем в момент старта, стеклянным полем прямо на месте
  // названия над цифрами. Пока таймер стоит, вопроса нет: он только мешает.
  // `leaving` держит поле на экране, пока играет анимация исчезновения.
  const [asking, setAsking] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const openAsk = useCallback(() => {
    clearTimeout(leaveTimer.current);
    setLeaving(false);
    setAsking(true);
  }, []);
  const closeAsk = useCallback(() => {
    setLeaving(true);
    clearTimeout(leaveTimer.current);
    leaveTimer.current = setTimeout(() => {
      setAsking(false);
      setLeaving(false);
    }, 180);
  }, []);
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  useEffect(() => {
    if (!asking || leaving) return;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target as Element | null)?.closest?.(".dial-edit")) closeAsk();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [asking, leaving, closeAsk]);

  const startOrPause = () => {
    // Звук и вопрос про уведомления браузер разрешает только изнутри клика.
    if (!running) primeAlerts();
    if (!running && !hasStarted && phase === "focus") openAsk();
    toggle();
  };

  // Название читается после монтирования: на сервере localStorage нет. Потом следим за
  // ним: его могли поменять в другой вкладке или на другом устройстве.
  useEffect(() => {
    setSessionName(readSessionName());
    return onSessionName(() => setSessionName(readSessionName()));
  }, []);

  const changeName = useCallback((name: string) => {
    setSessionName(name);
    writeSessionName(name);
  }, []);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!email) return;
      try {
        const [nextSummary, nextSessions] = await Promise.all([
          fetchSummary(SUMMARY_DAYS, signal),
          fetchSessions(HISTORY_DAYS, signal),
        ]);
        if (signal?.aborted) return;
        setSummary(nextSummary);
        setSessions(nextSessions);
        setError(null);
      } catch (cause) {
        if (signal?.aborted) return;
        setError(cause instanceof Error ? cause.message : t("Не удалось загрузить статистику"));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [email],
  );

  useEffect(() => {
    // Пока неизвестно, кто это, идёт загрузка, а не пустая статистика.
    if (!email) return;
    const controller = new AbortController();
    load(controller.signal);
    return () => controller.abort();
    // syncedAt растёт после отправки завершённой сессии — тогда перезагружаем.
  }, [email, load, syncedAt]);

  // Занятия из плана для выбора названия: тот же запрос и кэш, что у главной.
  const timeZone = useMemo(browserTimeZone, []);
  const zonedToday = now ? zonedDateKey(now, timeZone) : null;
  const blocks = useResource(
    zonedToday ? blocksKey(timeZone, zonedToday) : null,
    () => fetchBlocks(timeZone, zonedToday ?? ""),
    { ttl: TTL.day },
  );
  const planOptions = useMemo<PlanOption[]>(
    () =>
      (blocks.data ?? [])
        .filter((block) => zonedDateKey(block.start_at, timeZone) === zonedToday && isOpenBlock(block))
        .sort((a, b) => new Date(a.start_at).getTime() - new Date(b.start_at).getTime())
        .map((block) => ({
          id: block.id,
          name: splitBlockTitle(block.title).topic,
          time: formatMinutes(zonedMinutes(block.start_at, timeZone)),
        })),
    [blocks.data, timeZone, zonedToday],
  );

  const todayKey = now ? dayKey(now) : null;
  // Пересчёт по дню, а не по минуте: год это 364 клетки.
  const today = useMemo(() => (todayKey ? new Date(`${todayKey}T12:00:00`) : null), [todayKey]);

  // Незавершённый фокус показываем в статистике «на лету», чтобы цифры росли
  // вместе с таймером, а не только после конца фазы.
  const liveSeconds = phase === "focus" ? elapsed : 0;

  const todaySessions = useMemo(
    () => sessions.filter((session) => dayKey(new Date(session.started_at)) === todayKey),
    [sessions, todayKey],
  );

  // Графики строятся из 364 ячеек календаря, поэтому в агрегаты живое время
  // добавляем с точностью до минуты: иначе всё это пересобиралось бы каждую
  // секунду тика. Карточка «Сегодня» при этом считает посекундно.
  const liveMinuteSeconds = Math.floor(liveSeconds / 60) * 60;

  const dailyWithLive = useMemo(() => {
    if (!liveMinuteSeconds || !todayKey) return summary.daily;
    return {
      ...summary.daily,
      [todayKey]: (summary.daily[todayKey] ?? 0) + liveMinuteSeconds,
    };
  }, [summary.daily, liveMinuteSeconds, todayKey]);

  const todayStats = useMemo(() => buildTodayStats(todaySessions, liveSeconds), [todaySessions, liveSeconds]);
  const weekBars = useMemo(() => (today ? buildWeekBars(dailyWithLive, today) : []), [dailyWithLive, today]);
  const heatWeeks = useMemo(() => (today ? buildHeatWeeks(dailyWithLive, today) : []), [dailyWithLive, today]);

  const savedRows = useMemo(() => {
    const names = readSessionNames();
    return buildHistoryRows(todaySessions).map((row) => sessionRowFrom(row, sessionNameOf(names, row.startedAt)));
  }, [todaySessions]);

  // Идущая сессия на сервере появится только в конце, но человек видит её уже сейчас.
  const rows = useMemo<SessionRow[]>(() => {
    if (phase !== "focus" || !hasStarted || !phaseStartedAt) return savedRows;
    const minutes = Math.floor(elapsed / 60);
    return [
      {
        key: "live",
        time: clockTime(new Date(phaseStartedAt)),
        name: sessionName.trim() || t("Фокус"),
        duration: minutes > 0 ? t("{n} мин", { n: minutes }) : t("только что"),
        isFocus: true,
        stoppedEarly: false,
      },
      ...savedRows,
    ];
  }, [savedRows, phase, hasStarted, phaseStartedAt, elapsed, sessionName]);

  const handleClearDay = useCallback(async () => {
    if (!email || !todayKey) return;
    setClearing(true);
    try {
      await clearDay(todayKey);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Не удалось очистить день"));
    } finally {
      setClearing(false);
    }
  }, [email, todayKey, load]);

  return (
    <div className="content view">
      <header className="head fp-head">
        {/* Заголовок «Помодоро» уже есть в левой панели: здесь он только для читалок,
            а на его месте совет по отдыху или мотивация. */}
        <h1 className="sr-only">{t("Помодоро")}</h1>
        <PomodoroTip mode={phase !== "focus" ? "rest" : hasStarted ? "focus" : "any"} />
        <div className="head-tools">
          {summary.streak > 1 ? <span className="head-note">{t("{days} подряд", { days: streakLabel(summary.streak) })}</span> : null}
          {/* Ритм, звонок и уведомления: меняются редко, поэтому в настройках, а не под таймером */}
          <button
            className="icon-btn fp-gear"
            type="button"
            title={t("Настройки таймера")}
            aria-label={t("Настройки таймера")}
            onClick={() => openSettings("pomodoro")}
          >
            <Icon name="gear" />
          </button>
        </div>
      </header>

      {error ? (
        <div className="card fp-error" role="alert">
          <p>
            {error}
            {t(". Таймер работает, а сессии сохранятся, когда связь вернётся.")}
          </p>
          <button className="btn btn-line" type="button" onClick={() => void load()}>
            {t("Повторить")}
          </button>
        </div>
      ) : null}

      <div className="fp">
        <div className="fp-main">
          <TimerDial
            phase={phase}
            remaining={remaining}
            planned={planned}
            elapsed={elapsed}
            running={running}
            now={nowTs}
            cycle={cycle}
            name={hasStarted && phase === "focus" && !asking ? sessionName.trim() : ""}
            onName={openAsk}
            editor={
              asking ? (
                <div className="dial-edit" data-leaving={leaving || undefined}>
                  <SessionName value={sessionName} onChange={changeName} options={planOptions} onDone={closeAsk} />
                </div>
              ) : null
            }
          />
          <div className="fp-ctrl">
            <button className="btn btn-main fp-start" type="button" onClick={startOrPause}>
              {running ? t("Пауза") : hasStarted ? t("Продолжить") : t(START_LABEL[phase])}
            </button>
            {/* До старта можно только пропустить фазу, после — только сбросить её.
                Обе кнопки в одной ячейке и сменяют друг друга, ничего не прыгает. */}
            <span className="fp-swap">
              <button
                className="btn btn-text"
                type="button"
                title={t("Перейти к следующей фазе")}
                data-on={!hasStarted || undefined}
                aria-hidden={hasStarted || undefined}
                disabled={hasStarted}
                onClick={skip}
              >
                {t("Пропустить")}
              </button>
              <button
                className="btn btn-text"
                type="button"
                title={t("Остановить и начать эту фазу заново")}
                data-on={hasStarted || undefined}
                aria-hidden={!hasStarted || undefined}
                disabled={!hasStarted}
                onClick={reset}
              >
                {t("Сбросить")}
              </button>
            </span>
          </div>
        </div>

      </div>

      {/* Под таймером пара колонок одной высоты: слева итог дня и неделя, справа сессии.
          Длинный список сессий прокручивается внутри своей карточки. */}
      {now ? (
        <div className="fp-cards">
          <div className="fp-col">
            <TodayCard stats={todayStats} />
            <WeekCard bars={weekBars} loading={loading} />
          </div>
          <SessionsCard
            rows={rows}
            loading={loading}
            clearing={clearing}
            canClear={savedRows.length > 0}
            onClearDay={() => void handleClearDay()}
          />
        </div>
      ) : null}

      {now ? <YearHeat weeks={heatWeeks} loading={loading} /> : null}
    </div>
  );
}

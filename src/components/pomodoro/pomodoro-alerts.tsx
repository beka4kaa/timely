"use client";

// Чем таймер зовёт ученика: отсчёт в заголовке вкладки, звонок, системное уведомление
// и плашка «Пора на перерыв» на любой странице дашборда.
//
// Живёт в layout рядом с `PomodoroSync`, поэтому работает, на какой бы странице ни
// был ученик и даже на свёрнутой вкладке. Сам ничего не решает: когда фаза кончилась,
// пишет стор, а здесь только показывают и звонят.

import Link from "next/link";
import { useEffect, useRef } from "react";

import { dashboardViewOf } from "@/config/dashboard-navigation";
import { bellUnlocked, ringBell, unlockBell } from "@/lib/pomodoro-bell";
import { alarmNotice, alarmTitle, ringBursts, shouldNotify, tabTitle, type TimerPhase } from "@/lib/pomodoro-cycle";
import { readSessionName } from "@/lib/pomodoro-names";
import { askNoticePermission, noticePermission, showNotice, type NoticeHandle } from "@/lib/pomodoro-notify";
import { useDashboardPath } from "@/lib/use-dashboard-path";
import {
  selectHasStarted,
  selectRemaining,
  selectRhythm,
  selectWaiting,
  usePomodoroStore,
} from "@/stores/pomodoro-store";

const POMODORO_HREF = "/dashboard/pomodoro";

/**
 * Всё, что браузер разрешает только по клику: звук и вопрос про уведомления.
 * Звать прямо в обработчике кнопки, которая запускает таймер.
 */
export function primeAlerts(): void {
  const state = usePomodoroStore.getState();
  if (state.sound) unlockBell();
  if (state.notify && !state.notifyAsked && noticePermission() === "default") {
    state.setPrefs({ notifyAsked: true });
    void askNoticePermission();
  }
}

/** Кнопка, которая запускает следующую фазу, когда та ждёт. */
export const START_LABEL: Record<TimerPhase, string> = {
  focus: "Начать",
  break: "Начать перерыв",
  long: "Начать длинный перерыв",
};

export function PomodoroAlerts() {
  useTabTitle();
  useUnlockOnTouch();
  useBell();
  useAlarmNotice();
  return <AlarmBar />;
}

/**
 * После перезагрузки звук снова заперт до первого жеста. Пока таймер начат или звенит,
 * любой клик или клавиша на странице его отпирают, чтобы конец фазы был слышен, даже
 * если «Начать» нажимали ещё до перезагрузки. Без таймера звуковой поток не открываем.
 */
function useUnlockOnTouch() {
  useEffect(() => {
    const unlock = () => {
      const state = usePomodoroStore.getState();
      if (!state.sound || bellUnlocked()) return;
      if (!state.running && state.phaseStartedAt === null && !state.alarm) return;
      unlockBell();
    };
    // Мышь даёт браузеру разрешение на нажатии, палец на отпускании.
    const events = ["pointerdown", "pointerup", "keydown"] as const;
    for (const name of events) window.addEventListener(name, unlock, true);
    return () => {
      for (const name of events) window.removeEventListener(name, unlock, true);
    };
  }, []);
}

/**
 * «24:13 · Фокус» в заголовке вкладки. Заголовок страницы запоминается и возвращается,
 * когда таймер стоит; сменила страница свой заголовок при переходе, и отсчёт
 * возвращается сразу, без секундной вспышки.
 */
function useTabTitle() {
  useEffect(() => {
    let owned: string | null = null;
    let base = document.title;

    const apply = () => {
      const live = document.title;
      if (owned === null || live !== owned) base = live;
      const state = usePomodoroStore.getState();
      if (!state.nowTs) return;
      const desired = tabTitle({
        phase: state.phase,
        remaining: selectRemaining(state),
        running: state.running,
        started: selectHasStarted(state),
        alarm: state.alarm,
        base,
        blink: Math.floor(state.nowTs / 1000) % 2 === 0,
      });
      if (desired === base) {
        if (owned !== null && live === owned) document.title = base;
        owned = null;
        return;
      }
      if (live !== desired) document.title = desired;
      owned = desired;
    };

    apply();
    const unsubscribe = usePomodoroStore.subscribe(apply);
    const observer = new MutationObserver(() => {
      if (document.title !== owned) apply();
    });
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => {
      unsubscribe();
      observer.disconnect();
      if (owned !== null && document.title === owned) document.title = base;
    };
  }, []);
}

/** Звонок в каждой вкладке, где звук разблокирован. «Тихо» в любой из них глушит все. */
function useBell() {
  const at = usePomodoroStore((state) => state.alarm?.at ?? null);
  const auto = usePomodoroStore((state) => state.alarm?.auto ?? false);
  const sound = usePomodoroStore((state) => state.sound);
  const volume = usePomodoroStore((state) => state.volume);

  useEffect(() => {
    if (at === null || !sound) return;
    const alarm = usePomodoroStore.getState().alarm;
    if (!alarm) return;
    return ringBell(volume, ringBursts(alarm, Date.now()));
  }, [at, auto, sound, volume]);
}

/**
 * Системное уведомление. Показывает только ведущая вкладка, чтобы не было двух.
 * Ученик начал перерыв или нажал «Тихо»: уведомление убирается, оно уже не нужно.
 */
function useAlarmNotice() {
  const leader = usePomodoroStore((state) => state.leader);
  const notify = usePomodoroStore((state) => state.notify);
  const at = usePomodoroStore((state) => state.alarm?.at ?? null);
  const notifiedAt = usePomodoroStore((state) => state.notifiedAt);
  const shown = useRef<{ at: number; auto: boolean; note: NoticeHandle | null } | null>(null);

  useEffect(() => {
    if (!leader || !notify) return;
    const state = usePomodoroStore.getState();
    const alarm = state.alarm;
    // Уже показано (в этой вкладке, в другой или до перезагрузки) или кончилась давно.
    if (!alarm || !shouldNotify(alarm, state.notifiedAt, Date.now())) return;
    state.markNotified(alarm.at);
    const entry = { at: alarm.at, auto: alarm.auto, note: null as NoticeHandle | null };
    shown.current = entry;
    void showNotice(alarmNotice(alarm.next, selectRhythm(state), readSessionName()), () =>
      usePomodoroStore.getState().dismissAlarm(),
    ).then((note) => {
      entry.note = note;
      // Пока уведомление появлялось, ученик уже начал следующую фазу или нажал «Тихо».
      if (note && !entry.auto && usePomodoroStore.getState().alarm?.at !== entry.at) note.close();
    });
  }, [leader, notify, at, notifiedAt]);

  useEffect(() => {
    if (at !== null) return;
    const entry = shown.current;
    if (entry && !entry.auto) entry.note?.close();
  }, [at]);
}

/** На других страницах: «Пора на перерыв!», начать или замолчать, не уходя со страницы. */
function AlarmBar() {
  const path = useDashboardPath();
  const waiting = usePomodoroStore(selectWaiting);
  const next = usePomodoroStore((state) => state.alarm?.next ?? null);
  const toggle = usePomodoroStore((state) => state.toggle);
  const dismissAlarm = usePomodoroStore((state) => state.dismissAlarm);

  // На самой странице таймера те же кнопки уже под циферблатом.
  if (!waiting || next === null || dashboardViewOf(path) === "focus") return null;

  return (
    <div className="fp-alarm">
      <div className="fp-alarm-in glass" role="alert">
        <Link className="fp-alarm-t" href={POMODORO_HREF}>
          {alarmTitle(next)}
        </Link>
        <button
          className="btn btn-main"
          type="button"
          onClick={() => {
            primeAlerts();
            toggle();
          }}
        >
          Начать
        </button>
        <button className="btn btn-text" type="button" onClick={dismissAlarm}>
          Тихо
        </button>
      </div>
    </div>
  );
}

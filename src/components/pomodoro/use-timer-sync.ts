"use client";

// Идущий таймер на всех устройствах ученика.
//
// Ведущая вкладка отправляет таймер на сервер, как только он меняется (старт, пауза,
// пропуск, конец фазы, название), и забирает чужие изменения: сразу при открытии, при
// возвращении на вкладку и раз в 15 секунд. Сервер хранит версию; запись поверх старой
// версии он отклоняет и отдаёт свежую, и тогда устройство берёт её. Остальные вкладки
// этого браузера получают таймер от ведущей через хранилище, как и раньше.

import { useEffect } from "react";

import { inDemoBrowser } from "@/lib/demo-mock/host";
import { fetchTimerState, saveTimerState } from "@/lib/pomodoro-api";
import { onSessionName, readSessionName, writeSessionName } from "@/lib/pomodoro-names";
import { remoteTimer, timerSnapshot } from "@/lib/pomodoro-remote";
import { usePomodoroStore } from "@/stores/pomodoro-store";

const MARK_KEY = "timely:pomodoro:remote";
const POLL_MS = 15_000;
const PUSH_DELAY_MS = 400;
const RETRY_MS = 10_000;

/** Какая версия сервера у этого браузера и какой таймер с ней совпадает. */
interface Mark {
  email: string;
  version: number;
  sent: string;
}

function readMark(email: string): Mark {
  try {
    const saved = JSON.parse(window.localStorage.getItem(MARK_KEY) ?? "null") as Partial<Mark> | null;
    if (saved && saved.email === email && Number.isInteger(saved.version) && typeof saved.sent === "string") {
      return { email, version: saved.version as number, sent: saved.sent };
    }
  } catch {
    // Испорченная запись: начнём с нуля, сервер подскажет версию.
  }
  return { email, version: 0, sent: "" };
}

function writeMark(mark: Mark): void {
  try {
    window.localStorage.setItem(MARK_KEY, JSON.stringify(mark));
  } catch {
    // Без хранилища версия живёт до перезагрузки.
  }
}

export function useTimerSync(email: string | null, leader: boolean): void {
  useEffect(() => {
    if (!email || !leader || inDemoBrowser()) return;
    let mark = readMark(email);
    let pushTimer: number | undefined;
    let inflight = false;
    let adopting = false;
    let stopped = false;

    const local = () => JSON.stringify(timerSnapshot(usePomodoroStore.getState(), readSessionName()));
    const remember = (version: number, sent: string) => {
      mark = { email, version, sent };
      writeMark(mark);
    };

    /** Берёт таймер с сервера. Испорченную запись не берёт: при следующей отправке её перезапишем. */
    const adopt = (state: unknown, version: number) => {
      const remote = remoteTimer(state);
      if (!remote) {
        remember(version, "");
        return;
      }
      adopting = true;
      try {
        usePomodoroStore.getState().adoptRemote(remote);
        writeSessionName(remote.name);
      } finally {
        adopting = false;
      }
      remember(version, JSON.stringify(remote));
    };

    const schedule = (delay = PUSH_DELAY_MS) => {
      if (stopped || pushTimer !== undefined) return;
      pushTimer = window.setTimeout(() => {
        pushTimer = undefined;
        void push();
      }, delay);
    };

    const push = async () => {
      if (stopped) return;
      if (inflight) return schedule();
      const sent = local();
      if (sent === mark.sent) return;
      inflight = true;
      try {
        const result = await saveTimerState(JSON.parse(sent), mark.version);
        if (stopped) return;
        if (result.ok) remember(result.version, sent);
        else adopt(result.current.state, result.current.version);
      } catch {
        // Нет сети или сервер недоступен: попробуем позже, таймер идёт и без него.
        inflight = false;
        return schedule(RETRY_MS);
      }
      inflight = false;
      // Пока ответ шёл, таймер могли поменять ещё раз.
      if (local() !== mark.sent) schedule();
    };

    const pull = async () => {
      if (stopped || inflight || pushTimer !== undefined) return;
      try {
        const remote = await fetchTimerState();
        if (stopped || inflight || pushTimer !== undefined) return;
        if (remote.version > mark.version) adopt(remote.state, remote.version);
        // На сервере версия меньше нашей: его таймер стёрли. Отправим свой заново.
        else if (remote.version < mark.version) remember(remote.version, "");
        if (local() !== mark.sent) schedule();
      } catch {
        // Без сети остаётся свой таймер.
      }
    };

    const onChange = () => {
      if (!adopting && local() !== mark.sent) schedule();
    };
    const unsubscribe = usePomodoroStore.subscribe(onChange);
    const offName = onSessionName(onChange);
    const onVisible = () => {
      if (document.visibilityState === "visible") void pull();
    };
    const onOnline = () => void pull();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onOnline);
    window.addEventListener("online", onOnline);
    const poll = window.setInterval(() => void pull(), POLL_MS);
    void pull();

    return () => {
      stopped = true;
      window.clearTimeout(pushTimer);
      window.clearInterval(poll);
      unsubscribe();
      offName();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onOnline);
      window.removeEventListener("online", onOnline);
    };
  }, [email, leader]);
}

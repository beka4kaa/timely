"use client";

// Невидимый компонент: держит секундный тик помодоро и отправляет завершённые
// фазы на бэкенд.
//
// Монтируется в layout дашборда: таймер и слайм должны знать о сессии на любой
// странице, а не только на странице помодоро.

import { useEffect, useRef, useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { createSession } from "@/lib/pomodoro-api";
import { readSessionName, rememberSessionName } from "@/lib/pomodoro-names";
import { usePomodoroStore } from "@/stores/pomodoro-store";

import { useFocusUser } from "./use-focus-user";

export function PomodoroSync() {
  const email = useFocusUser();
  const tick = usePomodoroStore((state) => state.tick);
  const pending = usePomodoroStore((state) => state.pending);
  const dropPending = usePomodoroStore((state) => state.dropPending);
  const focusing = usePomodoroStore((state) => state.running && state.phase === "focus");
  const flushing = useRef(false);
  const named = useRef(new Set<string>());
  const mascotFocused = useRef(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [tick]);

  // Слайм собран, пока идёт фокус. Маскот монтируется позже этого компонента, поэтому
  // вызов откладывается: иначе после перезагрузки посреди сессии он бы об этом не узнал.
  useEffect(() => {
    if (focusing === mascotFocused.current) return;
    const timer = window.setTimeout(() => {
      mascotFocused.current = focusing;
      mascot.focus(focusing);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusing]);

  // Имя сессии на сервер не уходит, запоминаем его в браузере в момент окончания фазы.
  useEffect(() => {
    for (const item of pending) {
      if (item.kind !== "focus" || named.current.has(item.localId)) continue;
      named.current.add(item.localId);
      rememberSessionName(item.started_at, readSessionName());
    }
  }, [pending]);

  useEffect(() => {
    if (!email || !pending.length || flushing.current) return;

    let retryTimer = 0;
    flushing.current = true;

    (async () => {
      const sent: string[] = [];
      let failed = false;

      try {
        for (const item of pending) {
          const { localId, ...payload } = item;
          await createSession(payload);
          sent.push(localId);
        }
      } catch {
        // Неотправленное остаётся в очереди: она персистится, поэтому сессия
        // переживёт перезагрузку и уйдёт на сервер при следующей попытке.
        failed = true;
      } finally {
        flushing.current = false;
        // Отправленное убираем всегда, даже если компонент уже размонтирован,
        // иначе те же сессии уйдут на сервер повторно.
        if (sent.length) dropPending(sent);
        if (failed) {
          retryTimer = window.setTimeout(() => setRetryTick((n) => n + 1), 30_000);
        }
      }
    })();

    return () => {
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [email, pending, dropPending, retryTick]);

  return null;
}

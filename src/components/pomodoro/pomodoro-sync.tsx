"use client";

// Невидимый компонент: держит секундный тик помодоро и отправляет завершённые
// фазы на бэкенд.
//
// Монтируется в layout дашборда, а не в шапку: `SiteHeader` возвращает `null`
// на научной доске, и таймер бы вставал при переходе туда.

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

import { createSession } from "@/lib/pomodoro-api";
import { usePomodoroStore } from "@/stores/pomodoro-store";

export function PomodoroSync() {
  const { data: session } = useSession();
  const email = session?.user?.email ?? null;
  const tick = usePomodoroStore((state) => state.tick);
  const pending = usePomodoroStore((state) => state.pending);
  const dropPending = usePomodoroStore((state) => state.dropPending);
  const flushing = useRef(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [tick]);

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
          await createSession(email, payload);
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

"use client";

// Невидимый компонент: держит секундный тик помодоро, договаривается с другими
// вкладками и отправляет завершённые фазы на бэкенд.
//
// Монтируется в layout дашборда: таймер и слайм должны знать о сессии на любой
// странице, а не только на странице помодоро.

import { useEffect, useRef, useState } from "react";

import { mascot } from "@/components/shell/mascot/mascot";
import { createSession } from "@/lib/pomodoro-api";
import { readSessionName, rememberSessionName } from "@/lib/pomodoro-names";
import { leadTimer, startTicker } from "@/lib/pomodoro-tabs";
import { POMODORO_STORAGE_KEY, POMODORO_STORAGE_VERSION, usePomodoroStore } from "@/stores/pomodoro-store";

import { useFocusUser } from "./use-focus-user";

/**
 * Сколько новая ведущая вкладка ждёт перед первой отправкой: прошлая могла ещё ждать
 * ответа на свою, и без паузы та же сессия ушла бы дважды.
 */
const LEADER_SETTLE_MS = 1500;

/** Версия сохранённого состояния в записи другой вкладки. */
function storedVersion(raw: string | null): number {
  try {
    const version: unknown = raw ? JSON.parse(raw)?.version : null;
    return typeof version === "number" ? version : 0;
  } catch {
    return 0;
  }
}

export function PomodoroSync() {
  const email = useFocusUser();
  const leader = usePomodoroStore((state) => state.leader);
  const pending = usePomodoroStore((state) => state.pending);
  const dropPending = usePomodoroStore((state) => state.dropPending);
  const focusing = usePomodoroStore((state) => state.running && state.phase === "focus");
  const flushing = useRef(false);
  const named = useRef(new Set<string>());
  const mascotFocused = useRef(false);
  const leaderSince = useRef(0);
  const [retryTick, setRetryTick] = useState(0);

  // Тик из воркера: на свёрнутой вкладке он не замедляется. Вернулся на вкладку,
  // и время подтягивается сразу, не дожидаясь следующей секунды.
  useEffect(() => {
    const beat = () => usePomodoroStore.getState().tick();
    beat();
    const stop = startTicker(beat);
    const onVisibility = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Какая вкладка ведёт таймер. Новая ведущая сразу доделывает пропущенное.
  useEffect(
    () =>
      leadTimer((on) => {
        const state = usePomodoroStore.getState();
        if (on && !state.leader) leaderSince.current = Date.now();
        state.setLeader(on);
        if (on) state.tick();
      }),
    [],
  );

  // Другая вкладка что-то поменяла: нажали «Тихо», начали перерыв, закончилась фаза.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== POMODORO_STORAGE_KEY) return;
      // Вкладка со старой сборкой пишет своё каждую секунду, и цикл здесь сбрасывался бы
      // вслед за ней. Её записи пропускаем: она перейдёт на новую при перезагрузке.
      if (storedVersion(event.newValue) < POMODORO_STORAGE_VERSION) return;
      void usePomodoroStore.persist.rehydrate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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

  // Отправляет только ведущая вкладка: очередь общая, и две вкладки отправили бы её дважды.
  useEffect(() => {
    if (!leader || !email || !pending.length || flushing.current) return;

    const settle = leaderSince.current + LEADER_SETTLE_MS - Date.now();
    if (settle > 0) {
      const timer = window.setTimeout(() => setRetryTick((n) => n + 1), settle);
      return () => window.clearTimeout(timer);
    }

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
  }, [leader, email, pending, dropPending, retryTick]);

  return null;
}

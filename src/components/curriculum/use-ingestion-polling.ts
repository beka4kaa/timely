// Опрос статуса обработки.
//
// Три вещи, из-за которых это не `setInterval` в три строки:
//
//  1. Обработка длится от секунд до минут, поэтому частота падает со временем
//     (`pollDelayMs`) — на пятой минуте двухсекундный опрос только греет сеть.
//  2. В фоновой вкладке опрашивать незачем: браузер всё равно троттлит таймеры,
//     а запросы уходят. Останавливаемся по `visibilitychange` и делаем
//     немедленный опрос при возврате, чтобы человек увидел свежее состояние.
//  3. Обрыв связи — не повод сдаваться. Редеплой бэкенда посреди обработки это
//     норма, поэтому повторяем с растущей паузой и говорим о проблеме только
//     после нескольких неудач подряд.

"use client";

import { useEffect, useRef, useState } from "react";

import {
  FAILURES_BEFORE_WARNING,
  pollDelayMs,
  retryDelayMs,
} from "@/lib/curriculum-progress";

interface Options {
  /** Опрашивать ли сейчас. Выключается, когда шаг мастера сменился. */
  enabled: boolean;
  /** Один запрос статуса. Должен бросать исключение при сетевой ошибке. */
  poll: () => Promise<{ is_terminal: boolean } | null>;
}

export interface PollingState {
  /** Сколько идёт обработка, мс. Для «2:05» на экране. */
  elapsedMs: number;
  /** Связь потеряна: несколько неудачных попыток подряд. */
  disconnected: boolean;
  failures: number;
}

export function useIngestionPolling({ enabled, poll }: Options): PollingState {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [failures, setFailures] = useState(0);

  // Свежая ссылка на `poll` без перезапуска цикла: замыкание в setTimeout иначе
  // держало бы первую версию функции со старым состоянием стора.
  const pollRef = useRef(poll);
  pollRef.current = poll;

  useEffect(() => {
    if (!enabled) {
      setElapsedMs(0);
      setFailures(0);
      return;
    }

    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    let consecutiveFailures = 0;

    const schedule = (delay: number) => {
      if (stopped) return;
      timer = setTimeout(run, delay);
    };

    const run = async () => {
      if (stopped) return;
      if (document.visibilityState === "hidden") {
        // Вкладка в фоне: не тратим запросы, вернёмся по visibilitychange.
        schedule(5_000);
        return;
      }

      const elapsed = Date.now() - startedAt;
      setElapsedMs(elapsed);

      try {
        const state = await pollRef.current();
        if (stopped) return;
        consecutiveFailures = 0;
        setFailures(0);
        if (state?.is_terminal) return; // дальше опрашивать нечего
        schedule(pollDelayMs(elapsed));
      } catch {
        if (stopped) return;
        consecutiveFailures += 1;
        setFailures(consecutiveFailures);
        schedule(retryDelayMs(consecutiveFailures));
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== "visible" || stopped) return;
      if (timer) clearTimeout(timer);
      void run();
    };

    void run();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled]);

  // Секундомер идёт отдельно от опроса: на десятисекундном интервале время на
  // экране иначе дёргалось бы рывками по десять секунд.
  useEffect(() => {
    if (!enabled) return;
    const startedAt = Date.now() - elapsedMs;
    const ticker = setInterval(() => setElapsedMs(Date.now() - startedAt), 1_000);
    return () => clearInterval(ticker);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return {
    elapsedMs,
    disconnected: failures >= FAILURES_BEFORE_WARNING,
    failures,
  };
}

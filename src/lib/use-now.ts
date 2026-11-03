"use client";

// Текущее время, которое само обновляется.
//
// `null` до монтирования: время на сервере и в браузере разное, и разметка,
// отрисованная с ним, разошлась бы при гидратации. Компоненты рисуют
// заглушку, пока время не известно.

import { useEffect, useState } from "react";

export function useNow(intervalMs = 30_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = window.setInterval(tick, intervalMs);
    // Вкладка могла простоять в фоне час: таймеры там троттлятся, и линия
    // «сейчас» осталась бы там, где ученик её оставил.
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);

  return now;
}

/** Зона браузера — зона, в которой ученик видит часы. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

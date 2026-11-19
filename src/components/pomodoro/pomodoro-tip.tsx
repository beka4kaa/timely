"use client";

// Строка над таймером вместо заголовка «Помодоро», который и так написан в левой панели.
// Совет по отдыху или короткая мотивация: сама меняется раз в минуту с небольшим,
// по нажатию сразу. Смена плавная: старая строка тает, новая проявляется.

import { useCallback, useEffect, useRef, useState } from "react";

import { t } from "@/lib/i18n";
import { TIPS, TIP_INTERVAL_MS, nextTip, quoted, type TipKind } from "@/lib/pomodoro-tips";

const OUT_MS = 260;

export function PomodoroTip({ mode }: { mode: TipKind | "any" }) {
  const [index, setIndex] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);
  const indexRef = useRef<number | null>(null);
  indexRef.current = index;
  const swapTimer = useRef<ReturnType<typeof setTimeout>>();

  const swap = useCallback(() => {
    clearTimeout(swapTimer.current);
    setLeaving(true);
    swapTimer.current = setTimeout(() => {
      setIndex(nextTip(indexRef.current, mode));
      setLeaving(false);
    }, OUT_MS);
  }, [mode]);

  // Первый совет выбирается в браузере: на сервере случайный выбор разошёлся бы с клиентом.
  useEffect(() => {
    setIndex(nextTip(null, mode));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Началась другая фаза, а на экране совет не про неё: меняем сразу.
  useEffect(() => {
    const current = indexRef.current;
    if (current !== null && mode !== "any" && TIPS[current].kind !== mode) swap();
  }, [mode, swap]);

  // Сама строка меняется редко и только в открытой вкладке.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) swap();
    }, TIP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [swap]);

  useEffect(() => () => clearTimeout(swapTimer.current), []);

  return (
    <button className="fp-tip" type="button" title={t("Другой совет")} onClick={swap}>
      <span className="fp-tip-t" data-leaving={leaving || undefined} key={index ?? "none"} aria-live="polite">
        {index === null ? " " : quoted(t(TIPS[index].text))}
      </span>
    </button>
  );
}

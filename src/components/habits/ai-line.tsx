"use client";

// Строка «напиши своими словами» и то, что происходит, пока модель думает.
// Одна на цели и привычки: страницы отличаются только тем, что делают с ответом.

import { useCallback, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { mascot } from "@/components/shell/mascot/mascot";
import { useSmoothInput } from "@/components/shell/smooth-input";
import { understand, type Understood, type UnderstoodKind } from "@/lib/understand";

const STEP_MS = 900;

export function AiLine({
  placeholder,
  short,
  label,
  onAsk,
}: {
  placeholder: string;
  short: string;
  label: string;
  onAsk: (text: string) => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [phone, setPhone] = useState(false);
  useSmoothInput(field);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const sync = () => setPhone(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <form
      className="ai-line glass"
      onSubmit={(event) => {
        event.preventDefault();
        const text = value.trim();
        if (!text) return;
        setValue("");
        onAsk(text);
      }}
    >
      <span className="ti-host">
        <input
          ref={field}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder={phone ? short : placeholder}
          aria-label={label}
          autoComplete="off"
        />
      </span>
      <button className="send" type="submit" aria-label="Отправить">
        <Icon name="arrow-up" />
      </button>
    </form>
  );
}

/**
 * Разбирает текст и показывает работу через слайма. Слайма можно остановить: тогда ответа
 * не будет, а если он всё же придёт, его никто не увидит. Сам разбор ничего не сохраняет.
 */
export function useUnderstand(expect: UnderstoodKind, steps: readonly string[]) {
  const [thinking, setThinking] = useState(false);
  // Текущий разбор. Новый запрос или остановка делают прежний чужим.
  const current = useRef<object | null>(null);

  useEffect(
    () => () => {
      if (current.current) mascot.thinkEnd();
      current.current = null;
    },
    [],
  );

  const ask = useCallback(
    async (text: string, done: (result: Understood) => void) => {
      const mine = {};
      current.current = mine;
      setThinking(true);
      mascot.thinkStart(text, () => {
        if (current.current !== mine) return;
        current.current = null;
        setThinking(false);
      });
      mascot.thought(steps[0]);
      const timers = steps.slice(1).map((step, index) =>
        window.setTimeout(() => {
          if (current.current === mine) mascot.thought(step);
        }, STEP_MS * (index + 1)),
      );
      const result = await understand(text, expect);
      timers.forEach((timer) => window.clearTimeout(timer));
      if (current.current !== mine) return;
      current.current = null;
      mascot.thinkEnd("Готово");
      setThinking(false);
      done(result);
    },
    [expect, steps],
  );

  return { thinking, ask };
}

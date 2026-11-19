"use client";

// «Поделиться» над перепиской: на телефоне системное меню, на компьютере текст чата в буфер.
// Ссылки на чат нет, уходит только текст, и только туда, куда его отправит сам ученик.

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";

import { canShareChat, chatShareText, type ShareTurn } from "./chat-share";
import { chatTitle } from "./chat-title";

type Done = "copied" | "failed" | null;

export function ShareChat({
  title,
  turns,
  disabled,
}: {
  title: string | null | undefined;
  turns: ShareTurn[];
  disabled?: boolean;
}) {
  const [done, setDone] = useState<Done>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);

  const flash = (value: Done) => {
    setDone(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setDone(null), 1800);
  };

  const share = async () => {
    const text = chatShareText(title, turns);
    if (typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: chatTitle(title), text });
        return;
      } catch (error) {
        // Закрыл меню сам: ничего не случилось и копировать молча не нужно.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      flash("copied");
    } catch {
      flash("failed");
    }
  };

  const label =
    done === "copied" ? "Чат скопирован" : done === "failed" ? "Не получилось скопировать" : "Поделиться чатом";

  return (
    <button
      className="chat-round glass chat-share"
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || !canShareChat(turns)}
      onClick={() => void share()}
    >
      <Icon name={done === "copied" ? "check" : done === "failed" ? "x" : "share"} />
      <span className="sr-only" aria-live="polite">
        {done ? label : ""}
      </span>
    </button>
  );
}

"use client";

// Поле мини-окна: чипы указанных уроков, строка ввода, инструменты.

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { Icon } from "@/components/shell/icons";
import { useSmoothInput } from "@/components/shell/smooth-input";
import { useAskRail } from "@/contexts/ask-rail";

import { useQuick, withAttached } from "./quick-context";

const MAX_HEIGHT = 160;

/** Чипы над полем: убрать указанный урок можно здесь же. */
export function QuickChips() {
  const { attached, detach } = useQuick();
  if (!attached.length) return null;
  return (
    <div className="q-chips">
      {attached.map((row) => (
        <span className="q-chip" key={row.label}>
          <span>{row.label}</span>
          <button type="button" aria-label={`Убрать: ${row.label}`} onClick={() => detach(row.el)}>
            <Icon name="x" />
          </button>
        </span>
      ))}
    </div>
  );
}

/** Кнопки «указать урок» и «голосом»: одинаковые в обоих режимах окна. */
export function QuickTools() {
  const { startPick, pickableCount, voiceSupported, listening, listen, stopListening } = useQuick();
  const { open } = useAskRail();
  const [canPick, setCanPick] = useState(false);

  // Страница могла измениться, пока окно было закрыто: полка, например, приезжает с сервера
  // уже после того, как окно смонтировалось. Поэтому считаем при каждом открытии.
  useEffect(() => {
    if (open) setCanPick(pickableCount() > 0);
  }, [open, pickableCount]);

  return (
    <>
      {canPick ? (
        <button className="q-tool q-pick" type="button" title="Указать урок курсором" onClick={startPick}>
          <Icon name="cursor" />
          <span>Указать</span>
        </button>
      ) : null}
      {voiceSupported ? (
        <button
          className="q-tool q-voice"
          type="button"
          title={listening ? "Хватит слушать" : "Сказать голосом"}
          aria-label={listening ? "Хватит слушать" : "Сказать голосом"}
          onClick={listening ? stopListening : listen}
        >
          <Icon name="wave" />
          <span className="q-bars" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>
      ) : null}
    </>
  );
}

export function QuickComposer({
  onSubmit,
  busy = false,
  disabled = false,
  placeholder = "Чем помочь?",
  suggestions,
  left,
  onStop,
  initialDraft,
}: {
  onSubmit: (text: string) => void;
  busy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  suggestions?: string[];
  left?: ReactNode;
  onStop?: () => void;
  initialDraft?: string;
}) {
  const { attached, clearAttached, listening, heard, suggestSlot } = useQuick();
  const [draft, setDraft] = useState("");
  const fieldRef = useRef<HTMLTextAreaElement | null>(null);
  useSmoothInput(fieldRef);

  const fit = useCallback(() => {
    const node = fieldRef.current;
    if (!node) return;
    node.style.height = "auto";
    node.style.height = `${Math.min(node.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  useEffect(() => {
    if (!initialDraft) return;
    setDraft(initialDraft);
    fieldRef.current?.focus();
  }, [initialDraft]);

  useEffect(fit, [draft, fit]);

  const send = useCallback(
    (text?: string) => {
      const question = (text ?? draft).trim();
      if ((!question && !attached.length) || busy || disabled) return;
      setDraft("");
      onSubmit(withAttached(question, attached));
      clearAttached();
    },
    [draft, attached, busy, disabled, onSubmit, clearAttached],
  );

  const handled = useRef(0);
  useEffect(() => {
    if (!heard || heard.id === handled.current) return;
    handled.current = heard.id;
    setDraft(heard.text);
    if (heard.final && heard.text) send(heard.text);
  }, [heard, send]);

  const showSuggestions = !draft.trim() && !busy && !listening && Boolean(suggestions?.length);

  return (
    <>
      {suggestSlot && showSuggestions
        ? createPortal(
            suggestions?.map((text, index) => (
              <button
                key={text}
                className="q-sug"
                type="button"
                style={{ animationDelay: `${index * 36}ms` }}
                onClick={() => send(text)}
              >
                {text}
              </button>
            )),
            suggestSlot,
          )
        : null}
      <QuickChips />
      <form
        className="q-form"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <span className="ti-host">
          <textarea
            ref={fieldRef}
            className="q-input"
            rows={1}
            value={draft}
            disabled={disabled}
            placeholder={listening ? "Слушаю…" : placeholder}
            aria-label="Быстрый запрос"
            autoComplete="off"
            style={{ maxHeight: MAX_HEIGHT }}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
          />
        </span>
      </form>
      <div className="q-tools">
        {left}
        <QuickTools />
        <span className="q-hint">Esc, чтобы закрыть</span>
        {busy && onStop ? (
          <button className="send q-send" type="button" aria-label="Остановить" title="Остановить" onClick={onStop}>
            <span className="q-stop" />
          </button>
        ) : (
          <button
            className="send q-send"
            type="button"
            aria-label="Отправить"
            disabled={busy || disabled || (!draft.trim() && !attached.length)}
            onClick={() => send()}
          >
            <Icon name="arrow-up" />
          </button>
        )}
      </div>
    </>
  );
}

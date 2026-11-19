"use client";

// «Поделиться» над перепиской: публичная ссылка на снимок разговора.
//
// Ссылку создаёт и удаляет сам ученик. По ней видно только текст реплик, без цитат из
// книг. Новые сообщения в ссылку не попадают, пока её не обновят: «Обновить» меняет
// снимок, адрес остаётся прежним.

import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { t } from "@/lib/i18n";
import { getChatShare, shareChat, unshareChat, type ChatShare } from "@/lib/curriculum-api";

import { canShareChat, shareUrl, type ShareTurn } from "./chat-share";
import { chatTitle } from "./chat-title";

type Status = "idle" | "loading" | "busy" | "failed";

export function ShareChat({
  chatId,
  title,
  turns,
  disabled,
}: {
  /** Сохранённый чат. Пока разговор не сохранён, делиться нечем. */
  chatId: string | null;
  title: string | null | undefined;
  turns: ShareTurn[];
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /** `null` — ещё не знаем, есть ли ссылка. */
  const [share, setShare] = useState<ChatShare | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [copied, setCopied] = useState(false);
  const [canSend, setCanSend] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(copiedTimer.current), []);
  useEffect(() => setCanSend(typeof navigator.share === "function" && matchMedia("(pointer: coarse)").matches), []);

  // Другой чат — другая ссылка.
  useEffect(() => {
    setShare(null);
    setOpen(false);
    setStatus("idle");
  }, [chatId]);

  // Окошко закрывается нажатием мимо и Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      wrapRef.current?.querySelector<HTMLElement>(".chat-share")?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Есть ли уже ссылка — спрашиваем, когда окошко открыли.
  useEffect(() => {
    if (!open || !chatId || share) return;
    let gone = false;
    setStatus("loading");
    getChatShare(chatId)
      .then((value) => {
        if (gone) return;
        setShare(value);
        setStatus("idle");
      })
      .catch(() => {
        if (!gone) setStatus("failed");
      });
    return () => {
      gone = true;
    };
  }, [open, chatId, share]);

  const link = share?.token ? shareUrl(window.location.origin, share.token) : "";

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Буфер закрыт: ссылка видна в поле, её можно выделить самому.
    }
  };

  /** Создать ссылку или обновить её снимок. Новую ссылку сразу кладём в буфер. */
  const publish = async () => {
    if (!chatId) return;
    const fresh = !share?.token;
    setStatus("busy");
    try {
      const value = await shareChat(chatId);
      setShare(value);
      setStatus("idle");
      if (fresh && value.token) void copy(shareUrl(window.location.origin, value.token));
    } catch {
      setStatus("failed");
    }
  };

  const unpublish = async () => {
    if (!chatId) return;
    setStatus("busy");
    try {
      await unshareChat(chatId);
      setShare({ token: null, shared_at: null });
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  };

  const send = async () => {
    try {
      await navigator.share({ title: chatTitle(title), url: link });
    } catch {
      // Закрыл меню сам или отправка не удалась: ссылка остаётся в поле.
    }
  };

  const busy = status === "busy";

  return (
    <div className="share-wrap" ref={wrapRef}>
      <button
        className="chat-round glass chat-share"
        type="button"
        aria-label={t("Поделиться чатом")}
        title={t("Поделиться чатом")}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled || !chatId || !canShareChat(turns)}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="share" />
      </button>
      {open ? (
        <div className="menu share-pop" role="dialog" aria-label={t("Поделиться чатом")}>
          <p className="share-h">{t("Поделиться чатом")}</p>
          {share === null ? (
            status === "failed" ? null : <p className="share-note">{t("Проверяю, есть ли ссылка…")}</p>
          ) : share.token ? (
            <>
              <div className="share-link">
                <input
                  readOnly
                  value={link}
                  aria-label={t("Ссылка на чат")}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button className="btn btn-main" type="button" onClick={() => void copy(link)}>
                  {copied ? t("Скопировано") : t("Скопировать")}
                </button>
              </div>
              <p className="share-note">{t("Новые сообщения попадут по ссылке после «Обновить».")}</p>
              <div className="share-acts">
                {canSend ? (
                  <button className="btn btn-line" type="button" onClick={() => void send()}>
                    {t("Отправить")}
                  </button>
                ) : null}
                <button className="btn btn-line" type="button" disabled={busy} onClick={() => void publish()}>
                  {t("Обновить")}
                </button>
                <button className="btn btn-text share-del" type="button" disabled={busy} onClick={() => void unpublish()}>
                  {t("Удалить ссылку")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="share-note">{t("Ссылку откроет любой, у кого она есть. Источников из книг по ней не видно.")}</p>
              <button className="btn btn-main share-create" type="button" disabled={busy} onClick={() => void publish()}>
                {t("Создать ссылку")}
              </button>
            </>
          )}
          {status === "failed" ? (
            <p className="share-error" role="alert">
              {t("Не получилось. Проверь интернет и попробуй ещё раз.")}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

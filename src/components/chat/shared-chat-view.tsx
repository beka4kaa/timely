"use client";

// Разговор по публичной ссылке: та же переписка, что в чате, только для чтения.
// Без входа, без почты и без цитат из книг: только то, что ученик сам выложил.

import "katex/dist/katex.min.css";

import { useEffect, useState } from "react";

import { IconSprite } from "@/components/shell/icons";
import { fetchSharedChat, type SharedChatPage } from "@/lib/curriculum-api";
import { useT } from "@/lib/i18n/react";

import { chatTitle } from "./chat-title";
import { MarkdownMessage } from "./markdown-message";

function sharedOn(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric" });
}

export function SharedChatView({ token, home }: { token: string; home: string }) {
  // Страницу рисует сервер, поэтому язык из `useT()`: он совпадает на сервере и в браузере.
  const { t, dateLocale } = useT();
  /** `undefined` — грузится, `null` — ссылки нет. */
  const [chat, setChat] = useState<SharedChatPage | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let gone = false;
    fetchSharedChat(token)
      .then((value) => {
        if (!gone) setChat(value);
      })
      .catch(() => {
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
    };
  }, [token]);

  return (
    <div className="share-page">
      <IconSprite />
      <div className="share-in">
        <header className="share-top">
          <a className="share-brand" href={home}>
            <svg className="share-mark" viewBox="0 0 172 122" aria-hidden="true">
              <use href="#art-slime" />
            </svg>
            Timely
          </a>
          <a className="btn btn-line" href={home}>
            {t("Что такое Timely")}
          </a>
        </header>

        {failed ? (
          <p className="share-missing" role="alert">
            {t("Разговор не загрузился. Проверь интернет и обнови страницу.")}
          </p>
        ) : chat === undefined ? (
          <p className="small-note">{t("Открываю разговор…")}</p>
        ) : chat === null ? (
          <div className="share-missing">
            <h1 className="share-title">{t("Ссылки больше нет")}</h1>
            <p>{t("Её удалили, или в адресе ошибка.")}</p>
          </div>
        ) : (
          <article>
            <h1 className="share-title">{chatTitle(chat.title)}</h1>
            <p className="share-when">
              {chat.shared_at
                ? t("Разговор с тьютором Timely, {date}", { date: sharedOn(chat.shared_at, dateLocale) })
                : t("Разговор с тьютором Timely")}
            </p>
            <div className="share-log">
              {chat.messages.map((message, index) =>
                message.role === "user" ? (
                  <p key={index} className="m-you">
                    {message.content}
                  </p>
                ) : (
                  <div key={index} className="m-ai">
                    <MarkdownMessage content={message.content} variant="page" />
                  </div>
                ),
              )}
            </div>
          </article>
        )}

        <footer className="share-foot">
          <span>{t("Timely помогает учиться: план на день, тьютор и повторение.")}</span>
          <a className="btn btn-main" href={home}>
            {t("Попробовать")}
          </a>
        </footer>
      </div>
    </div>
  );
}

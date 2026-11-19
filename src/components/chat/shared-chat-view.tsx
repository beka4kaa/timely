"use client";

// Разговор по публичной ссылке: та же переписка, что в чате, только для чтения.
// Без входа, без почты и без цитат из книг: только то, что ученик сам выложил.

import "katex/dist/katex.min.css";

import { useEffect, useState } from "react";

import { IconSprite } from "@/components/shell/icons";
import { fetchSharedChat, type SharedChatPage } from "@/lib/curriculum-api";

import { chatTitle } from "./chat-title";
import { MarkdownMessage } from "./markdown-message";

function sharedOn(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

export function SharedChatView({ token, home }: { token: string; home: string }) {
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
            Что такое Timely
          </a>
        </header>

        {failed ? (
          <p className="share-missing" role="alert">
            Разговор не загрузился. Проверь интернет и обнови страницу.
          </p>
        ) : chat === undefined ? (
          <p className="small-note">Открываю разговор…</p>
        ) : chat === null ? (
          <div className="share-missing">
            <h1 className="share-title">Ссылки больше нет</h1>
            <p>Её удалили, или в адресе ошибка.</p>
          </div>
        ) : (
          <article>
            <h1 className="share-title">{chatTitle(chat.title)}</h1>
            <p className="share-when">
              Разговор с тьютором Timely{chat.shared_at ? `, ${sharedOn(chat.shared_at)}` : ""}
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
          <span>Timely помогает учиться: план на день, тьютор и повторение.</span>
          <a className="btn btn-main" href={home}>
            Попробовать
          </a>
        </footer>
      </div>
    </div>
  );
}

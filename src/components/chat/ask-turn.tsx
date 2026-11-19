"use client";

// Одна реплика разговора. Вопрос в простом пузыре, ответ без рамки и с засечками: он
// читается как страница книги. Этап работы одной строкой, больше ничего.

import { memo, useEffect, useRef, useState } from "react";

import { Icon } from "@/components/shell/icons";
import { bookLabel } from "@/lib/book-label";
import { t } from "@/lib/i18n";
import type { AskCitation } from "@/lib/curriculum-api";
import { speak, speechSupported, stopSpeaking, useSpeaking } from "@/lib/speech";
import { speakableText } from "@/lib/speakable";
import { sentAt, timeAgo } from "@/lib/time-ago";
import { useMinute } from "@/lib/use-minute";

import { askErrorText, placeLabel, STOPPED_ERROR, turnStage } from "./ask-stages";
import { AssistantProposals, type ProposalChange } from "./assistant-proposals";
import { usageLine } from "./chat-usage";
import { MarkdownMessage } from "./markdown-message";
import type { Turn } from "./use-subject-chat";

export const AskTurn = memo(function AskTurn({
  turn,
  id,
  index,
  onCite,
  onRetry,
  onRegenerate,
  onRate,
  onProposal,
  showUsage = false,
}: {
  turn: Turn;
  id: string;
  /** Номер реплики в разговоре: по нему ставится оценка. */
  index: number;
  /** «Ответить заново» — только у последнего готового ответа. */
  onRegenerate?: () => void;
  /** «Нравится» или «не нравится». */
  onRate?: (index: number, rating: 1 | -1) => void;
  /** Показать модель, токены и цену под ответом. */
  showUsage?: boolean;
  /** Нажали на ссылку на страницу: показать её в источниках. */
  onCite: (documentId: string, page: number) => void;
  /** Только у ответа, который не получился, и только если он последний. */
  onRetry?: () => void;
  /** Ученик решил, что делать с предложением тьютора. */
  onProposal: ProposalChange;
}) {
  if (turn.role === "user") {
    return (
      <p className="m-you" id={id}>
        {turn.content}
      </p>
    );
  }

  const working = Boolean(turn.stage);
  // Этап виден, пока модель молчит. Как только пошёл текст, он сам показывает работу.
  const thinking = working && !turn.content;
  // В разговоре без книги пометка сообщала бы об отсутствии того, чего никто не открывал.
  const outsideBook = turn.grounded === false && turn.library !== false && Boolean(turn.content);

  return (
    <div className="m-turn" id={id}>
      {thinking ? (
        <p className="m-think shine" role="status">
          {turnStage(turn)}
        </p>
      ) : null}

      {turn.content ? (
        <div className="m-ai">
          {outsideBook ? <p className="m-outside">{t("В книге этого нет, отвечаю своими словами")}</p> : null}
          <MarkdownMessage content={turn.content} variant="page" />
          {turn.citations?.length ? <Citations items={turn.citations} onCite={onCite} /> : null}
        </div>
      ) : null}

      {turn.content && !working && !turn.error ? (
        <AnswerBar turn={turn} id={id} index={index} onRate={onRate} onRegenerate={onRegenerate} />
      ) : null}

      <AssistantProposals proposals={turn.proposals} onChange={onProposal} />

      {showUsage && turn.usage ? <p className="m-usage">{usageLine(turn.usage)}</p> : null}

      {turn.error ? <TurnError raw={turn.error} onRetry={onRetry} /> : null}
    </div>
  );
});

/**
 * Под ответом: скопировать, озвучить, «нравится», «не нравится», ответить заново и когда
 * пришёл. Время на компьютере видно при наведении, на телефоне всегда (стили в page-chat.css).
 */
function AnswerBar({
  turn,
  id,
  index,
  onRate,
  onRegenerate,
}: {
  turn: Turn;
  id: string;
  index: number;
  onRate?: (index: number, rating: 1 | -1) => void;
  onRegenerate?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [canSpeak, setCanSpeak] = useState(false);
  const speaking = useSpeaking(id);
  const now = useMinute();
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>();

  // Свежее «читают ли меня» для ухода со страницы: зависимость от `speaking` остановила бы
  // и чужое чтение, когда ученик включает другой ответ.
  const speakingNow = useRef(speaking);
  speakingNow.current = speaking;

  useEffect(() => setCanSpeak(speechSupported()), []);
  useEffect(
    () => () => {
      clearTimeout(copiedTimer.current);
      // Ответ ушёл со страницы, а голос ещё читает его: замолкаем вместе с ним.
      if (speakingNow.current) stopSpeaking();
    },
    [],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.content);
      setCopied(true);
      clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      // Буфер закрыт браузером: текст можно выделить вручную.
    }
  };

  return (
    <div className="ans-bar">
      <button className="ans-act" type="button" aria-label={t("Скопировать ответ")} title={t("Скопировать")} onClick={() => void copy()}>
        <Icon name={copied ? "check" : "copy"} />
      </button>
      {canSpeak ? (
        <button
          className="ans-act"
          type="button"
          aria-label={speaking ? t("Остановить чтение") : t("Прочитать вслух")}
          aria-pressed={speaking}
          title={speaking ? t("Остановить") : t("Прочитать вслух")}
          onClick={() => (speaking ? stopSpeaking() : speak(id, speakableText(turn.content)))}
        >
          <Icon name={speaking ? "stop" : "volume"} />
        </button>
      ) : null}
      {onRate ? (
        <>
          <button
            className="ans-act ans-rate"
            type="button"
            aria-label={t("Хороший ответ")}
            aria-pressed={turn.rating === 1}
            title={t("Хороший ответ")}
            onClick={() => onRate(index, 1)}
          >
            <Icon name="thumb-up" />
          </button>
          <button
            className="ans-act ans-rate"
            type="button"
            aria-label={t("Плохой ответ")}
            aria-pressed={turn.rating === -1}
            title={t("Плохой ответ")}
            onClick={() => onRate(index, -1)}
          >
            <Icon name="thumb-down" />
          </button>
        </>
      ) : null}
      {onRegenerate ? (
        <button className="ans-act" type="button" aria-label={t("Ответить заново")} title={t("Ответить заново")} onClick={onRegenerate}>
          <Icon name="refresh" />
        </button>
      ) : null}
      {turn.at && now ? (
        <time className="ans-when" dateTime={new Date(turn.at).toISOString()} title={sentAt(turn.at, now)}>
          {timeAgo(turn.at, now)}
        </time>
      ) : null}
    </div>
  );
}

function TurnError({ raw, onRetry }: { raw: string; onRetry?: () => void }) {
  if (raw === STOPPED_ERROR) return <p className="m-think">{askErrorText(raw)}</p>;
  return (
    <div className="m-fail" role="alert">
      <p>{askErrorText(raw)}</p>
      {onRetry ? (
        <button className="btn btn-line" type="button" onClick={onRetry}>
          {t("Повторить")}
        </button>
      ) : null}
    </div>
  );
}

interface BookSpots {
  documentId: string;
  title: string;
  spots: { label: string; page: number }[];
}

/** Книга называется один раз. Несколько ссылок на одно место показываем одной. */
function groupByBook(items: AskCitation[]): BookSpots[] {
  const books: BookSpots[] = [];
  for (const item of items) {
    const label = placeLabel(item);
    if (!label) continue;
    let book = books.find((row) => row.documentId === item.document_id);
    if (!book) {
      book = { documentId: item.document_id, title: bookLabel(item.document_title), spots: [] };
      books.push(book);
    }
    if (!book.spots.some((spot) => spot.label === label)) {
      book.spots.push({ label, page: item.page_start });
    }
  }
  return books;
}

function Citations({
  items,
  onCite,
}: {
  items: AskCitation[];
  onCite: (documentId: string, page: number) => void;
}) {
  const books = groupByBook(items);
  if (!books.length) return null;
  return (
    <div className="m-cites">
      {books.map((book) => (
        <p key={book.documentId}>
          <span>{book.title || t("Источник")}: </span>
          {book.spots.map((spot, index) => (
            <span key={spot.label}>
              {index ? ", " : null}
              <button
                className="link"
                type="button"
                title={t("Показать в источниках")}
                onClick={() => onCite(book.documentId, spot.page)}
              >
                {spot.label}
              </button>
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

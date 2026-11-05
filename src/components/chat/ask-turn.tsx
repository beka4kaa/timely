"use client";

// Одна реплика разговора. Вопрос в простом пузыре, ответ без рамки и с засечками: он
// читается как страница книги. Этап работы одной строкой, больше ничего.

import { memo } from "react";

import { bookLabel } from "@/lib/book-label";
import type { AskCitation } from "@/lib/curriculum-api";

import { askErrorText, placeLabel, stageLabel, STOPPED_ERROR } from "./ask-stages";
import { usageLine } from "./chat-usage";
import { MarkdownMessage } from "./markdown-message";
import type { Turn } from "./use-subject-chat";

export const AskTurn = memo(function AskTurn({
  turn,
  id,
  onCite,
  onRetry,
  showUsage = false,
}: {
  turn: Turn;
  id: string;
  /** Показать модель, токены и цену под ответом. */
  showUsage?: boolean;
  /** Нажали на ссылку на страницу: показать её в источниках. */
  onCite: (documentId: string, page: number) => void;
  /** Только у ответа, который не получился, и только если он последний. */
  onRetry?: () => void;
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
          {stageLabel(turn.stage ?? "", turn.found)}
        </p>
      ) : null}

      {turn.content ? (
        <div className="m-ai">
          {outsideBook ? <p className="m-outside">В книге этого нет, отвечаю своими словами</p> : null}
          <MarkdownMessage content={turn.content} variant="page" />
          {turn.citations?.length ? <Citations items={turn.citations} onCite={onCite} /> : null}
        </div>
      ) : null}

      {showUsage && turn.usage ? <p className="m-usage">{usageLine(turn.usage)}</p> : null}

      {turn.error ? <TurnError raw={turn.error} onRetry={onRetry} /> : null}
    </div>
  );
});

function TurnError({ raw, onRetry }: { raw: string; onRetry?: () => void }) {
  if (raw === STOPPED_ERROR) return <p className="m-think">{askErrorText(raw)}</p>;
  return (
    <div className="m-fail" role="alert">
      <p>{askErrorText(raw)}</p>
      {onRetry ? (
        <button className="btn btn-line" type="button" onClick={onRetry}>
          Повторить
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
          <span>{book.title || "Источник"}: </span>
          {book.spots.map((spot, index) => (
            <span key={spot.label}>
              {index ? ", " : null}
              <button
                className="link"
                type="button"
                title="Показать в источниках"
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

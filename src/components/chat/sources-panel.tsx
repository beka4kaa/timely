"use client";

// Где в книге идёт разговор: обложка, страницы, на которые ссылались ответы, и то, что
// на выбранной странице написано. Перехода «в книгу» здесь нет и обещать его нельзя:
// читалки у нас пока нет. Кнопка ведёт к ответу, где страница цитировалась.

import type { BookSpine, SpineMark } from "@/lib/citation-spread";
import type { CurriculumDocument } from "@/lib/curriculum-api";
import { coverAuthor, coverClass, coverTitle } from "@/lib/curriculum-cover";

import { placeLabel } from "./ask-stages";
import { useSourceQuote } from "./source-quote";
import type { Turn } from "./use-subject-chat";
// Цвета обложек описаны у библиотеки: книга здесь того же цвета, что и на полке.
import "@/styles/timely/page-curriculum.css";

function pagesWord(count: number): string {
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) return "страниц";
  if (ones === 1) return "страница";
  if (ones >= 2 && ones <= 4) return "страницы";
  return "страниц";
}

function bookCaption(document: CurriculumDocument | undefined, pageCount: number): string {
  const pages = pageCount ? `${pageCount} ${pagesWord(pageCount)}` : "";
  return [coverAuthor(document?.authors), pages].filter(Boolean).join(", ");
}

/** Книга на краю панели: цвет от предмета, как на полке библиотеки. */
function BookHead({
  title,
  caption,
  subject,
  shelfIndex,
}: {
  title: string;
  caption: string;
  subject: string;
  shelfIndex: number;
}) {
  return (
    <div className="src-book">
      <span className={`book mini ${coverClass(subject, shelfIndex)}`} aria-hidden="true" />
      <span className="src-name">
        {coverTitle(title) || "Книга"}
        {caption ? <small>{caption}</small> : null}
      </span>
    </div>
  );
}

function markLabel(mark: SpineMark): string {
  return mark.page === mark.pageEnd ? String(mark.page) : `${mark.page}–${mark.pageEnd}`;
}

/** Ответ, где страница цитировалась последний раз. */
function lastTurnOf(mark: SpineMark): number {
  return Math.max(...mark.turns);
}

/** Страница, с которой начинает панель: главная ссылка самого свежего ответа на эту книгу. */
function latestMark(spine: BookSpine, turns: Turn[]): SpineMark | undefined {
  const lastTurn = Math.max(-1, ...spine.marks.map(lastTurnOf));
  const top = turns[lastTurn]?.citations?.find(
    (item) => item.document_id === spine.documentId && item.page_start > 0,
  );
  return (
    spine.marks.find((mark) => top && mark.page <= top.page_start && top.page_start <= mark.pageEnd) ??
    spine.marks[0]
  );
}

function CitedBook({
  spine,
  document,
  subject,
  shelfIndex,
  turns,
  pickedPage,
  onPickPage,
  onJump,
}: {
  spine: BookSpine;
  document: CurriculumDocument | undefined;
  subject: string;
  shelfIndex: number;
  turns: Turn[];
  pickedPage: number | undefined;
  onPickPage: (documentId: string, page: number) => void;
  onJump: (turnIndex: number) => void;
}) {
  const active =
    spine.marks.find(
      (mark) => pickedPage !== undefined && mark.page <= pickedPage && pickedPage <= mark.pageEnd,
    ) ?? latestMark(spine, turns);

  return (
    <div className="src-block">
      <BookHead
        title={spine.title}
        caption={bookCaption(document, spine.pageCount)}
        subject={subject}
        shelfIndex={shelfIndex}
      />
      {spine.marks.length ? (
        <div className="tabs" role="group" aria-label="Страница">
          {spine.marks.map((mark) => (
            <button
              key={mark.page}
              type="button"
              aria-pressed={mark === active}
              onClick={() => onPickPage(spine.documentId, mark.page)}
            >
              {markLabel(mark)}
            </button>
          ))}
        </div>
      ) : null}
      {active ? (
        <PagePaper spine={spine} mark={active} turns={turns} onJump={onJump} />
      ) : (
        <SectionsPaper spine={spine} turns={turns} onJump={onJump} />
      )}
    </div>
  );
}

function PagePaper({
  spine,
  mark,
  turns,
  onJump,
}: {
  spine: BookSpine;
  mark: SpineMark;
  turns: Turn[];
  onJump: (turnIndex: number) => void;
}) {
  const turnIndex = lastTurnOf(mark);
  const citation = turns[turnIndex]?.citations?.find(
    (item) =>
      item.document_id === spine.documentId &&
      item.page_start <= mark.pageEnd &&
      item.page_end >= mark.page,
  );
  const quote = useSourceQuote({
    documentId: spine.documentId,
    question: turns[turnIndex - 1]?.content ?? "",
    pageStart: mark.page,
    pageEnd: mark.pageEnd,
    excerpt: citation?.excerpt,
  });
  const place = citation
    ? placeLabel({
        section_path: citation.section_path,
        page_start: mark.page,
        page_end: mark.pageEnd,
      })
    : "";

  return (
    <figure className="paper">
      {quote ? <blockquote>{quote}</blockquote> : null}
      <figcaption>
        {place || `стр. ${markLabel(mark)}`}
        <button className="link src-go" type="button" onClick={() => onJump(turnIndex)}>
          К ответу
        </button>
      </figcaption>
    </figure>
  );
}

/** У EPUB страниц нет: носитель места там раздел. */
function SectionsPaper({
  spine,
  turns,
  onJump,
}: {
  spine: BookSpine;
  turns: Turn[];
  onJump: (turnIndex: number) => void;
}) {
  const places: { section: string; turn: number }[] = [];
  turns.forEach((turn, index) => {
    for (const item of turn.citations ?? []) {
      if (item.document_id !== spine.documentId || !item.section_path) continue;
      if (!places.some((place) => place.section === item.section_path)) {
        places.push({ section: item.section_path, turn: index });
      }
    }
  });

  return (
    <figure className="paper">
      <figcaption>
        {places.length ? (
          places.map((place) => (
            <button
              key={place.section}
              className="link src-place"
              type="button"
              onClick={() => onJump(place.turn)}
            >
              {place.section}
            </button>
          ))
        ) : (
          <>Ссылок на эту книгу: {spine.citations}</>
        )}
      </figcaption>
    </figure>
  );
}

export function SourcesPanel({
  spines,
  shelf,
  documents,
  subject,
  turns,
  pickedPages,
  onPickPage,
  onJump,
}: {
  spines: BookSpine[];
  /** Обработанные книги предмета: они видны и до первой ссылки. */
  shelf: CurriculumDocument[];
  /** Все книги ученика: у ссылки нет автора, а у книги он есть. */
  documents: CurriculumDocument[];
  /** Название предмета: от него цвет обложки. */
  subject: string;
  turns: Turn[];
  pickedPages: Record<string, number>;
  onPickPage: (documentId: string, page: number) => void;
  onJump: (turnIndex: number) => void;
}) {
  const cited = new Set(spines.map((spine) => spine.documentId));
  const shelfIndex = (documentId: string) =>
    Math.max(
      0,
      shelf.findIndex((document) => document.id === documentId),
    );
  const quiet = shelf.filter((document) => !cited.has(document.id));

  return (
    <aside className="sources" aria-label="Источники">
      {spines.map((spine) => (
        <CitedBook
          key={spine.documentId}
          spine={spine}
          document={documents.find((document) => document.id === spine.documentId)}
          subject={subject}
          shelfIndex={shelfIndex(spine.documentId)}
          turns={turns}
          pickedPage={pickedPages[spine.documentId]}
          onPickPage={onPickPage}
          onJump={onJump}
        />
      ))}
      {quiet.map((document) => (
        <div className="src-block" key={document.id}>
          <BookHead
            title={document.title}
            caption={bookCaption(document, document.page_count)}
            subject={subject}
            shelfIndex={shelfIndex(document.id)}
          />
        </div>
      ))}
      {spines.length ? null : (
        <p className="src-empty">Когда ответ опрётся на книгу, здесь появятся её страницы.</p>
      )}
    </aside>
  );
}

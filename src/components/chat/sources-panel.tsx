"use client";

// Где в книге идёт разговор.
//
// Список «Механика, §5.2, стр. 292» уже стоит под каждым ответом. Повторить его
// в панели значило бы напечатать то же самое дважды, поэтому панель показывает
// другое: корешок книги во всю ширину и процитированные страницы засечками на
// нём. Сразу видно то, чего из списка не видно, — разговор про середину
// учебника, или скачет по всей книге, или упёрся в одну главу.
//
// Клик по засечке прокручивает ленту к ответу, где эта страница цитировалась.
// Перехода «в книгу» здесь нет и обещать его нельзя: читалки у нас пока нет.

import { useState } from "react";
import { PanelRightClose } from "lucide-react";

import { bookLabel } from "@/lib/book-label";
import type { BookSpine } from "@/lib/citation-spread";

export function SourcesPanel({
  spines,
  authors,
  hasLibrary,
  onJump,
  onCollapse,
}: {
  spines: BookSpine[];
  /** Авторы по идентификатору книги: в цитате их нет, а в подписи они уместны. */
  authors: Map<string, string[]>;
  /** У разговора выбран предмет. Нет — и книгам взяться неоткуда. */
  hasLibrary: boolean;
  onJump: (turnIndex: number) => void;
  onCollapse: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#fbfaf7] text-[#37322c]">
      <div className="flex h-[46px] shrink-0 items-center justify-between border-b border-[#dedbd4] px-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
          Источники
        </span>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Свернуть источники"
          title="Свернуть источники"
          className="grid h-7 w-7 place-items-center rounded-full text-[#918b82] outline-none transition-colors hover:bg-[#efede8] hover:text-[#37322c] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
        >
          <PanelRightClose className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3">
        {!spines.length && (
          <p className="text-[12px] leading-[1.55] text-[#a09890]">
            {hasLibrary
              ? "Пока ни одной ссылки на книгу. Они появятся, когда ответ обопрётся на учебник."
              : "Разговор без книги: отвечает модель, ссылаться не на что."}
          </p>
        )}

        {spines.map((spine) => (
          <Spine
            key={spine.documentId}
            spine={spine}
            authors={authors.get(spine.documentId) ?? []}
            onJump={onJump}
          />
        ))}
      </div>
    </div>
  );
}

function Spine({
  spine,
  authors,
  onJump,
}: {
  spine: BookSpine;
  authors: string[];
  onJump: (turnIndex: number) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const title = bookLabel(spine.title) || "Источник";
  const caption = [authors[0], spine.pageCount ? `${spine.pageCount} стр.` : ""]
    .filter(Boolean)
    .join(" · ");

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-serif text-[13px] font-semibold text-[#37322c]">
          {title}
        </span>
        {caption && (
          <span className="shrink-0 text-[10px] tabular-nums text-[#a09890]">
            {caption}
          </span>
        )}
      </div>

      {/* Корешок: срез страниц, если смотреть на книгу с торца. */}
      <div
        className="relative mt-2 h-7 overflow-hidden rounded-[3px] border border-[#e0dcd4] bg-[#f4f1ea]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(120,108,92,0.16) 0 1px, transparent 1px 4px)",
        }}
      >
        {spine.marks.map((mark) => (
          <button
            key={mark.page}
            type="button"
            onClick={() => onJump(mark.turns[0])}
            onMouseEnter={() => setHovered(mark.page)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(mark.page)}
            onBlur={() => setHovered(null)}
            title={
              mark.page === mark.pageEnd
                ? `стр. ${mark.page}`
                : `стр. ${mark.page}–${mark.pageEnd}`
            }
            aria-label={`Перейти к ответу со страницей ${mark.page}`}
            className="absolute top-0 h-full -translate-x-1/2 rounded-[1px] outline-none transition-colors"
            style={{
              left: `${mark.at * 100}%`,
              // Тонкая цитата всё равно должна быть видна и попадаема мышью.
              width: `max(3px, ${mark.span * 100}%)`,
              backgroundColor: hovered === mark.page ? "#8a5b24" : "#c08a3e",
            }}
          />
        ))}
      </div>

      {/* Номера страниц. На корешке они наехали бы друг на друга, а здесь их
          видно все, и наведение связывает номер с засечкой. */}
      <div className="mt-1.5 flex flex-wrap gap-1">
        {spine.marks.map((mark) => (
          <button
            key={mark.page}
            type="button"
            onClick={() => onJump(mark.turns[0])}
            onMouseEnter={() => setHovered(mark.page)}
            onMouseLeave={() => setHovered(null)}
            onFocus={() => setHovered(mark.page)}
            onBlur={() => setHovered(null)}
            className={`rounded-full border px-2 py-[2px] text-[10.5px] tabular-nums outline-none transition-colors ${
              hovered === mark.page
                ? "border-[#c5a474] bg-[#f6efe3] text-[#6f481c]"
                : "border-[#e4e0d8] bg-[#fbfaf7] text-[#8a8177]"
            }`}
          >
            {mark.page === mark.pageEnd
              ? mark.page
              : `${mark.page}–${mark.pageEnd}`}
          </button>
        ))}
        {!spine.marks.length && (
          <span className="text-[10.5px] text-[#a09890]">
            {/* У EPUB страниц нет вовсе — засечке взяться неоткуда. */}
            Ссылок без страниц: {spine.citations}
          </span>
        )}
      </div>
    </div>
  );
}

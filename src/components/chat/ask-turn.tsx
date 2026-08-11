"use client";

// Одна реплика разговора и ссылки на книгу под ней.
//
// Два размера. `rail` — та же вёрстка, что была в панели: пузыри в 13 px,
// ширина до 94 %. `page` — колонка на всю страницу, где ответ перестаёт быть
// пузырём: рамка вокруг текста шириной в пол-экрана превращает объяснение в
// карточку, а читается оно как страница. Пузырь остаётся только у вопроса —
// там он и нужен, чтобы отличить свою реплику от чужой.

import { BookOpen } from "lucide-react";

import { bookLabel, citationSpot } from "@/lib/book-label";
import type { AskCitation } from "@/lib/curriculum-api";
import { MarkdownMessage } from "./markdown-message";
import { ThinkingNote } from "./thinking-note";
import { buildStages, foundSummary } from "./ask-stages";
import type { Turn } from "./use-subject-chat";

export type ChatVariant = "rail" | "page";

export function AskTurn({
  turn,
  variant = "rail",
  id,
}: {
  turn: Turn;
  variant?: ChatVariant;
  id?: string;
}) {
  const page = variant === "page";

  if (turn.role === "user") {
    return (
      <div className="flex justify-end" id={id}>
        <div
          className={`whitespace-pre-wrap rounded-[16px] rounded-tr-[5px] bg-[#302d2a] text-[#fffdf9] ${
            page
              ? "max-w-[84%] px-4 py-3 text-[15px] leading-[1.6]"
              : "max-w-[94%] px-3.5 py-2.5 text-[13px] leading-[1.55]"
          }`}
        >
          {turn.content}
        </div>
      </div>
    );
  }

  const working = Boolean(turn.stage);

  return (
    <div className="flex justify-start" id={id}>
      <div
        className={`flex flex-col ${page ? "w-full gap-2" : "max-w-[94%] gap-1.5"}`}
      >
        {(working || turn.durationMs) && (
          <ThinkingNote
            stages={buildStages(turn)}
            streaming={working}
            durationMs={turn.durationMs}
            summary={foundSummary(turn)}
          />
        )}

        {(turn.content || turn.error) && (
          <div
            className={
              page
                ? "text-[15px] leading-[1.7] text-[#413b34]"
                : "rounded-[16px] border border-[#dedad3] bg-white/62 px-3.5 py-2.5 text-[13px] leading-[1.55] text-[#514b43]"
            }
          >
            {turn.error && <span className="text-[#b0473e]">{turn.error}</span>}
            {/* Только когда книга была: в разговоре без книги пометка
                сообщала бы об отсутствии того, чего никто не открывал. */}
            {turn.grounded === false && turn.library !== false && !!turn.content && (
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#9b958c]">
                В книге этого нет
              </div>
            )}
            {turn.content && (
              <MarkdownMessage content={turn.content} variant={variant} />
            )}
          </div>
        )}

        {!!turn.citations?.length && (
          <Citations items={turn.citations} variant={variant} />
        )}
      </div>
    </div>
  );
}

/**
 * Ссылки на книгу.
 *
 * Название книги стоит ОДИН раз над списком. Раньше оно повторялось в каждой из
 * восьми ссылок, и вместе с длинным именем файла цитаты занимали больше места,
 * чем сам ответ.
 */
export function Citations({
  items,
  variant = "rail",
}: {
  items: AskCitation[];
  variant?: ChatVariant;
}) {
  const title = bookLabel(items[0]?.document_title ?? "");
  // Одна книга может дать несколько ссылок на одно место — показываем раз.
  const spots = Array.from(
    new Set(items.map((item) => citationSpot(item)).filter(Boolean)),
  );

  return (
    <div className={variant === "page" ? "" : "px-1"}>
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[#a09890]">
        <BookOpen className="h-3 w-3 shrink-0 text-[#b98343]" />
        <span className="truncate">{title || "Источник"}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {spots.map((spot) => (
          <span
            key={spot}
            className="rounded-full border border-[#e4e0d8] bg-[#fbfaf7] px-2 py-[2px] text-[10.5px] tabular-nums text-[#8a8177]"
          >
            {spot}
          </span>
        ))}
      </div>
    </div>
  );
}

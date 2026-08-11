"use client";

// Поле вопроса: черновик, отправка, подсказки.
//
// Черновик живёт ЗДЕСЬ, а не у страницы. На странице поле переезжает из центра
// пустого экрана вниз после первого вопроса, и это должен быть один и тот же
// узел DOM: два разных потеряли бы и набранный текст, и фокус ровно в момент
// первой отправки. Пока состояние внутри — потерять его нельзя в принципе.
//
// Слот `left` — то место, где у чат-ботов стоит выбор модели. У нас там выбор
// предмета: ученик выбирает не модель, а книгу, по которой отвечать. В панели
// слот пуст: предмет там задан сверху.

import { useRef, useState } from "react";
import { ArrowUp, Loader2, Square } from "lucide-react";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { ChatVariant } from "./ask-turn";

export function Composer({
  onSubmit,
  busy = false,
  disabled = false,
  placeholder = "Спроси по книге…",
  suggestions,
  variant = "rail",
  left,
  onStop,
}: {
  onSubmit: (text: string) => void;
  busy?: boolean;
  /** Спрашивать сейчас не по чему: нет предмета или книга ещё не обработана. */
  disabled?: boolean;
  placeholder?: string;
  suggestions?: string[];
  variant?: ChatVariant;
  left?: React.ReactNode;
  /**
   * Прервать ответ. Без него кнопка во время работы просто крутится — так
   * ведёт себя панель, и менять ей поведение эта правка не должна.
   */
  onStop?: () => void;
}) {
  const [draft, setDraft] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const page = variant === "page";
  const maxHeight = page ? 200 : 160;

  const send = (text?: string) => {
    const question = (text ?? draft).trim();
    if (!question || busy || disabled) return;
    setDraft("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    onSubmit(question);
  };

  const prompts = suggestions?.length ? (
    <div
      className={`flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] ${
        page ? "justify-center flex-wrap" : ""
      }`}
    >
      {suggestions.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => send(prompt)}
          disabled={busy || disabled}
          className={`shrink-0 rounded-full border border-[#d9d4cc] bg-[#fbfaf7] font-serif text-[#7e776e] transition-colors hover:border-[#c5a474] hover:text-[#6f481c] disabled:cursor-not-allowed disabled:opacity-45 ${
            page ? "px-3.5 py-1.5 text-[13px]" : "px-3 py-1.5 text-[12px]"
          }`}
        >
          {prompt}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <div className="w-full">
      {/* В панели подсказки стоят НАД полем — там, где они и были: снизу их
          прижало бы к самому краю экрана. На странице поле в пустом чате стоит
          посередине, и подсказки под ним читаются как предложения, а не как
          часть вопроса. */}
      {!page && prompts && <div className="mb-2">{prompts}</div>}

      {/* Кнопка в ОДНОЙ строке с полем, а не под ним: нижний ряд достался от
          чата доски, где его занимали пилюли генерации, и здесь оставался
          пустым — поле выходило вдвое выше нужного. */}
      <div
        className={`flex items-end gap-2 rounded-[17px] border border-[#d8d3cb] bg-[#fbfaf7] shadow-[0_8px_24px_rgba(67,57,45,0.06)] transition-[border-color,box-shadow] focus-within:border-[#c79a5b] focus-within:shadow-[0_10px_30px_rgba(138,91,36,0.10)] ${
          page ? "px-3 py-2.5" : "px-3 py-2"
        }`}
      >
        {left}
        <textarea
          ref={textareaRef}
          placeholder={placeholder}
          rows={1}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onInput={(event) => {
            // Поле растёт под текст, как в чате доски.
            const node = event.currentTarget;
            node.style.height = "auto";
            node.style.height = `${Math.min(node.scrollHeight, maxHeight)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          style={{ maxHeight }}
          className={`min-h-[24px] flex-1 resize-none self-center bg-transparent py-1 font-serif leading-relaxed text-[#3b352f] outline-none placeholder:text-[#aaa49b] ${
            page ? "text-[15px]" : "text-[14px]"
          }`}
        />
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => (busy && onStop ? onStop() : send())}
                disabled={busy ? !onStop : !draft.trim() || disabled}
                aria-label={busy && onStop ? "Остановить" : "Отправить"}
                className={`grid shrink-0 place-items-center rounded-full bg-[#c9a16c] text-white outline-none transition-colors hover:bg-[#af7d3d] disabled:bg-[#e5dfd6] disabled:text-[#aaa49b] ${
                  page ? "h-9 w-9" : "h-8 w-8"
                }`}
              >
                {busy ? (
                  onStop ? (
                    <Square className="h-3.5 w-3.5 fill-current" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  )
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {busy && onStop ? "Остановить" : "Отправить (Enter)"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {page && prompts && <div className="mt-3">{prompts}</div>}
    </div>
  );
}

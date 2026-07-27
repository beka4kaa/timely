"use client";

import React from "react";
import { ImageOff, Loader2 } from "lucide-react";

/**
 * Место под иллюстрацию, пока она генерируется.
 *
 * Прогрессивная выдача: доска с текстом и подписями приходит примерно за 18
 * секунд, а каждая картинка догружается отдельным запросом ещё ~25 секунд.
 * Без этого блока холст всё это время оставался бы пустым, и казалось бы, что
 * ассистент ничего не сделал.
 */
export interface IllustrationPlaceholderProps {
  width: number;
  height: number;
  /** Текст ошибки, если генерация не удалась. */
  error?: string;
}

export function IllustrationPlaceholder({
  width,
  height,
  error,
}: IllustrationPlaceholderProps) {
  const failed = Boolean(error);

  return (
    <div
      style={{ width, height }}
      className={`flex flex-col items-center justify-center gap-2 rounded-2xl border text-center px-4 ${
        failed
          ? "border-red-300/60 bg-red-50/60"
          : "animate-pulse border-[#d8d3cb] bg-[#f2eee7]"
      }`}
      role="img"
      aria-label={failed ? `Иллюстрация не сгенерирована: ${error}` : "Иллюстрация генерируется"}
    >
      {failed ? (
        <>
          <ImageOff className="h-5 w-5 text-red-500/80" />
          <span className="text-[11px] leading-snug text-red-600/90">
            {error}
          </span>
        </>
      ) : (
        <>
          <Loader2 className="h-5 w-5 animate-spin text-[#a66d28]" />
          <span className="text-[11px] text-[#827b72]">
            Рисую иллюстрацию…
          </span>
        </>
      )}
    </div>
  );
}

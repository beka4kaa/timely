"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Живой блок «Думаю…» над ответом ассистента.
 *
 * Раньше здесь был захардкоженный чеклист из двух статичных строк («Понял
 * запрос и структуру темы» с уже готовой галочкой), который показывался всегда
 * — даже когда модель просто отвечала текстом и доску не трогала. Теперь сюда
 * приезжает НАСТОЯЩАЯ цепочка рассуждений модели по SSE.
 *
 * Два состояния:
 *   streaming — пульсирующая точка, счётчик секунд и бегущий текст;
 *   готово    — одна свёрнутая строка «Думал N секунд», раскрывается по клику.
 */

interface ReasoningBlockProps {
  /** Накопленный текст рассуждения. Пустая строка — блок не показываем. */
  reasoning: string;
  /** Модель ещё думает: показываем таймер и автоскролл. */
  streaming: boolean;
  /** Итоговая длительность, мс. Есть только когда streaming=false. */
  durationMs?: number;
  /** Текущая стадия с бэкенда: routing | drawing | ... */
  stage?: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  routing: "Думаю",
  drawing: "Строю схему",
  ask_clarification: "Уточняю вопрос",
};

function formatSeconds(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  // 1 секунду, 2-4 секунды, 5+ секунд — иначе получается «Думал 2 секунд».
  const mod10 = seconds % 10;
  const mod100 = seconds % 100;
  let word = "секунд";
  if (mod10 === 1 && mod100 !== 11) word = "секунду";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) word = "секунды";
  return `${seconds} ${word}`;
}

export function ReasoningBlock({
  reasoning,
  streaming,
  durationMs,
  stage,
}: ReasoningBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Таймер тикает только пока идёт стрим.
  useEffect(() => {
    if (!streaming) {
      startedAt.current = null;
      return;
    }
    if (startedAt.current === null) startedAt.current = Date.now();
    const id = window.setInterval(() => {
      if (startedAt.current !== null) setElapsed(Date.now() - startedAt.current);
    }, 200);
    return () => window.clearInterval(id);
  }, [streaming]);

  // Пока думает — держим последнюю строку в поле зрения.
  useEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [reasoning, streaming]);

  // Нечего показывать: ни рассуждения, ни активной стадии.
  if (!reasoning && !streaming) return null;

  const label = streaming ? STAGE_LABELS[stage ?? "routing"] ?? "Думаю" : null;

  if (streaming) {
    return (
      <div className="rounded-[14px] border border-[#e3ddd3] bg-[#f7f3ec] px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-[12px] font-medium text-[#61574c]">
          <motion.span
            className="h-1.5 w-1.5 rounded-full bg-[#b7792d]"
            animate={{ opacity: [1, 0.25, 1], scale: [1, 0.8, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
          <span>{label}…</span>
          <span className="ml-auto tabular-nums text-[11px] text-[#8d857c]">
            {Math.max(0, Math.round(elapsed / 1000))}с
          </span>
        </div>

        {reasoning && (
          <div
            ref={scrollRef}
            className="mt-2 max-h-[76px] overflow-hidden text-[11.5px] leading-[1.5] text-[#8a8177]"
            style={{
              // Верхние строки растворяются, чтобы бегущий текст не выглядел
              // обрезанным по прямой линии.
              maskImage: "linear-gradient(to bottom, transparent, #000 22px)",
              WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 22px)",
            }}
          >
            {reasoning}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[14px] border border-[#e6e1d8] bg-[#faf8f4]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-1.5 px-3.5 py-2 text-left text-[11.5px] text-[#8d857c] transition-colors hover:text-[#61574c]"
      >
        <motion.span animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.18 }}>
          <ChevronRight className="h-3.5 w-3.5" />
        </motion.span>
        <span>
          {durationMs ? `Думал ${formatSeconds(durationMs)}` : "Ход рассуждений"}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="whitespace-pre-wrap px-3.5 pb-3 text-[11.5px] leading-[1.55] text-[#8a8177]">
              {reasoning}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

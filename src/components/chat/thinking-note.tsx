"use client";

// Что ассистент делает, пока ученик ждёт.
//
// Раньше здесь был спиннер с подписью «Ищу в книге…» — ответ по умолчанию для
// любого чата, одинаковый и для поиска по учебнику, и для загрузки аватарки.
// Материал этого продукта другой: печатная страница, знак §, номера страниц,
// поля книги. Поэтому блок сделан ЗАМЕТКОЙ НА ПОЛЯХ — тонкая линейка слева и
// вдоль неё короткие строки о проделанном.
//
// Здесь нет галочек и рамок вокруг этапов: и то и другое превращает заметку в
// чеклист, то есть в ответ по умолчанию для любого агента. Этапов не больше
// трёх по той же причине.
//
// Про рассуждение. `CLAUDE.md` §5.8 требует показывать объяснимый статус
// работы, а не внутренний ход мыслей, поэтому сырое рассуждение свёрнуто и
// открывается по клику. Его может не быть вовсе: панель вопросов идёт на
// DeepSeek V4 Flash без reasoning, и блок обязан работать на одних этапах.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface ThinkingStage {
  /** Стабильный ключ: по нему этап узнаётся между кадрами. */
  key: string;
  label: string;
  /** Этап пройден: метка становится волосяной. */
  done: boolean;
}

interface ThinkingNoteProps {
  stages: ThinkingStage[];
  /** Сырое рассуждение модели. Пусто — блок живёт на одних этапах. */
  reasoning?: string;
  /** Работа идёт: тикает таймер, рассуждение прокручивается. */
  streaming: boolean;
  /** Итоговая длительность, мс. Есть только когда `streaming` уже false. */
  durationMs?: number;
  /** Приписка к свёрнутой строке: «8 фрагментов». */
  summary?: string;
}

function formatSeconds(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  // 1 секунду, 2–4 секунды, 5+ секунд — иначе выходит «Думал 2 секунд».
  const mod10 = seconds % 10;
  const mod100 = seconds % 100;
  let word = "секунд";
  if (mod10 === 1 && mod100 !== 11) word = "секунду";
  else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    word = "секунды";
  }
  return `${seconds} ${word}`;
}

export function ThinkingNote({
  stages,
  reasoning = "",
  streaming,
  durationMs,
  summary,
}: ThinkingNoteProps) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();

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

  // Пока идёт работа — держим последнюю строку рассуждения в поле зрения.
  useEffect(() => {
    if (streaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [reasoning, streaming]);

  // Длительность — самостоятельная информация: «Думал 3 секунды» стоит
  // показать, даже когда ни рассуждения, ни сводки нет.
  if (!streaming && !reasoning && !summary && !durationMs) return null;

  // ── Работа идёт: заметка на полях ──
  if (streaming) {
    return (
      <div className="rounded-[14px] border border-[#e3ddd3] bg-[#f7f3ec] px-3.5 py-2.5">
        <div className="flex gap-2.5">
          {/* Линейка полей. Она и делает блок заметкой, а не индикатором. */}
          <span
            aria-hidden
            className="mt-1 w-px shrink-0 self-stretch bg-[#dcd5c8]"
          />
          <div className="min-w-0 flex-1 space-y-1">
            {stages.map((stage, index) => (
              <motion.div
                key={stage.key}
                initial={reduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                className="flex items-center gap-2"
              >
                <StageMark active={!stage.done} reduced={Boolean(reduced)} />
                <span
                  className={`truncate text-[12px] ${
                    stage.done
                      ? "text-[#989086]"
                      : "font-medium text-[#61574c]"
                  }`}
                >
                  {stage.label}
                </span>
                {index === 0 && (
                  <span className="ml-auto shrink-0 tabular-nums text-[11px] text-[#8d857c]">
                    {Math.max(0, Math.round(elapsed / 1000))}с
                  </span>
                )}
              </motion.div>
            ))}

            {reasoning && (
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => setExpanded((value) => !value)}
                  className="flex items-center gap-1 text-[11px] text-[#a09890] transition-colors hover:text-[#61574c]"
                >
                  <motion.span
                    animate={{ rotate: expanded ? 90 : 0 }}
                    transition={{ duration: 0.18 }}
                  >
                    <ChevronRight className="h-3 w-3" />
                  </motion.span>
                  ход рассуждений
                </button>
                {expanded && (
                  <div
                    ref={scrollRef}
                    className="mt-1 max-h-[76px] overflow-hidden text-[11.5px] leading-[1.5] text-[#8a8177]"
                    style={{
                      // Верхние строки растворяются: бегущий текст не должен
                      // выглядеть обрезанным по прямой.
                      maskImage:
                        "linear-gradient(to bottom, transparent, #000 22px)",
                      WebkitMaskImage:
                        "linear-gradient(to bottom, transparent, #000 22px)",
                    }}
                  >
                    {reasoning}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Работа окончена: одна тихая строка ──
  const parts = [
    durationMs ? `Думал ${formatSeconds(durationMs)}` : "Ход работы",
    summary,
  ].filter(Boolean);

  return (
    <div className="rounded-[14px] border border-[#e6e1d8] bg-[#faf8f4]">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        disabled={!reasoning}
        className="flex w-full items-center gap-1.5 px-3.5 py-2 text-left text-[11.5px] text-[#8d857c] transition-colors hover:text-[#61574c] disabled:hover:text-[#8d857c]"
      >
        {reasoning ? (
          <motion.span
            animate={{ rotate: expanded ? 90 : 0 }}
            transition={{ duration: 0.18 }}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </motion.span>
        ) : (
          <span aria-hidden className="h-1 w-1 rounded-full bg-[#c9c2b6]" />
        )}
        <span>{parts.join(" · ")}</span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && reasoning && (
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

/** Метка этапа: живая пульсирует, пройденная — волосяная. */
function StageMark({ active, reduced }: { active: boolean; reduced: boolean }) {
  if (!active) {
    return (
      <span
        aria-hidden
        className="h-1 w-1 shrink-0 rounded-full border border-[#c9c2b6]"
      />
    );
  }
  return (
    <motion.span
      aria-hidden
      className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#b7792d]"
      animate={reduced ? undefined : { opacity: [1, 0.25, 1], scale: [1, 0.8, 1] }}
      transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

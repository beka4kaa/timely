// Один модуль: заголовок-раскрывашка и список тем.
//
// Нумерация здесь честная: модули — это упорядоченная последовательность
// (`order_index`), и порядок несёт смысл, который ученику нужен. Поэтому номер
// стоит рядом с названием, а не как декоративный маркер.

"use client";

import { ChevronDown } from "lucide-react";
import { useState } from "react";

import type { CourseModule } from "@/lib/curriculum-api";
import { formatMinutes } from "@/lib/curriculum-progress";
import { PlanTopicRow } from "./plan-topic-row";
import { moduleTone, paperCard, paperFocus, paperNumber } from "./paper";

export function PlanModuleStrip({
  courseModule,
  index,
  moduleCount,
  titles,
  hoveredTopicId,
  onHoverTopic,
}: {
  // Имя `module` роняет @next/next/no-assign-module-variable — на это уже
  // наступали в предыдущей версии экрана.
  courseModule: CourseModule;
  index: number;
  moduleCount: number;
  titles: Map<string, string>;
  hoveredTopicId: string | null;
  onHoverTopic: (topicId: string | null) => void;
}) {
  const [open, setOpen] = useState(index === 0);
  const minutes = courseModule.topics.reduce(
    (sum, topic) => sum + (topic.estimated_minutes || 0),
    0,
  );

  return (
    <section className={`${paperCard} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className={`${paperFocus} flex w-full items-start gap-4 px-5 py-4 text-left transition-colors hover:bg-[#f8f3ea]`}
      >
        <span
          aria-hidden
          className="mt-1 h-8 w-[3px] shrink-0 rounded-full"
          style={{ background: moduleTone(index, moduleCount) }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={`${paperNumber} shrink-0 text-[13px] text-[#a1978b]`}>
              {/* Номер главы из книги, если он есть: рядом с «Глава 3» свой
                  порядковый номер списка читался бы как «6 Глава 3». */}
              {courseModule.number_label || index + 1}
            </span>
            <span className="truncate font-serif text-[17px] tracking-[-0.02em] text-[#302b26]">
              {courseModule.title}
            </span>
          </span>
          {courseModule.objective && (
            <span className="mt-1 block text-[12px] leading-5 text-[#7f776e]">
              {courseModule.objective}
            </span>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-3 pt-1 text-[11px] text-[#9b9186]">
          <span className={paperNumber}>
            {courseModule.topics.length} тем · {formatMinutes(minutes)}
          </span>
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          />
        </span>
      </button>

      {open && (
        <ul className="border-t border-[#e7e1d7] px-2 pb-2 pt-1">
          {courseModule.topics.map((topic) => (
            <PlanTopicRow
              key={topic.id}
              topic={topic}
              moduleIndex={index}
              moduleCount={moduleCount}
              titles={titles}
              hovered={hoveredTopicId === topic.id}
              onHover={onHoverTopic}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

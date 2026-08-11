// Строка темы — доступный путь к корешку.
//
// Отрезки на полосе не являются табстопами, поэтому клавиатурный фокус ЗДЕСЬ
// обязан подсвечивать полосу: иначе связь «тема ↔ страницы книги» доступна
// только мышью, а это и есть главное содержание экрана.

"use client";

import { formatMinutes, uniqueSourceLabels } from "@/lib/curriculum-progress";
import type { CourseTopic } from "@/lib/curriculum-api";
import { paperFocus, paperNumber } from "./paper";

export function PlanTopicRow({
  topic,
  titles,
  hovered,
  onHover,
}: {
  topic: CourseTopic;
  titles: Map<string, string>;
  hovered: boolean;
  onHover: (topicId: string | null) => void;
}) {
  const sources = uniqueSourceLabels(topic.sources);

  return (
    <li>
      <div
        tabIndex={0}
        onMouseEnter={() => onHover(topic.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(topic.id)}
        onBlur={() => onHover(null)}
        className={`${paperFocus} relative rounded-[10px] px-4 py-3 transition-colors ${
          hovered ? "bg-[#fdf7ec]" : "bg-transparent"
        }`}
      >
        {/* Тот же тон, каким на пути загорается глава этой темы: связь между
            строкой и её местом во времени держится одной краской. Прежде здесь
            был оттенок модуля из легенды корешка — легенды больше нет. */}
        <span
          aria-hidden
          className={`absolute left-0 top-3 h-[calc(100%-1.5rem)] w-[3px] rounded-full bg-[#b7792d] transition-opacity duration-150 ${
            hovered ? "opacity-100" : "opacity-0"
          }`}
        />

        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[14px] leading-6 text-[#302b26]">{topic.title}</p>
            {topic.objective && (
              <p className="mt-0.5 text-[12px] leading-5 text-[#7f776e]">
                {topic.objective}
              </p>
            )}
          </div>
          <span className={`${paperNumber} shrink-0 text-[12px] text-[#8b8278]`}>
            {formatMinutes(topic.estimated_minutes)}
          </span>
        </div>

        {sources.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#9a6630]">
            {sources.map((label) => (
              <span key={`${topic.id}-${label}`} className={paperNumber}>
                {label}
              </span>
            ))}
          </p>
        )}

        {topic.prerequisites.length > 0 && (
          <p className="mt-1.5 text-[11px] text-[#9b9186]">
            {/* Названия, а не external_id: «kinematics_basics» ученику ничего
                не говорит. */}
            Сначала: {topic.prerequisites.map((id) => titles.get(id) ?? id).join(", ")}
          </p>
        )}
      </div>
    </li>
  );
}

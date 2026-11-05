// Строка темы: что учить, где в книге и сколько времени.
//
// На строке только главное. Цель темы, все ссылки на страницы и что нужно знать заранее
// раскрываются по нажатию: тем в курсе бывает полторы сотни, и все подробности разом
// превратили бы список в стену текста.
//
// Наведение и фокус подсвечивают главу на пути: так тема находит своё место во времени.

"use client";

import type { CourseTopic } from "@/lib/curriculum-api";
import type { StepState } from "@/lib/curriculum-course-progress";
import { formatMinutes, formatSource, uniqueSourceLabels } from "@/lib/curriculum-progress";

export function PlanTopicRow({
  topic,
  titles,
  state,
  sourceTitle,
  onHover,
  onAsk,
}: {
  topic: CourseTopic;
  titles: Map<string, string>;
  state: StepState;
  /** Название источника: «Физика 9». Пусто у программ без книги. */
  sourceTitle: string;
  onHover: (topicId: string | null) => void;
  onAsk: (text: string) => void;
}) {
  const sources = uniqueSourceLabels(topic.sources);
  const page = shortPlace(topic.sources);

  return (
    <li
      className={state === "todo" ? undefined : state}
      data-attach={`Тема «${topic.title}»`}
      onMouseEnter={() => onHover(topic.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(topic.id)}
      onBlur={() => onHover(null)}
    >
      <details>
        <summary>
          <span>{topic.title}</span>
          <span className="m pg" title={sources.join("; ")}>
            {page}
          </span>
          <span className="m">{formatMinutes(topic.estimated_minutes)}</span>
        </summary>
        <div className="tp-more">
          {topic.objective ? <p>{topic.objective}</p> : null}
          {sources.length > 0 ? (
            <p className="muted">
              Источник: {sourceTitle ? `«${sourceTitle}», ` : ""}
              {sources.join("; ")}
            </p>
          ) : null}
          {topic.prerequisites.length > 0 ? (
            <p className="muted">
              {/* Названия, а не external_id: «kinematics_basics» ученику ничего не говорит. */}
              Сначала: {topic.prerequisites.map((id) => titles.get(id) ?? id).join(", ")}
            </p>
          ) : null}
          {topic.mastery_criteria ? (
            <p className="muted">Готово, когда: {topic.mastery_criteria}</p>
          ) : null}
          <button
            type="button"
            className="btn btn-text"
            onClick={() => onAsk(`Помоги разобраться с темой «${topic.title}»`)}
          >
            Спросить про тему
          </button>
        </div>
      </details>
    </li>
  );
}

/** В колонке строки только страницы: полная ссылка на раздел живёт в подробностях. */
function shortPlace(sources: CourseTopic["sources"]): string {
  const first = sources.find((source) => (source.page_start ?? 0) > 0);
  if (first) return formatSource({ page_start: first.page_start, page_end: first.page_end });
  return sources[0] ? formatSource(sources[0]) : "";
}

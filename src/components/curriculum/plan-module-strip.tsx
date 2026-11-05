// Одна глава программы: раскрывашка со списком тем.
//
// Порядок глав несёт смысл, поэтому номер из книги стоит рядом с названием. Текущая глава
// открыта сразу и лежит на карточке, остальные просто строки: глаз находит место сразу.

"use client";

import { useEffect, useState } from "react";

import type { CourseModule } from "@/lib/curriculum-api";
import type { CourseStates, StepState } from "@/lib/curriculum-course-progress";
import { formatMinutes } from "@/lib/curriculum-progress";
import { plural } from "@/lib/now-feed";

import { PlanTopicRow } from "./plan-topic-row";

export function PlanModuleStrip({
  courseModule,
  states,
  titles,
  sourceTitle,
  onHoverTopic,
  onAsk,
}: {
  // Имя `module` роняет @next/next/no-assign-module-variable.
  courseModule: CourseModule;
  states: CourseStates;
  titles: Map<string, string>;
  sourceTitle: string;
  onHoverTopic: (topicId: string | null) => void;
  onAsk: (text: string) => void;
}) {
  const state: StepState = states.modules.get(courseModule.id)?.state ?? "todo";
  const current = state === "cur";
  const [open, setOpen] = useState(current);

  // Текущая глава могла смениться после пересчёта: открываем её, чужие не трогаем.
  useEffect(() => {
    if (current) setOpen(true);
  }, [current]);

  const minutes =
    courseModule.estimated_minutes ||
    courseModule.topics.reduce((sum, topic) => sum + (topic.estimated_minutes || 0), 0);
  const count = courseModule.topics.length;

  return (
    <details
      className={current ? "mod is-cur card" : "mod"}
      open={open}
      data-attach={`Глава «${courseModule.title}»`}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className={state === "todo" ? "dot" : `dot ${state}`} aria-hidden="true" />
        <span className="mt">
          {courseModule.number_label ? (
            <span className="mod-num">{courseModule.number_label} </span>
          ) : null}
          {courseModule.title}
        </span>
        <span className="m mc">
          {count} {plural(count, ["тема", "темы", "тем"])}, {formatMinutes(minutes)}
        </span>
      </summary>

      {/* Содержимое не рисуем, пока глава закрыта: тем в курсе бывает полторы сотни. */}
      {open ? (
        <>
          {courseModule.objective ? <p className="mod-goal">{courseModule.objective}</p> : null}
          <ul className="tps course-tps">
            {courseModule.topics.map((topic) => (
              <PlanTopicRow
                key={topic.id}
                topic={topic}
                titles={titles}
                state={states.topics.get(topic.id) ?? "todo"}
                sourceTitle={sourceTitle}
                onHover={onHoverTopic}
                onAsk={onAsk}
              />
            ))}
          </ul>
          <p className="mod-ask">
            <button
              type="button"
              className="btn btn-text"
              onClick={() => onAsk(`Что важно понять в главе «${courseModule.title}»?`)}
            >
              Спросить про главу
            </button>
          </p>
        </>
      ) : null}
    </details>
  );
}

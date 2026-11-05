// Список глав программы.

"use client";

import type { CoursePlan } from "@/lib/curriculum-api";
import type { CourseStates } from "@/lib/curriculum-course-progress";

import { PlanModuleStrip } from "./plan-module-strip";

/** external_id → название темы: prerequisites приезжают идентификаторами. */
export function titleByExternalId(plan: CoursePlan): Map<string, string> {
  const titles = new Map<string, string>();
  for (const courseModule of plan.modules) {
    for (const topic of courseModule.topics) titles.set(topic.external_id, topic.title);
  }
  return titles;
}

export function PlanModules({
  plan,
  states,
  sourceTitle,
  onHoverTopic,
  onAsk,
}: {
  plan: CoursePlan;
  states: CourseStates;
  sourceTitle: string;
  onHoverTopic: (topicId: string | null) => void;
  onAsk: (text: string) => void;
}) {
  const titles = titleByExternalId(plan);

  return (
    <div className="course-mods">
      {plan.modules.map((courseModule, index) => {
        // Заголовок части печатается там же, где в книге: перед первой её главой. Модули идут
        // в порядке книги, поэтому достаточно сравнить с предыдущим.
        const partStarts =
          Boolean(courseModule.part_title) &&
          courseModule.part_title !== plan.modules[index - 1]?.part_title;

        return (
          <div key={courseModule.id}>
            {partStarts ? <h2 className="sec course-part">{courseModule.part_title}</h2> : null}
            <PlanModuleStrip
              courseModule={courseModule}
              states={states}
              titles={titles}
              sourceTitle={sourceTitle}
              onHoverTopic={onHoverTopic}
              onAsk={onAsk}
            />
          </div>
        );
      })}
    </div>
  );
}

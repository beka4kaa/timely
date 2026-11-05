// Путь курса: главы на оси времени от начала до финиша.
//
// Все настоящие вопросы ученика лежат на этой оси: где я сейчас, когда закончу, успею ли к
// сроку. Ширина главы это её часы, поэтому двенадцатичасовая и сорокаминутная главы наконец
// выглядят по-разному.
//
// Монохром: заполнено то, что пройдено. Единственная вольность на всю страницу это срок, за
// который курс вылезает: его отметка красная, а главы правее неё нарисованы контуром. «Не
// успеваю» должно быть видно, а не прочитано в сноске.

"use client";

import { useMemo, useRef, useState } from "react";

import type { CourseStates } from "@/lib/curriculum-course-progress";
import { dayMonth, formatShortDate } from "@/lib/curriculum-forecast";
import {
  type AxisLabelInput,
  type CoursePath,
  type PathBlock,
  axisWarp,
  placeAxisLabels,
} from "@/lib/curriculum-path";

import { useElementWidth } from "./use-element-width";

/** Уже этого подпись главы превращается в многоточие, и лучше её не печатать. */
const MIN_LABEL_PX = 56;

/** Запасная ширина, пока карточку ещё не измерили. */
const DEFAULT_WIDTH = 900;

/** Больше этой доли оси запас на рисунке не занимает: иначе главам не остаётся места. */
const MAX_REST_PCT = 26;

export function PlanPath({
  path,
  states,
  hoveredModuleId,
}: {
  path: CoursePath;
  states: CourseStates;
  /**
   * Глава наведённой в списке темы. Связь односторонняя: строка темы находит своё место во
   * времени, а обратно с оси в список вести незачем.
   */
  hoveredModuleId: string | null;
}) {
  const cardRef = useRef<HTMLElement>(null);
  // Без внутренних полей карточки: отметки стоят на дорожке.
  const width = useElementWidth(cardRef, DEFAULT_WIDTH) - 36;
  const [hovered, setHovered] = useState<string | null>(null);

  const warp = useMemo(() => axisWarp(path.coursePct, MAX_REST_PCT), [path.coursePct]);
  const labels = useMemo(() => placeAxisLabels(axisLabels(path, warp), width), [path, warp, width]);
  const current = path.blocks.find((block) => block.moduleId === states.currentModuleId);
  const fits = (widthPct: number) => (widthPct / 100) * width >= MIN_LABEL_PX;
  const restPct = 100 - warp(path.coursePct);
  const overdue = (path.today?.atPct ?? 0) > path.coursePct;
  const shownWidth = (block: PathBlock) =>
    warp(block.startPct + block.widthPct) - warp(block.startPct);
  // Глав много, и ни одной подписи не поместилось: пустую строку под дорожкой не держим.
  const anyLabel = path.blocks.some((block) => fits(shownWidth(block)));
  // Подпись текущей главы отдельной строкой, если на своём месте ей тесно.
  const currentFits = current ? fits(shownWidth(current)) : false;

  return (
    <section
      ref={cardRef}
      className={[
        "path card course-path",
        labels.length === 0 ? "no-marks" : "",
        anyLabel ? "" : "no-labels",
        currentFits ? "" : "cur-outside",
      ]
        .filter(Boolean)
        .join(" ")}
      role="img"
      aria-label={axisLabel(path, states)}
    >
      {labels.map((label) => (
        <span
          key={label.key}
          className={[
            "path-mark timely-path-mark",
            label.kind === "end" ? "end" : "",
            label.align === "start" ? "mile" : "",
            label.kind === "over" ? "is-over" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={{ "--f": label.atPct / 100 } as React.CSSProperties}
        >
          {label.text}
        </span>
      ))}

      {path.today && path.today.atPct > 0 ? (
        <span
          className="path-tick timely-path-mark"
          style={{ "--f": warp(path.today.atPct) / 100 } as React.CSSProperties}
        />
      ) : null}
      {path.deadline && path.deadline.atPct < 100 ? (
        <span
          className={`path-tick is-deadline timely-path-mark${path.overshootPct > 0 ? " is-over" : ""}`}
          style={{ "--f": warp(path.deadline.atPct) / 100 } as React.CSSProperties}
        />
      ) : null}
      {path.milestones.map((milestone) => (
        <span
          key={milestone.id}
          className="path-dot timely-path-mark"
          title={milestone.title}
          style={{ "--f": warp(milestone.atPct) / 100 } as React.CSSProperties}
        />
      ))}

      <div className="path-track">
        {path.blocks.map((block, index) => {
          const state = states.modules.get(block.moduleId);
          const active = hoveredModuleId === block.moduleId || hovered === block.moduleId;
          const first = path.blocks.findIndex((item) => item.moduleId === block.moduleId) === index;
          const fill = pieceFill(path.blocks, block, state?.percent ?? 0);
          return (
            <div
              key={block.key}
              className={[
                state?.state === "done" ? "done" : "",
                state?.state === "cur" ? "cur" : "",
                active ? "is-hot" : "",
                block.beyondDeadline ? "is-over" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--h": shownWidth(block) } as React.CSSProperties}
              title={blockTitle(block)}
              onMouseEnter={() => setHovered(block.moduleId)}
              onMouseLeave={() => setHovered(null)}
            >
              <span
                className="tube timely-path-block"
                style={{ animationDelay: `${Math.min(index, 24) * 25}ms` }}
              >
                {fill > 0 ? <i style={{ width: `${fill}%` }} /> : null}
              </span>
              <b>{first && fits(shownWidth(block)) ? block.title : "\u00a0"}</b>
            </div>
          );
        })}
        {restPct > 0 ? (
          // Что осталось на оси за последней главой. Если сегодня уже там, это не запас, а
          // просрочка, и подписывать её запасом нельзя.
          <div className="path-rest" style={{ "--h": restPct } as React.CSSProperties} aria-hidden="true">
            {overdue ? null : <span className="tube timely-path-block" />}
            <b>{!overdue && fits(restPct) ? "запас" : "\u00a0"}</b>
          </div>
        ) : null}
      </div>

      {/* Подписи глав не поместились: остаётся только текущая. */}
      {current ? <p className="path-now">{current.title}</p> : null}
    </section>
  );
}

/** Сколько процентов этого куска закрашено. Глава, разрезанная сроком, заполняется слева. */
function pieceFill(blocks: readonly PathBlock[], block: PathBlock, percent: number): number {
  if (percent <= 0) return 0;
  const pieces = blocks.filter((item) => item.moduleId === block.moduleId);
  const whole = pieces.reduce((sum, item) => sum + item.widthPct, 0);
  if (whole <= 0) return 0;
  const before = pieces
    .slice(0, pieces.indexOf(block))
    .reduce((sum, item) => sum + item.widthPct, 0);
  const filled = (whole * percent) / 100 - before;
  return Math.max(0, Math.min(100, (filled / block.widthPct) * 100));
}

function axisLabels(path: CoursePath, warp: (atPct: number) => number) {
  const labels: AxisLabelInput[] = [];
  if (!path.dated) return labels;

  // Конец оси это самая поздняя дата: срок, если он позже финиша, иначе сам финиш.
  const deadlineAtEnd = path.deadline && path.deadline.atPct >= 99.5;
  const lastFinish = [path.finish.realistic, path.finish.expected].find(
    (mark) => mark && mark.atPct >= 99.5,
  );
  if (deadlineAtEnd && path.deadline) {
    labels.push({ key: "end", kind: "end", atPct: 100, text: `срок ${dayMonth(path.deadline.date)}` });
  } else if (lastFinish) {
    labels.push({ key: "end", kind: "end", atPct: 100, text: dayMonth(lastFinish.date) });
  }

  if (path.today) labels.push({ key: "today", kind: "today", atPct: warp(path.today.atPct), text: "сегодня" });

  if (path.deadline && !deadlineAtEnd) {
    labels.push({
      key: "deadline",
      kind: path.overshootPct > 0 ? "over" : "mile",
      atPct: warp(path.deadline.atPct),
      text: `срок ${dayMonth(path.deadline.date)}`,
    });
  }

  for (const milestone of path.milestones) {
    labels.push({ key: milestone.id, kind: "mile", atPct: warp(milestone.atPct), text: milestone.title });
  }
  return labels;
}

function blockTitle(block: PathBlock): string {
  if (!block.startDate || !block.endDate) return block.title;
  return `${block.title}: ${formatShortDate(block.startDate)} – ${formatShortDate(block.endDate)}`;
}

function axisLabel(path: CoursePath, states: CourseStates): string {
  const count = new Set(path.blocks.map((block) => block.moduleId)).size;
  const parts = [`Путь курса: глав ${count}`];
  const current = path.blocks.find((block) => block.moduleId === states.currentModuleId);
  if (current) parts.push(`сейчас глава «${current.title}»`);
  if (path.finish.expected) parts.push(`финиш ${dayMonth(path.finish.expected.date)}`);
  if (path.deadline) {
    parts.push(
      path.overshootPct > 0
        ? `срок ${dayMonth(path.deadline.date)}, курс выходит за него`
        : `срок ${dayMonth(path.deadline.date)}, курс укладывается`,
    );
  }
  return `${parts.join(", ")}.`;
}

"use client";

import React from "react";
import { motion } from "framer-motion";
import type { LabelPlacement } from "@/lib/illustration-contrast";

interface IllustrationLeaderLinesProps {
  placements: ReadonlyArray<LabelPlacement>;
  animate?: boolean;
  /** Подпись под курсором/в фокусе — её магнитная связь подсвечивается. */
  activeIndex?: number | null;
}

/**
 * Общий слой выносок для обоих рендереров иллюстраций.
 *
 * Геометрия приходит из useSmartLabels: start уже лежит за внешней границей
 * bbox подписи, а весь сегмент проверен на пересечения с остальными подписями.
 */
export function IllustrationLeaderLines({
  placements,
  animate = false,
  activeIndex = null,
}: IllustrationLeaderLinesProps) {
  const visible = placements
    .map((placement, index) => ({ connector: placement.connector, index }))
    .filter((item): item is { connector: NonNullable<LabelPlacement["connector"]>; index: number } =>
      item.connector != null);

  if (visible.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
      data-illustration-leader-layer="true"
      className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-[#777168]"
      style={{ zIndex: 15 }}
    >
      {visible.map(({ connector, index }) => {
        const active = activeIndex === index;
        const geometry = (
          <>
            <line
              data-label-index={index}
              data-active={active ? "true" : "false"}
              x1={`${connector.start.x}%`}
              y1={`${connector.start.y}%`}
              x2={`${connector.end.x}%`}
              y2={`${connector.end.y}%`}
              stroke="currentColor"
              strokeOpacity={active ? "0.82" : "0.36"}
              strokeWidth={active ? "1.25" : "1"}
              strokeLinecap="round"
              style={{
                transition: "stroke-opacity 160ms ease, stroke-width 160ms ease",
              }}
            />
            {active && (
              <circle
                cx={`${connector.end.x}%`}
                cy={`${connector.end.y}%`}
                r="2"
                fill="currentColor"
                fillOpacity="0.82"
              />
            )}
          </>
        );

        return animate ? (
          <motion.g
            key={index}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.35, delay: 0.2 }}
          >
            {geometry}
          </motion.g>
        ) : (
          <g key={index}>{geometry}</g>
        );
      })}
    </svg>
  );
}

export default IllustrationLeaderLines;

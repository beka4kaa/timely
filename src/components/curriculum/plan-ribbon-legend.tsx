// Ключ к тонам корешка: какой модуль каким оттенком закрашен.
//
// Легенда нужна ровно потому, что заливка кодирует модуль, а не абстрактный
// прогресс. Без неё полоса читалась бы как градиент ради красоты.

"use client";

import { moduleTone } from "./paper";

export function PlanRibbonLegend({
  moduleTitles,
  hoveredModuleIndex,
}: {
  moduleTitles: string[];
  hoveredModuleIndex: number | null;
}) {
  if (moduleTitles.length === 0) return null;

  return (
    <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
      {moduleTitles.map((title, index) => (
        <li
          key={`${index}-${title}`}
          className="flex min-w-0 items-center gap-2 text-[12px] transition-opacity duration-150"
          style={{
            opacity:
              hoveredModuleIndex !== null && hoveredModuleIndex !== index ? 0.4 : 1,
          }}
        >
          <span
            aria-hidden
            className="h-2.5 w-6 shrink-0 rounded-[2px]"
            style={{ background: moduleTone(index, moduleTitles.length) }}
          />
          <span className="truncate text-[#6f675e]">{title}</span>
        </li>
      ))}
    </ul>
  );
}

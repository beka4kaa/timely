"use client";

// `<main>` дашборда, который умеет уступать место панели вопросов.
//
// Отдельный клиентский компонент нужен только ради одного: ширина контента
// зависит от того, открыта ли панель, а `layout.tsx` — серверный. Тот же приём,
// что у доски (`board-layout.tsx`), где холст сдвигается на ширину чата, а не
// уходит под него.

import { useAskRail } from "@/contexts/ask-rail";

/**
 * Ширина панели. Та же доля и тот же минимум, что у чата доски.
 *
 * Одно выражение на обе стороны намеренно. Пока ширина панели и сдвиг `main`
 * задавались порознь («25%» и `min-w-[280px]`), на окне около 900 пикселей они
 * расходились: четверть — это 225 пикселей, панель растягивалась до 280, а
 * контент сдвигался только на 225 — и панель наезжала на страницу.
 */
export const RAIL_WIDTH = "max(25%, 280px)";

export function DashboardMain({ children }: { children: React.ReactNode }) {
  const { open, isMobile } = useAskRail();
  const pushed = open && !isMobile;

  return (
    <main
      className="timely-dashboard-surface fixed bottom-0 left-0 right-0 top-12 z-[95] overflow-auto transition-[right] duration-300 ease-in-out md:left-[58px]"
      // `right` инлайном, а не классом: значение то же, что у панели, и держать
      // их в одном месте надёжнее, чем сверять два тейлвинд-класса.
      style={{ right: pushed ? RAIL_WIDTH : 0, minWidth: pushed ? 0 : undefined }}
    >
      {children}
    </main>
  );
}

"use client";

// `<main>` дашборда, который умеет уступать место панели вопросов.
//
// Отдельный клиентский компонент нужен только ради одного: ширина контента
// зависит от того, открыта ли панель, а `layout.tsx` — серверный. Тот же приём,
// что у доски (`board-layout.tsx`), где холст сдвигается на ширину чата, а не
// уходит под него.

import { useAskRail } from "@/contexts/ask-rail";

export function DashboardMain({ children }: { children: React.ReactNode }) {
  const { open, isMobile, width, dragging } = useAskRail();
  const pushed = open && !isMobile;

  return (
    <main
      className={`timely-dashboard-surface fixed bottom-0 left-0 right-0 top-12 z-[95] overflow-auto md:left-[58px] ${
        // Плавность нужна при сворачивании, но не при перетаскивании: с ней
        // край страницы отстаёт от курсора на треть секунды, и тянуть кромку
        // ощущается как каша.
        dragging ? "" : "transition-[right] duration-300 ease-in-out"
      }`}
      // Ширина инлайном: то же число, что у самой панели. Держать их в двух
      // тейлвинд-классах значило бы сверять два места при каждой правке.
      style={{ right: pushed ? width : 0 }}
    >
      {children}
    </main>
  );
}

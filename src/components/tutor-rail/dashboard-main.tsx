"use client";

// Колонка страницы. Скроллится внутри себя: у страниц вроде чата есть `h-full`, и им
// нужна определённая высота. Это же контейнер для запросов @container main.

export function DashboardMain({ children }: { children: React.ReactNode }) {
  return <main className="main timely-dashboard-surface">{children}</main>;
}

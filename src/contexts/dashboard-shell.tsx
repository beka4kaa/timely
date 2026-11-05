"use client";

// Состояние каркаса, которое делят между собой панель и страницы.
//
// Список чатов лежит в левой панели, а движок разговора живёт на странице чата:
// страница рисует список порталом в это место.

import { createContext, useContext, useMemo, useState } from "react";

interface DashboardShellValue {
  /** Место под список чатов в левой панели. `null`, пока панель не смонтирована. */
  chatsSlot: HTMLElement | null;
  setChatsSlot: (element: HTMLElement | null) => void;
}

const DashboardShellContext = createContext<DashboardShellValue>({
  chatsSlot: null,
  setChatsSlot: () => {},
});

export function DashboardShellProvider({ children }: { children: React.ReactNode }) {
  const [chatsSlot, setChatsSlot] = useState<HTMLElement | null>(null);
  const value = useMemo(() => ({ chatsSlot, setChatsSlot }), [chatsSlot]);
  return <DashboardShellContext.Provider value={value}>{children}</DashboardShellContext.Provider>;
}

export function useDashboardShell() {
  return useContext(DashboardShellContext);
}

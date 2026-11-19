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
  /** На телефоне левая панель выезжает слева: открыта ли она сейчас. */
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const DashboardShellContext = createContext<DashboardShellValue>({
  chatsSlot: null,
  setChatsSlot: () => {},
  drawerOpen: false,
  setDrawerOpen: () => {},
});

export function DashboardShellProvider({ children }: { children: React.ReactNode }) {
  const [chatsSlot, setChatsSlot] = useState<HTMLElement | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const value = useMemo(
    () => ({ chatsSlot, setChatsSlot, drawerOpen, setDrawerOpen }),
    [chatsSlot, drawerOpen],
  );
  return <DashboardShellContext.Provider value={value}>{children}</DashboardShellContext.Provider>;
}

export function useDashboardShell() {
  return useContext(DashboardShellContext);
}

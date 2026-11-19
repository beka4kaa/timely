"use client";

// Телефон: круглая стеклянная кнопка слева сверху открывает левую панель.
// Нижней панели нет: страница остаётся чистой, меню — одним нажатием или свайпом.

import { Icon } from "@/components/shell/icons";
import { useDashboardShell } from "@/contexts/dashboard-shell";
import { t } from "@/lib/i18n";

import { useDrawerSwipe } from "./drawer-swipe";

export function MenuButton() {
  const { drawerOpen, setDrawerOpen } = useDashboardShell();
  useDrawerSwipe(drawerOpen, setDrawerOpen);

  return (
    <>
      <button
        className="menu-fab glass"
        type="button"
        aria-label={t("Меню")}
        title={t("Меню")}
        aria-controls="app-nav"
        aria-expanded={drawerOpen}
        onClick={() => setDrawerOpen(true)}
      >
        <Icon name="menu" />
      </button>
      <div className="nav-scrim" aria-hidden="true" onClick={() => setDrawerOpen(false)} />
    </>
  );
}

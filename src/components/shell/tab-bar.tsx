"use client";

// Телефон: панели нет, внизу вкладки с иконками, остальное под «Ещё».

import Link from "next/link";
import { useEffect, useRef } from "react";

import { Icon, type IconName } from "@/components/shell/icons";
import { useThemeToggle } from "@/components/shell/sidebar";
import {
  dashboardViewOf,
  getDashboardSections,
  type DashboardSectionKey,
  type DashboardView,
  itemMatches,
} from "@/config/dashboard-navigation";
import { TAB_LABEL } from "@/lib/curriculum-books";
import { useDashboardPath } from "@/lib/use-dashboard-path";

const TABS: Array<{ key: string; title: string; icon: IconName; href: string }> = [
  { key: "now", title: "Сейчас", icon: "now", href: "/dashboard" },
  { key: "chat", title: "Тьютор", icon: "chat", href: "/dashboard/chat" },
  { key: "diary", title: "Учёба", icon: "diary", href: "/dashboard/plan" },
  { key: "library", title: TAB_LABEL, icon: "book", href: "/dashboard/curriculum" },
];

const TAB_OF: Partial<Record<DashboardView, string>> = {
  now: "now",
  chat: "chat",
  board: "chat",
  diary: "diary",
  plan: "diary",
  weak: "diary",
  focus: "diary",
  library: "library",
  course: "library",
};
const TAB_ORDER = ["now", "chat", "diary", "library", "more"];

const MORE: Array<{ view: DashboardView; title: string; icon: IconName; href: string }> = [
  { view: "goals", title: "Цели", icon: "mountain", href: "/dashboard/goals" },
  { view: "habits", title: "Привычки", icon: "flame", href: "/dashboard/habits" },
  { view: "contests", title: "Контесты", icon: "flag", href: "/dashboard/arena/solve" },
  { view: "rating", title: "Рейтинг", icon: "medal", href: "/dashboard/leaderboard" },
];
const ME: Array<{ view: DashboardView; title: string; icon: IconName; href: string }> = [
  { view: "profile", title: "Профиль", icon: "user", href: "/dashboard/profile" },
  { view: "prefs", title: "Настройки", icon: "sliders", href: "/dashboard/settings" },
];

export function TabBar() {
  const path = useDashboardPath();
  const view = dashboardViewOf(path);
  const sheet = useRef<HTMLDialogElement>(null);
  const toggleTheme = useThemeToggle();
  const current = TAB_OF[view] ?? "more";

  useEffect(() => {
    if (sheet.current?.open) sheet.current.close();
  }, [path]);

  const item = (link: (typeof MORE)[number]) => (
    <Link
      key={link.view}
      className="nav-item"
      href={link.href}
      aria-current={view === link.view ? "page" : undefined}
      onClick={() => sheet.current?.close()}
    >
      <Icon name={link.icon} />
      <span className="nav-text">{link.title}</span>
    </Link>
  );

  return (
    <>
      <nav className="tabbar glass" aria-label="Разделы" style={{ "--i": TAB_ORDER.indexOf(current) } as React.CSSProperties}>
        <span className="tab-lens" aria-hidden="true" />
        {TABS.map((tab) => (
          <Link key={tab.key} className="tab" href={tab.href} aria-current={current === tab.key ? "page" : undefined}>
            <Icon name={tab.icon} />
            {tab.title}
          </Link>
        ))}
        <button
          className="tab"
          type="button"
          aria-current={current === "more" ? "page" : undefined}
          onClick={() => sheet.current?.showModal()}
        >
          <Icon name="more" />
          Ещё
        </button>
      </nav>
      <dialog
        ref={sheet}
        className="sheet sheet-more"
        aria-label="Другие разделы"
        tabIndex={-1}
        onClick={(event) => {
          // Нажатие мимо листа попадает в сам <dialog>: его подложка часть элемента.
          if (event.target === sheet.current) sheet.current.close();
        }}
      >
        {MORE.map(item)}
        <div className="sheet-sep" />
        {ME.map(item)}
        <button className="nav-item sheet-theme" type="button" onClick={toggleTheme}>
          <Icon name="moon" className="moon" />
          <Icon name="sun" className="sun" />
          <span className="nav-text">Сменить тему</span>
        </button>
      </dialog>
    </>
  );
}

const SUBNAV_SECTION: Record<"study" | "tutor" | "compete" | "grow", DashboardSectionKey> = {
  study: "study",
  tutor: "tutor",
  compete: "contests",
  grow: "growth",
};

/** На телефоне страницы раздела переключаются строкой сверху: вкладка ведёт только на первую. */
export function SubNav({ group }: { group: keyof typeof SUBNAV_SECTION }) {
  const path = useDashboardPath();
  const section = getDashboardSections().find((row) => row.key === SUBNAV_SECTION[group]);
  if (!section || section.items.length < 2) return null;
  return (
    <nav className="subnav" aria-label="Страницы раздела">
      {section.items.map((item) => (
        <Link key={item.url} href={item.url} aria-current={itemMatches(item, path) ? "page" : undefined}>
          {item.title}
        </Link>
      ))}
    </nav>
  );
}

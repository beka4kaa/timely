"use client";

// Левая панель: стекло с подписанными группами.
//
// Внутри две страницы, меню и чаты. В чате панель уезжает слайдом в список разговоров,
// стрелка возвращает меню, а сам список рисует страница чата порталом: у неё движок.

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState } from "react";

import { useFullAccessDenied } from "@/components/full-access-gate";
import { useShellStatus } from "@/components/nav/use-shell-status";
import { mascot } from "@/components/shell/mascot/mascot";
import { Icon, type IconName } from "@/components/shell/icons";
import {
  dashboardViewOf,
  getDashboardSections,
  matchNavigation,
} from "@/config/dashboard-navigation";
import { useDashboardShell } from "@/contexts/dashboard-shell";
import { useDashboardPath } from "@/lib/use-dashboard-path";

const COLLAPSED_KEY = "timely-nav";

export function initialsOf(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "Я";
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/** Значок Timely: тот же слайм, что и маскот, только неподвижный. */
export function SlimeMark({ size = 27 }: { size?: number }) {
  return (
    <svg className="mark" width={size} height={(size * 20) / 27} viewBox="34 80 172 122" aria-hidden="true">
      <path
        className="mk-body"
        d="M199.7 160.0C199.6 155.9 199.1 149.1 198.1 144.1C197.1 139.1 195.6 134.4 193.7 130.0C191.8 125.6 189.4 121.3 186.7 117.4C184.0 113.5 180.9 109.8 177.4 106.6C174.0 103.3 170.1 100.3 166.0 97.8C161.9 95.2 157.5 93.0 152.8 91.3C148.1 89.6 143.3 88.2 137.8 87.3C132.4 86.5 125.9 86.0 120.0 86.0C114.1 86.0 107.6 86.5 102.2 87.3C96.7 88.2 91.9 89.6 87.2 91.3C82.5 93.0 78.1 95.2 74.0 97.8C69.9 100.3 66.0 103.3 62.6 106.6C59.1 109.8 56.0 113.5 53.3 117.4C50.6 121.3 48.2 125.6 46.3 130.0C44.4 134.4 42.9 139.1 41.9 144.1C40.9 149.1 40.4 155.9 40.3 160.0C40.1 164.1 40.4 166.2 41.1 168.8C41.9 171.5 43.0 173.6 44.6 175.8C46.1 177.9 48.0 179.9 50.2 181.7C52.5 183.5 55.1 185.2 58.1 186.7C61.1 188.2 64.4 189.6 68.2 190.7C72.0 191.9 76.0 192.8 80.7 193.6C85.4 194.4 89.6 195.0 96.1 195.4C102.7 195.8 112.0 196.0 120.0 196.0C128.0 196.0 137.3 195.8 143.9 195.4C150.4 195.0 154.6 194.4 159.3 193.6C164.0 192.8 168.0 191.9 171.8 190.7C175.6 189.6 178.9 188.2 181.9 186.7C184.9 185.2 187.5 183.5 189.8 181.7C192.0 179.9 193.9 177.9 195.4 175.8C197.0 173.6 198.1 171.5 198.9 168.8C199.6 166.2 199.9 164.1 199.7 160.0Z"
      />
      <ellipse className="mk-blush" cx="66" cy="162" rx="13" ry="8" />
      <ellipse className="mk-blush" cx="174" cy="162" rx="13" ry="8" />
      <path className="mk-eye" d="M78 150Q93 134 108 150M132 150Q147 134 162 150" />
    </svg>
  );
}

function NavItem({
  href,
  title,
  icon,
  current,
  onClick,
  children,
}: {
  href: string;
  title: string;
  icon: IconName;
  current: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <Link className="nav-item" href={href} title={title} aria-current={current ? "page" : undefined} onClick={onClick}>
      <Icon name={icon} />
      <span className="nav-text">{title}</span>
      {children}
    </Link>
  );
}

export function useThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return useCallback(() => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
    mascot.react("wow", 0.6);
  }, [resolvedTheme, setTheme]);
}

export function Sidebar() {
  const path = useDashboardPath();
  const view = dashboardViewOf(path);
  const { data: session } = useSession();
  const denied = useFullAccessDenied();
  const status = useShellStatus(!denied);
  const { setChatsSlot } = useDashboardShell();
  const toggleTheme = useThemeToggle();
  const { itemUrl } = matchNavigation(path);

  const [collapsed, setCollapsed] = useState(false);
  /** Стрелка назад показывает меню, не уходя из чата. Новый заход в чат снова открывает список. */
  const [menuInChat, setMenuInChat] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  const chatsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(document.documentElement.classList.contains("nav-collapsed"));
  }, []);

  useEffect(() => {
    setMenuInChat(false);
  }, [view]);

  const showChats = view === "chat" && !menuInChat && !collapsed;

  // Страница, которая уехала, не должна ловить фокус по Tab.
  useEffect(() => {
    const from = showChats ? menuRef.current : chatsRef.current;
    const to = showChats ? chatsRef.current : menuRef.current;
    if (!from || !to) return;
    const hadFocus = from.contains(document.activeElement);
    from.inert = true;
    to.inert = false;
    if (hadFocus) {
      to.querySelector<HTMLElement>(showChats ? ".sb-back" : '[aria-current="page"]')?.focus({
        preventScroll: true,
      });
    }
  }, [showChats]);

  const toggleCollapsed = () => {
    const next = !collapsed;
    document.documentElement.classList.toggle("nav-collapsed", next);
    setCollapsed(next);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, next ? "collapsed" : "open");
    } catch {
      // Приватный режим без хранилища: панель просто не запомнит выбор.
    }
  };

  // Нажали на «Чат», уже будучи в чате: адрес не меняется, но ученик хочет обратно к списку.
  // В свёрнутой панели списку негде жить, поэтому панель разворачивается.
  const reopenChats = () => {
    setMenuInChat(false);
    if (collapsed && view === "chat") toggleCollapsed();
  };
  const chatClick = (url: string) => (url === "/dashboard/chat" ? reopenChats : undefined);

  const sections = getDashboardSections();
  const name = session?.user?.name || "Ученик";

  return (
    <aside className="sidebar glass" data-sb={showChats ? "chats" : "main"} aria-label="Навигация">
      <div className="sb-head">
        <Link className="brand" href="/dashboard" aria-label="Timely, на главную">
          <SlimeMark />
          <span className="brand-word">Timely</span>
        </Link>
        <button
          className="icon-btn sb-collapse"
          type="button"
          title={collapsed ? "Развернуть панель" : "Свернуть панель"}
          aria-label={collapsed ? "Развернуть панель" : "Свернуть панель"}
          onClick={toggleCollapsed}
        >
          <Icon name="panel" />
        </button>
      </div>
      <div className="sb-pages">
        <nav className="sb-page nav" ref={menuRef}>
          {sections.map((section) =>
            section.items.length ? (
              <div className="nav-group" key={section.key}>
                <div className="nav-label">{section.title}</div>
                {section.items.map((item) => (
                  <NavItem
                    key={item.url}
                    href={item.url}
                    title={item.title}
                    icon={item.icon}
                    current={itemUrl === item.url}
                    onClick={chatClick(item.url)}
                  >
                    {item.url === "/dashboard/weaknesses" && status.dueReviews > 0 ? (
                      <span className="nav-count" title={`${status.dueReviews} к повторению`}>
                        {status.dueReviews}
                      </span>
                    ) : null}
                    {item.url === "/dashboard/curriculum" && status.ingesting ? (
                      <span className="live" title="Книга ещё обрабатывается" />
                    ) : null}
                  </NavItem>
                ))}
              </div>
            ) : (
              <div className="nav-group" key={section.key}>
                <NavItem
                  href={section.url}
                  title={section.title}
                  icon={section.icon}
                  current={itemUrl === section.url}
                  onClick={chatClick(section.url)}
                >
                  {section.key === "now" && status.live ? <span className="live" title="Идёт занятие" /> : null}
                </NavItem>
              </div>
            ),
          )}
        </nav>
        <div className="sb-page sb-chats" ref={chatsRef}>
          <div className="sb-top">
            <button
              className="icon-btn sb-back"
              type="button"
              title="Назад в меню"
              aria-label="Назад в меню"
              onClick={() => setMenuInChat(true)}
            >
              <Icon name="chev-l" />
            </button>
            <span className="sb-title">Чаты</span>
          </div>
          <div className="sb-chats-slot" ref={setChatsSlot} />
        </div>
      </div>
      <div className="sb-foot">
        <Link
          className="me"
          href="/dashboard/profile"
          title="Профиль и настройки"
          aria-current={view === "profile" || view === "prefs" ? "page" : undefined}
        >
          <span className="avatar" aria-hidden="true">
            {initialsOf(session?.user?.name)}
          </span>
          <span className="me-name">{name}</span>
        </Link>
        <button
          className="icon-btn theme-btn"
          type="button"
          aria-label="Сменить тему"
          title="Сменить тему"
          onClick={toggleTheme}
        >
          <Icon name="moon" className="moon" />
          <Icon name="sun" className="sun" />
        </button>
      </div>
    </aside>
  );
}

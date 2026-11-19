"use client";

// Левая панель: сверху всегда видны Сейчас, Тьютор, Неделя и Помодоро, ниже три группы,
// которые раскрываются на месте (что открыто, панель помнит).
//
// Внутри две страницы, меню и чаты. В чате панель уезжает слайдом в список разговоров,
// стрелка возвращает меню, а сам список рисует страница чата порталом: у неё движок.

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";

import { useFullAccessDenied } from "@/components/full-access-gate";
import { AccountMenu } from "@/components/shell/account-menu";
import { useShellStatus } from "@/components/nav/use-shell-status";
import { mascot } from "@/components/shell/mascot/mascot";
import { Icon, type IconName } from "@/components/shell/icons";
import {
  dashboardViewOf,
  getDashboardSections,
  matchNavigation,
  type DashboardSection,
  type DashboardSectionKey,
} from "@/config/dashboard-navigation";
import { groupSignal, openGroupsFor, readOpenGroups, toggleGroup, writeOpenGroups } from "@/lib/nav-groups";
import { useDashboardShell } from "@/contexts/dashboard-shell";
import { linkClosesDrawer } from "@/components/shell/drawer-swipe";
import { useDashboardPath } from "@/lib/use-dashboard-path";

const COLLAPSED_KEY = "timely-nav";
const GROUP_KEYS: DashboardSectionKey[] = getDashboardSections()
  .filter((section) => section.kind === "group")
  .map((section) => section.key);

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

/** Сигналы раздела: число тем на повторение или точка, пока обрабатывается книга. */
function Signal({ count, live }: { count: number | null; live: boolean }) {
  return (
    <>
      {count ? (
        <span className="nav-count" title={`${count} к повторению`}>
          {count}
        </span>
      ) : null}
      {live ? <span className="live" title="Книга ещё обрабатывается" /> : null}
    </>
  );
}

/** Группа: строка-кнопка и пункты под ней. Свёрнутая показывает сигналы на своей строке. */
function NavGroup({
  section,
  open,
  itemUrl,
  status,
  onToggle,
}: {
  section: DashboardSection;
  open: boolean;
  itemUrl: string | null;
  status: { dueReviews: number; ingesting: boolean };
  onToggle: () => void;
}) {
  const subId = `nav-sub-${section.key}`;
  // Свёрнутые пункты не должны ловить фокус по Tab. React 18 не знает атрибута inert,
  // поэтому он ставится напрямую, как у страниц панели ниже.
  const subRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (subRef.current) subRef.current.inert = !open;
  }, [open]);
  return (
    <div className="nav-group">
      <button
        className="nav-item nav-group-btn"
        type="button"
        title={section.title}
        aria-expanded={open}
        aria-controls={subId}
        onClick={onToggle}
      >
        <Icon name={section.icon} />
        <span className="nav-text">{section.title}</span>
        {open ? null : <Signal {...groupSignal(section, status)} />}
        <Icon name="chev-r" className="nav-chev" />
      </button>
      <div className="nav-sub" id={subId} data-open={open || undefined}>
        <div className="nav-sub-in" ref={subRef}>
          {section.items.map((item) => (
            <NavItem key={item.url} href={item.url} title={item.title} icon={item.icon} current={itemUrl === item.url}>
              <Signal
                count={item.url === "/dashboard/weaknesses" && status.dueReviews > 0 ? status.dueReviews : null}
                live={item.url === "/dashboard/curriculum" && status.ingesting}
              />
            </NavItem>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Телефонный вид: то же условие, что в стилях (до 640 px). */
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    const update = () => setPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return phone;
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
  const { setChatsSlot, drawerOpen, setDrawerOpen } = useDashboardShell();
  const isPhone = useIsPhone();
  const toggleTheme = useThemeToggle();
  const { section: currentSection, itemUrl } = matchNavigation(path);

  const [collapsed, setCollapsed] = useState(false);
  /** Стрелка назад показывает меню, не уходя из чата. Новый заход в чат снова открывает список. */
  const [menuInChat, setMenuInChat] = useState(false);
  const menuRef = useRef<HTMLElement>(null);
  // Раскрытые группы читаются после монтирования: на сервере хранилища нет.
  const [openGroups, setOpenGroups] = useState<DashboardSectionKey[]>([]);
  useEffect(() => {
    setOpenGroups(openGroupsFor(readOpenGroups(), currentSection, GROUP_KEYS));
    // Только при первом показе; переходы ниже добавляют группу текущей страницы.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!currentSection || !GROUP_KEYS.includes(currentSection)) return;
    setOpenGroups((open) => (open.includes(currentSection) ? open : [...open, currentSection]));
  }, [currentSection]);
  const chatsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCollapsed(document.documentElement.classList.contains("nav-collapsed"));
  }, []);

  useEffect(() => {
    setMenuInChat(false);
  }, [view]);

  // Узкая панель только на компьютере: на телефоне панель выезжает целиком.
  const rail = collapsed && !isPhone;
  const showChats = view === "chat" && !menuInChat && !rail;

  // Телефон: переход на страницу закрывает меню; в чате меню открывается списком чатов.
  useEffect(() => {
    setDrawerOpen(false);
  }, [path, setDrawerOpen]);
  useEffect(() => {
    if (drawerOpen && view === "chat") setMenuInChat(false);
  }, [drawerOpen, view]);

  // Открытое меню: страница под ним не прокручивается и недоступна, фокус внутри меню,
  // Escape закрывает.
  const asideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    const shown = !isPhone || drawerOpen;
    // Меню закрылось, а фокус был в нём: возвращаем его на кнопку меню, иначе он остался
    // бы на ссылке в спрятанной панели.
    if (!shown && aside.contains(document.activeElement)) {
      document.querySelector<HTMLElement>(".menu-fab")?.focus({ preventScroll: true });
    }
    aside.inert = !shown;
    if (!isPhone || !drawerOpen) return;
    const root = document.documentElement;
    root.classList.add("drawer-open");
    // Всё остальное в кабинете — страница, кнопка меню, слайм — до закрытия недоступно ни по
    // Tab, ни экранному диктору. Затемнение остаётся: нажатие по нему закрывает меню. Окно
    // настроек открывается из меню аккаунта поверх, его не трогаем.
    const behind = Array.from(aside.parentElement?.children ?? []).filter(
      (node): node is HTMLElement =>
        node instanceof HTMLElement &&
        node !== aside &&
        !node.classList.contains("nav-scrim") &&
        node.tagName !== "DIALOG" &&
        !node.inert,
    );
    for (const node of behind) node.inert = true;
    aside.querySelector<HTMLElement>(showChats ? ".sb-back" : ".sb-page.nav .nav-item")?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    // Снимается и при уходе из кабинета с открытым меню, иначе следующая страница не прокрутится.
    return () => {
      root.classList.remove("drawer-open");
      for (const node of behind) node.inert = false;
      document.removeEventListener("keydown", onKey);
    };
    // showChats меняется вместе с открытием в чате; фокус ставится на тот экран, что виден.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPhone, drawerOpen, setDrawerOpen]);

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
    if (rail && view === "chat") toggleCollapsed();
  };
  const chatClick = (url: string) => (url === "/dashboard/chat" ? reopenChats : undefined);

  // Телефон: нажатие на ссылку в меню закрывает его, даже если это текущая страница и
  // адрес не меняется.
  const closeOnLink = (event: MouseEvent<HTMLElement>) => {
    if (!isPhone || !drawerOpen) return;
    const link = (event.target as Element).closest("a[href]");
    if (link && linkClosesDrawer(link.getAttribute("href"), view)) setDrawerOpen(false);
  };

  const sections = getDashboardSections();
  const name = session?.user?.name || "Ученик";

  return (
    <aside
      ref={asideRef}
      id="app-nav"
      className="sidebar glass"
      data-sb={showChats ? "chats" : "main"}
      data-drawer={isPhone ? (drawerOpen ? "open" : "closed") : undefined}
      aria-label="Навигация"
      onClick={closeOnLink}
    >
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
          {sections.map((section, index) =>
            section.kind === "group" ? (
              <div key={section.key} className="nav-group-wrap">
                {sections[index - 1]?.kind === "page" ? <div className="nav-sep" role="separator" /> : null}
                <NavGroup
                  section={section}
                  open={openGroups.includes(section.key)}
                  itemUrl={itemUrl}
                  status={status}
                  onToggle={() => {
                    // В свёрнутой узкой панели пунктам негде показаться: панель разворачивается.
                    if (rail) {
                      toggleCollapsed();
                      if (openGroups.includes(section.key)) return;
                    }
                    const next = toggleGroup(openGroups, section.key);
                    setOpenGroups(next);
                    writeOpenGroups(next);
                  }}
                />
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
        <AccountMenu
          initials={initialsOf(session?.user?.name)}
          name={name}
          current={view === "profile" || view === "prefs"}
        />
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

"use client";

// Рейл дашборда: шесть разделов из CLAUDE.md §16 с подписями.
//
// Прежний рейл был столбиком из десяти безымянных иконок: подписи жили только
// в подсказках при наведении, а на планшете их не было вовсе. Теперь у каждого
// раздела подпись видна всегда.
//
// Страницы раздела открываются карточкой рядом с ним — наведением, фокусом с
// клавиатуры или касанием. Сам рейл при этом не меняет форму: раньше он
// раскрывался целиком, вставлял списки страниц между разделами, и пункт,
// к которому тянулась мышь, уезжал из-под неё. На широком экране рейл можно
// закрепить раскрытым — тогда страницы видны списком и карточки не нужны.
//
// Внизу — слайм «Спросить»: он открывает панель тьютора справа.

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { ChevronRight, PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { LogoMark } from "@/components/landing/logo-mark";
import { SlimeGlyph } from "@/components/nav/slime-glyph";
import { useShellStatus, type ShellStatus } from "@/components/nav/use-shell-status";
import { useFullAccessDenied } from "@/components/full-access-gate";
import {
  getDashboardSections,
  matchNavigation,
  type DashboardSection,
  type DashboardSectionKey,
} from "@/config/dashboard-navigation";
import { isRailFreeRoute } from "@/config/rail-free-routes";
import { useAskRail } from "@/contexts/ask-rail";
import { useDashboardShell } from "@/contexts/dashboard-shell";
import { useDashboardPath } from "@/lib/use-dashboard-path";

import styles from "./app-sidebar.module.css";

/** Задержка карточки по наведению: мышь, пролетающая к странице, её не откроет. */
const HOVER_OPEN_MS = 140;
const HOVER_CLOSE_MS = 180;
/** Высота строки карточки и её шапки — чтобы не уехать за нижний край окна. */
const FLYOUT_ROW = 38;
const FLYOUT_HEAD = 46;

interface Flyout {
  key: DashboardSectionKey;
  top: number;
}

export function AppSidebar() {
  // Канонический путь: на app-хосте в адресной строке `/whiteboard`, и
  // рейл не убирался с доски, у которой есть собственный.
  const pathname = useDashboardPath();
  const router = useRouter();
  const { pinned, canPin, ready, togglePinned } = useDashboardShell();
  const askRail = useAskRail();
  const denied = useFullAccessDenied();
  const hidden = pathname === "/dashboard/whiteboard";
  const status = useShellStatus(!hidden && !denied);

  const [flyout, setFlyout] = useState<Flyout | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const pointerType = useRef<string>("mouse");
  const asideRef = useRef<HTMLElement>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  // Переход по ссылке закрывает карточку: она про раздел, из которого ушли.
  useEffect(() => {
    clearTimers();
    setFlyout(null);
  }, [pathname, clearTimers]);

  // Открытую карточку закрывают Escape и касание мимо — откуда бы ни был фокус.
  useEffect(() => {
    if (!flyout) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const aside = asideRef.current;
      const inside = aside?.contains(document.activeElement) ?? false;
      // Сначала фокус на раздел, потом закрыть: фокус с клавиатуры сам
      // открывает карточку, и закрытие должно быть последним словом.
      if (inside) {
        aside
          ?.querySelector<HTMLElement>(`[data-section="${flyout.key}"]`)
          ?.focus();
      }
      setFlyout(null);
    };
    const onPointer = (event: PointerEvent) => {
      if (!asideRef.current?.contains(event.target as Node)) setFlyout(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [flyout]);

  if (hidden) return null;

  const sections = getDashboardSections();
  const { section: activeSection, itemUrl: activeItem } = matchNavigation(pathname);
  const askOnPage = !isRailFreeRoute(pathname);

  const openFor = (section: DashboardSection, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    const height = FLYOUT_HEAD + section.items.length * FLYOUT_ROW + 16;
    const top = Math.max(8, Math.min(rect.top - 6, window.innerHeight - height - 8));
    setFlyout({ key: section.key, top });
  };

  const hasFlyout = (section: DashboardSection) => !pinned && section.items.length > 1;

  const ask = () => {
    if (!askOnPage) {
      // На «Тьюторе» и доске своя переписка во весь экран — панель там не
      // открывается, и «Спросить» ведёт в сам тьютор.
      router.push("/dashboard/chat");
      return;
    }
    if (askRail.open) askRail.toggle();
    else askRail.openRail();
  };

  return (
    <aside
      ref={asideRef}
      className={styles.rail}
      data-pinned={pinned}
      data-ready={ready}
      aria-label="Навигация"
    >
      <Link href="/dashboard" className={styles.logo} aria-label="Timely — сейчас">
        <LogoMark size={36} />
        <span className={styles.brand} aria-hidden="true">
          Timely
        </span>
      </Link>

      <nav aria-label="Разделы Timely" className={styles.nav}>
        {sections.map((section) => {
          const Icon = section.icon;
          const active = activeSection === section.key;
          const badge = sectionBadge(section.key, status);
          const withFlyout = hasFlyout(section);
          const open = flyout?.key === section.key;
          const name = badge.label ? `${section.title}, ${badge.label}` : section.title;

          const onClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
            // На касании первая — показать страницы раздела, вторая — перейти:
            // у планшета нет наведения, а «Ещё» с полным меню живёт только на
            // телефоне.
            const touch = pointerType.current === "touch" || pointerType.current === "pen";
            if (withFlyout && touch && !open) {
              event.preventDefault();
              openFor(section, event.currentTarget);
            }
          };

          return (
            <div
              key={section.key}
              className={styles.group}
              onPointerEnter={(event) => {
                if (event.pointerType !== "mouse" || !withFlyout) return;
                clearTimers();
                const target = event.currentTarget.firstElementChild as HTMLElement | null;
                if (!target) return;
                // Из одной карточки в соседнюю — сразу, без повторной задержки.
                if (flyout) openFor(section, target);
                else
                  openTimer.current = window.setTimeout(
                    () => openFor(section, target),
                    HOVER_OPEN_MS,
                  );
              }}
              onPointerLeave={(event) => {
                if (event.pointerType !== "mouse" || !withFlyout) return;
                clearTimers();
                closeTimer.current = window.setTimeout(() => setFlyout(null), HOVER_CLOSE_MS);
              }}
              onBlur={(event) => {
                if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setFlyout(null);
                }
              }}
            >
              <Link
                href={section.url}
                className={styles.item}
                data-section={section.key}
                data-active={active}
                aria-current={
                  active ? (activeItem === section.url ? "page" : "true") : undefined
                }
                aria-label={name}
                aria-expanded={withFlyout ? open : undefined}
                onPointerDown={(event) => {
                  pointerType.current = event.pointerType;
                }}
                onKeyDown={() => {
                  pointerType.current = "keyboard";
                }}
                onFocus={(event) => {
                  if (withFlyout && event.currentTarget.matches(":focus-visible")) {
                    openFor(section, event.currentTarget);
                  }
                }}
                onClick={onClick}
              >
                <span className={styles.ico} aria-hidden="true">
                  <Icon strokeWidth={1.8} />
                  {badge.node}
                </span>
                <span className={styles.label} aria-hidden="true">
                  {section.title}
                </span>
              </Link>

              {section.items.length > 1 && pinned ? (
                <div className={styles.sub}>
                  <SubLinks section={section} activeItem={activeItem} status={status} />
                </div>
              ) : null}

              {withFlyout ? (
                <div
                  className={styles.flyout}
                  hidden={!open}
                  style={open ? { top: flyout?.top } : undefined}
                >
                  <div className={styles.flyoutCard}>
                    <p className={styles.flyoutTitle} aria-hidden="true">
                      {section.title}
                    </p>
                    <SubLinks section={section} activeItem={activeItem} status={status} />
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className={styles.foot}>
        <button
          type="button"
          className={styles.ask}
          onClick={ask}
          aria-label="Спросить тьютора"
          aria-expanded={askOnPage ? askRail.open : undefined}
        >
          <SlimeGlyph className={styles.askSlime} />
          <span className={styles.askLabel} aria-hidden="true">
            Спросить
          </span>
          <span className={styles.askText} aria-hidden="true">
            <b>Спросить тьютора</b>
            <span>Знает, что у тебя сейчас</span>
          </span>
        </button>
        {canPin ? (
          <button
            type="button"
            className={styles.pin}
            onClick={togglePinned}
            aria-pressed={pinned}
            aria-label="Закрепить меню"
            title={pinned ? "Свернуть меню" : "Закрепить меню открытым"}
          >
            {pinned ? <PanelLeftClose /> : <PanelLeftOpen />}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function SubLinks({
  section,
  activeItem,
  status,
}: {
  section: DashboardSection;
  activeItem: string | null;
  status: ShellStatus;
}) {
  return (
    <>
      {section.items.map((item) => {
        const due =
          item.url === "/dashboard/weaknesses" && status.dueReviews ? status.dueReviews : 0;
        return (
          <Link
            key={item.url}
            href={item.url}
            className={styles.sublink}
            data-active={activeItem === item.url}
            aria-current={activeItem === item.url ? "page" : undefined}
          >
            <span>{item.title}</span>
            {due ? (
              <span className={styles.subMeta}>
                {due}
                <span className={styles.srOnly}> к повторению</span>
              </span>
            ) : (
              <ChevronRight className={styles.subChev} aria-hidden="true" />
            )}
          </Link>
        );
      })}
    </>
  );
}

function sectionBadge(
  key: DashboardSectionKey,
  status: ShellStatus,
): { node: React.ReactNode; label: string } {
  if (key === "now" && status.live) {
    return { node: <span className={styles.live} />, label: "идёт занятие" };
  }
  if (key === "study" && status.dueReviews > 0) {
    return {
      node: <span className={styles.count}>{status.dueReviews > 9 ? "9+" : status.dueReviews}</span>,
      label: `${status.dueReviews} к повторению`,
    };
  }
  if (key === "library" && status.ingesting) {
    return { node: <span className={styles.spin} />, label: "книга обрабатывается" };
  }
  return { node: null, label: "" };
}

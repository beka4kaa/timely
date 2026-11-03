"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  Menu,
  X,
} from "lucide-react";
import { LogoMark } from "@/components/landing/logo-mark";
import { UserAvatar } from "@/components/user-avatar";
import { useDashboardPath } from "@/lib/use-dashboard-path";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import {
  matchNavigation,
  type DashboardNavigationGroup,
} from "@/config/dashboard-navigation";

const MENU_TRANSITION_MS = 280;

function reducedMotionEnabled() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MobileDashboardMenu({
  navigationGroups,
  className = "",
  onOpenChange,
  renderTrigger,
}: {
  navigationGroups: DashboardNavigationGroup[];
  className?: string;
  /** Сообщает хозяину, открыт ли лист: нижней панели — для `aria-expanded`. */
  onOpenChange?: (open: boolean) => void;
  /** Своя кнопка вместо гамбургера: «Ещё» в нижней панели телефона. */
  renderTrigger?: (open: () => void) => React.ReactNode;
}) {
  // Канонический путь: на app-хосте адресная строка чистая, и активный
  // пункт меню не подсвечивался.
  const pathname = useDashboardPath();
  const activeItem = matchNavigation(pathname).itemUrl;
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const openFrameRef = useRef<number | null>(null);
  /** Кнопка, которой открыли лист: закрыв его без перехода, фокус вернётся к ней. */
  const openerRef = useRef<HTMLElement | null>(null);

  const clearScheduledWork = useCallback(() => {
    if (transitionTimerRef.current !== null) {
      window.clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = null;
    }
    if (openFrameRef.current !== null) {
      window.cancelAnimationFrame(openFrameRef.current);
      openFrameRef.current = null;
    }
  }, []);

  const openMenu = useCallback(() => {
    clearScheduledWork();
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    onOpenChange?.(true);
    setIsMounted(true);
    openFrameRef.current = window.requestAnimationFrame(() => {
      setIsVisible(true);
      openFrameRef.current = null;
    });
  }, [clearScheduledWork, onOpenChange]);

  const closeMenu = useCallback(
    (destination?: string) => {
      clearScheduledWork();
      onOpenChange?.(false);
      setIsVisible(false);
      const delay = reducedMotionEnabled() ? 0 : MENU_TRANSITION_MS;
      transitionTimerRef.current = window.setTimeout(() => {
        setIsMounted(false);
        transitionTimerRef.current = null;
        if (destination && destination !== pathname) {
          router.push(destination);
        } else if (openerRef.current?.isConnected) {
          openerRef.current.focus();
        }
        openerRef.current = null;
      }, delay);
    },
    [clearScheduledWork, onOpenChange, pathname, router],
  );

  useEffect(() => clearScheduledWork, [clearScheduledWork]);

  useEffect(() => {
    if (!isMounted) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("keydown", closeOnEscape);

    const focusTimer = window.setTimeout(
      () => closeButtonRef.current?.focus(),
      reducedMotionEnabled() ? 0 : MENU_TRANSITION_MS,
    );

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [closeMenu, isMounted]);

  const navigate = (
    event: ReactMouseEvent<HTMLAnchorElement>,
    destination: string,
  ) => {
    if (
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    ) {
      return;
    }
    event.preventDefault();
    closeMenu(destination);
  };

  return (
    <>
      {renderTrigger ? (
        renderTrigger(openMenu)
      ) : (
        <button
          type="button"
          onClick={openMenu}
          aria-label="Открыть разделы"
          aria-expanded={isMounted && isVisible}
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-tm-line bg-tm-surface/72 text-tm-muted outline-none transition-colors hover:bg-tm-surface hover:text-tm-ink focus-visible:ring-2 focus-visible:ring-tm-accent/35 md:hidden ${className}`}
        >
          <Menu className="h-4 w-4" />
        </button>
      )}

      {isMounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Разделы Timely"
            className={`fixed inset-0 z-[240] flex flex-col bg-tm-bg text-tm-ink shadow-[0_30px_90px_rgba(50,40,28,0.18)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
              isVisible ? "translate-y-0" : "-translate-y-full"
            }`}
          >
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-tm-line bg-tm-surface/95 px-4 backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-3">
              <LogoMark size={28} />
              <span className="h-7 w-px bg-tm-line" />
              <span className="text-[16px] font-semibold tracking-[-0.02em] text-tm-ink">
                Timely
              </span>
            </div>

            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => closeMenu()}
              aria-label="Закрыть разделы"
              className="grid h-10 w-10 place-items-center rounded-full border border-tm-line bg-tm-surface/72 text-tm-muted outline-none transition-colors hover:bg-tm-surface hover:text-tm-ink focus-visible:ring-2 focus-visible:ring-tm-accent/35"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </header>

          <nav
            aria-label="Навигация Timely"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 [scrollbar-width:none]"
          >
            <div className="mx-auto w-full max-w-2xl space-y-6">
              {navigationGroups.map((group) => {
                // Раздел из одной страницы («Сейчас», «Библиотека») — просто
                // пункт: заголовок над ним повторил бы то же слово.
                const single =
                  group.items.length === 1 && group.items[0].title === group.label;
                return (
                <section
                  key={group.label}
                  aria-labelledby={single ? undefined : `mobile-${group.label}`}
                  aria-label={single ? group.label : undefined}
                >
                  {!single && (
                    <h2
                      id={`mobile-${group.label}`}
                      className="mb-2 px-1 font-serif text-[15px] font-medium text-tm-muted"
                    >
                      {group.label}
                    </h2>
                  )}
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.items.map((item) => {
                      const active = activeItem === item.url;
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.url}
                          href={item.url}
                          onClick={(event) => navigate(event, item.url)}
                          aria-current={active ? "page" : undefined}
                          className={`group flex min-h-[58px] items-center gap-3 rounded-[18px] border px-3.5 py-2.5 outline-none transition-[border-color,background-color,transform] active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-tm-accent/35 ${
                            active
                              ? "border-tm-accent bg-tm-bg text-tm-accent"
                              : "border-tm-line bg-tm-surface text-tm-ink-2 hover:border-tm-line-strong hover:bg-tm-surface-2"
                          }`}
                        >
                          <span
                            className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] ${
                              active
                                ? "bg-tm-accent-soft text-tm-accent"
                                : "bg-tm-surface-2 text-tm-muted group-hover:text-tm-ink-2"
                            }`}
                          >
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1 truncate font-serif text-[15px] font-semibold">
                            {item.title}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-tm-faint transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      );
                    })}
                  </div>
                </section>
                );
              })}
            </div>
          </nav>

          <footer className="shrink-0 border-t border-tm-line bg-tm-surface/96 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <Link
              href="/dashboard/profile"
              onClick={(event) => navigate(event, "/dashboard/profile")}
              className="mx-auto flex h-12 w-full max-w-2xl items-center gap-3 rounded-[16px] px-3 text-tm-ink-2 outline-none transition-colors hover:bg-tm-surface-2 focus-visible:ring-2 focus-visible:ring-tm-accent/35"
            >
              <UserAvatar size={36} />
              <span className="font-serif text-[14px] font-semibold">
                Профиль
              </span>
              <ChevronRight className="ml-auto h-4 w-4 text-tm-faint" />
            </Link>
          </footer>
          </div>,
          document.body,
        )}
    </>
  );
}

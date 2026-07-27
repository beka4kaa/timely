"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import {
  ChevronRight,
  Menu,
  UserRound,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type { DashboardNavigationGroup } from "@/config/dashboard-navigation";

const MENU_TRANSITION_MS = 280;

function reducedMotionEnabled() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MobileDashboardMenu({
  navigationGroups,
  className = "",
}: {
  navigationGroups: DashboardNavigationGroup[];
  className?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const transitionTimerRef = useRef<number | null>(null);
  const openFrameRef = useRef<number | null>(null);

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
    setIsMounted(true);
    openFrameRef.current = window.requestAnimationFrame(() => {
      setIsVisible(true);
      openFrameRef.current = null;
    });
  }, [clearScheduledWork]);

  const closeMenu = useCallback(
    (destination?: string) => {
      clearScheduledWork();
      setIsVisible(false);
      const delay = reducedMotionEnabled() ? 0 : MENU_TRANSITION_MS;
      transitionTimerRef.current = window.setTimeout(() => {
        setIsMounted(false);
        transitionTimerRef.current = null;
        if (destination && destination !== pathname) {
          router.push(destination);
        }
      }, delay);
    },
    [clearScheduledWork, pathname, router],
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
      <button
        type="button"
        onClick={openMenu}
        aria-label="Открыть разделы"
        aria-expanded={isMounted && isVisible}
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border border-[#ddd8d0] bg-white/72 text-[#756e65] outline-none transition-colors hover:bg-white hover:text-[#2f2c28] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 md:hidden ${className}`}
      >
        <Menu className="h-4 w-4" />
      </button>

      {isMounted &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Разделы Timely"
            className={`fixed inset-0 z-[240] flex flex-col bg-[#f7f5f1] text-[#302d29] shadow-[0_30px_90px_rgba(50,40,28,0.18)] transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
              isVisible ? "translate-y-0" : "-translate-y-full"
            }`}
          >
          <header className="flex h-16 shrink-0 items-center justify-between border-b border-[#ded9d1] bg-[#fbfaf7]/95 px-4 backdrop-blur-xl">
            <div className="flex min-w-0 items-center gap-3">
              <Image
                src="/logo.svg"
                alt="Timely"
                width={28}
                height={28}
                priority
              />
              <span className="h-7 w-px bg-[#ddd8d0]" />
              <span className="font-serif text-[16px] font-semibold text-[#7f5527]">
                Timely
              </span>
            </div>

            <button
              ref={closeButtonRef}
              type="button"
              onClick={() => closeMenu()}
              aria-label="Закрыть разделы"
              className="grid h-10 w-10 place-items-center rounded-full border border-[#ddd8d0] bg-white/72 text-[#756e65] outline-none transition-colors hover:bg-white hover:text-[#2f2c28] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
            >
              <X className="h-[18px] w-[18px]" />
            </button>
          </header>

          <nav
            aria-label="Навигация Timely"
            className="min-h-0 flex-1 overflow-y-auto px-4 py-5 [scrollbar-width:none]"
          >
            <div className="mx-auto w-full max-w-2xl space-y-6">
              {navigationGroups.map((group) => (
                <section key={group.label} aria-labelledby={`mobile-${group.label}`}>
                  <h2
                    id={`mobile-${group.label}`}
                    className="mb-2 px-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-[#a39789]"
                  >
                    {group.label}
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {group.items.map((item) => {
                      const active =
                        pathname === item.url ||
                        pathname.startsWith(`${item.url}/`);
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.url}
                          href={item.url}
                          onClick={(event) => navigate(event, item.url)}
                          aria-current={active ? "page" : undefined}
                          className={`group flex min-h-[58px] items-center gap-3 rounded-[18px] border px-3.5 py-2.5 outline-none transition-[border-color,background-color,transform] active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 ${
                            active
                              ? "border-[#d4aa72] bg-[#fff8ed] text-[#6f471d]"
                              : "border-[#ded8cf] bg-[#fbfaf7] text-[#4d463e] hover:border-[#cbb89c] hover:bg-white"
                          }`}
                        >
                          <span
                            className={`grid h-10 w-10 shrink-0 place-items-center rounded-[13px] ${
                              active
                                ? "bg-[#edd8bb] text-[#8b5921]"
                                : "bg-[#f0ede7] text-[#817a71] group-hover:text-[#4b443c]"
                            }`}
                          >
                            <Icon className="h-[18px] w-[18px]" />
                          </span>
                          <span className="min-w-0 flex-1 truncate font-serif text-[15px] font-semibold">
                            {item.title}
                          </span>
                          <ChevronRight className="h-4 w-4 shrink-0 text-[#b0a89e] transition-transform group-hover:translate-x-0.5" />
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </nav>

          <footer className="shrink-0 border-t border-[#ded9d1] bg-[#fbfaf7]/96 p-3 pb-[max(12px,env(safe-area-inset-bottom))]">
            <Link
              href="/dashboard/profile"
              onClick={(event) => navigate(event, "/dashboard/profile")}
              className="mx-auto flex h-12 w-full max-w-2xl items-center gap-3 rounded-[16px] px-3 text-[#5f574e] outline-none transition-colors hover:bg-[#f0ede7] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
            >
              <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-[#eeeae3]">
                <UserRound className="h-4 w-4" />
              </span>
              <span className="font-serif text-[14px] font-semibold">
                Профиль
              </span>
              <ChevronRight className="ml-auto h-4 w-4 text-[#aaa298]" />
            </Link>
          </footer>
          </div>,
          document.body,
        )}
    </>
  );
}

"use client";

// Что делает каркас при смене страницы и на каждое движение мыши.

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef } from "react";

import { useFullAccessDenied } from "@/components/full-access-gate";
import { useShellStatus } from "@/components/nav/use-shell-status";
import { mascot } from "@/components/shell/mascot/mascot";
import { dashboardViewOf } from "@/config/dashboard-navigation";
import { useDashboardPath } from "@/lib/use-dashboard-path";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Напоминания о повторении: слайм и уведомление браузера. Настройки на странице «Настройки». */
export const REMIND_MASCOT_KEY = "timely.remind.mascot";
export const REMIND_PUSH_KEY = "timely.remind.push";
const REMIND_DAY_KEY = "timely.remind.day";

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = window.localStorage.getItem(key);
    return value === null ? fallback : value === "1";
  } catch {
    return fallback;
  }
}

export function ViewTracker() {
  const path = useDashboardPath();
  const view = dashboardViewOf(path);
  const previous = useRef<string | null>(null);
  const router = useRouter();
  const denied = useFullAccessDenied();
  const { dueReviews } = useShellStatus(!denied);

  // Стили страниц читают data-view с корня документа.
  useIsoLayoutEffect(() => {
    document.documentElement.dataset.view = view;
    return () => {
      delete document.documentElement.dataset.view;
    };
  }, [view]);

  useEffect(() => {
    if (previous.current !== null && previous.current !== path) {
      // Страница скроллится внутри своей колонки: роутер эту прокрутку не сбрасывает.
      document.querySelector(".main")?.scrollTo(0, 0);
      mascot.hop(0.42, "quiet");
    }
    previous.current = path;
  }, [path]);

  // Край стекла разгорается только рядом с курсором.
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: no-preference)").matches) return;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !(event.target instanceof Element)) return;
      const glass = event.target.closest<HTMLElement>(".glass");
      if (!glass) return;
      const box = glass.getBoundingClientRect();
      glass.style.setProperty("--mx", `${event.clientX - box.left}px`);
      glass.style.setProperty("--my", `${event.clientY - box.top}px`);
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);

  // Пора повторить: один раз в день, и сам он не висит вечно.
  useEffect(() => {
    if (!dueReviews || view === "weak") return;
    const today = new Date().toDateString();
    try {
      if (window.localStorage.getItem(REMIND_DAY_KEY) === today) return;
    } catch {
      return;
    }
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(REMIND_DAY_KEY, today);
      const text = dueReviews === 1 ? "Одна тема ждёт повторения" : `Тем ждут повторения: ${dueReviews}`;
      if (readFlag(REMIND_MASCOT_KEY, true)) {
        mascot.remind("Пора повторить", text, () => router.push("/dashboard/weaknesses"));
      }
      if (readFlag(REMIND_PUSH_KEY, false) && "Notification" in window && Notification.permission === "granted") {
        const note = new Notification("Пора повторить", { body: text, icon: "/logo.svg" });
        note.onclick = () => {
          window.focus();
          router.push("/dashboard/weaknesses");
        };
      }
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [dueReviews, view, router]);

  return null;
}

"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import {
  Clock3,
  KeyboardIcon,
  Loader2,
  Pause,
  Play,
  Redo2Icon,
  RefreshCwIcon,
  RotateCcw,
  Settings2Icon,
  Undo2Icon,
} from "lucide-react";

import { MobileDashboardMenu } from "@/components/mobile-dashboard-menu";
import { useDiaryHeader } from "@/contexts/diary-header-ctx";
import {
  getDashboardNavigation,
  getDashboardPageMeta,
} from "@/config/dashboard-navigation";
import { useMe } from "@/lib/contest-api";

const TIMER_STORAGE_KEY = "timely:dashboard-timer:v1";

interface StoredTimer {
  elapsedSeconds: number;
  isRunning: boolean;
  updatedAt: number;
}

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function SiteHeader() {
  const pathname = usePathname();
  const { setTheme } = useTheme();
  const { actions } = useDiaryHeader();
  const { me } = useMe();
  const meta = getDashboardPageMeta(pathname);
  const isWhiteboard = pathname === "/dashboard/whiteboard";
  const isDiary = actions.onTemplate !== null;
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [timerReady, setTimerReady] = useState(false);

  const navigationGroups = useMemo(
    () =>
      getDashboardNavigation({
        is_admin: me?.is_admin,
        is_moderator: me?.is_moderator,
        is_staff: me?.is_staff,
      }),
    [me?.is_admin, me?.is_moderator, me?.is_staff],
  );

  useEffect(() => {
    setTheme("light");
  }, [setTheme]);

  useEffect(() => {
    if (isWhiteboard) {
      setTimerReady(false);
      return;
    }

    try {
      const stored = window.localStorage.getItem(TIMER_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as StoredTimer;
        const elapsedWhileAway = parsed.isRunning
          ? Math.max(0, Math.floor((Date.now() - parsed.updatedAt) / 1000))
          : 0;
        setElapsedSeconds(
          Math.max(0, parsed.elapsedSeconds + elapsedWhileAway),
        );
        setIsTimerRunning(Boolean(parsed.isRunning));
      }
    } catch {
      window.localStorage.removeItem(TIMER_STORAGE_KEY);
    } finally {
      setTimerReady(true);
    }
  }, [isWhiteboard]);

  useEffect(() => {
    if (isWhiteboard || !timerReady) return;

    window.localStorage.setItem(
      TIMER_STORAGE_KEY,
      JSON.stringify({
        elapsedSeconds,
        isRunning: isTimerRunning,
        updatedAt: Date.now(),
      } satisfies StoredTimer),
    );
  }, [elapsedSeconds, isTimerRunning, isWhiteboard, timerReady]);

  useEffect(() => {
    if (isWhiteboard || !isTimerRunning) return;
    const interval = window.setInterval(
      () => setElapsedSeconds((current) => current + 1),
      1000,
    );
    return () => window.clearInterval(interval);
  }, [isTimerRunning, isWhiteboard]);

  if (isWhiteboard) {
    return null;
  }

  const hasTimerStarted = elapsedSeconds > 0 || isTimerRunning;

  return (
    <header className="fixed inset-x-0 top-0 z-[90] flex h-12 items-center border-b border-[#dedbd4] bg-[#fbfaf7]/95 px-2.5 text-[#2f2c28] backdrop-blur-xl md:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Link
          href="/dashboard/diary"
          className="flex shrink-0 items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35"
        >
          <Image
            src="/logo.svg"
            alt="Timely"
            width={24}
            height={24}
            priority
            className="shrink-0"
          />
          <span className="hidden h-6 w-px bg-[#d8d4cc] sm:block" />
        </Link>

        <div className="flex min-w-0 items-baseline gap-2">
          <span className="font-serif text-[15px] font-semibold tracking-[-0.02em] text-[#8a5b24]">
            Timely
          </span>
          <span className="hidden truncate font-serif text-[14px] text-[#34302b] sm:inline">
            {meta.title}
          </span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {isDiary && (
          <div className="hidden items-center gap-0.5 lg:flex">
            <button
              type="button"
              onClick={actions.onUndo ?? undefined}
              disabled={!actions.canUndo}
              aria-label="Отменить"
              className="grid h-8 w-8 place-items-center rounded-full text-[#837c73] outline-none transition-colors hover:bg-[#efede8] disabled:pointer-events-none disabled:opacity-30"
            >
              <Undo2Icon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={actions.onRedo ?? undefined}
              disabled={!actions.canRedo}
              aria-label="Вернуть"
              className="grid h-8 w-8 place-items-center rounded-full text-[#837c73] outline-none transition-colors hover:bg-[#efede8] disabled:pointer-events-none disabled:opacity-30"
            >
              <Redo2Icon className="h-3.5 w-3.5" />
            </button>
            <Link
              href="/dashboard/diary/schedule"
              aria-label="Настройки расписания"
              className="grid h-8 w-8 place-items-center rounded-full text-[#837c73] outline-none transition-colors hover:bg-[#efede8]"
            >
              <Settings2Icon className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={actions.onTemplate ?? undefined}
              disabled={actions.applyingTemplate}
              aria-label="Применить шаблон"
              className="grid h-8 w-8 place-items-center rounded-full text-[#837c73] outline-none transition-colors hover:bg-[#efede8] disabled:opacity-40"
            >
              {actions.applyingTemplate ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCwIcon className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={actions.onShortcuts ?? undefined}
              aria-label="Горячие клавиши"
              className="grid h-8 w-8 place-items-center rounded-full text-[#837c73] outline-none transition-colors hover:bg-[#efede8]"
            >
              <KeyboardIcon className="h-3.5 w-3.5" />
            </button>
            <span className="mx-1 h-5 w-px bg-[#dedbd4]" />
          </div>
        )}

        <div className="hidden items-center sm:flex">
          <button
            type="button"
            onClick={() => setIsTimerRunning((current) => !current)}
            aria-label={
              isTimerRunning
                ? "Поставить таймер на паузу"
                : hasTimerStarted
                  ? "Продолжить таймер"
                  : "Начать таймер"
            }
            className={`flex h-8 items-center gap-2 rounded-full border px-3 text-[12px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 ${
              isTimerRunning
                ? "border-[#c99a5a] bg-[#fff8eb] text-[#83561f]"
                : "border-[#ddd9d1] bg-white/70 text-[#746f67] hover:border-[#c9c3b9] hover:bg-white"
            }`}
          >
            {isTimerRunning ? (
              <Pause className="h-3.5 w-3.5" />
            ) : hasTimerStarted ? (
              <Play className="h-3.5 w-3.5" />
            ) : (
              <Clock3 className="h-3.5 w-3.5" />
            )}
            <span className={hasTimerStarted ? "tabular-nums" : ""}>
              {hasTimerStarted
                ? formatElapsed(elapsedSeconds)
                : "Начать таймер"}
            </span>
          </button>
          {hasTimerStarted && (
            <button
              type="button"
              onClick={() => {
                setElapsedSeconds(0);
                setIsTimerRunning(false);
              }}
              aria-label="Сбросить таймер"
              title="Сбросить таймер"
              className="-ml-1 grid h-8 w-7 place-items-center rounded-r-full text-[#9a9389] outline-none transition-colors hover:text-[#4c453d] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/30"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <MobileDashboardMenu navigationGroups={navigationGroups} />
      </div>
    </header>
  );
}

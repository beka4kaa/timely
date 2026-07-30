"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useTheme } from "next-themes";
import {
  KeyboardIcon,
  Loader2,
  Redo2Icon,
  RefreshCwIcon,
  Settings2Icon,
  Undo2Icon,
} from "lucide-react";

import { MobileDashboardMenu } from "@/components/mobile-dashboard-menu";
import { PomodoroHeaderPill } from "@/components/pomodoro/pomodoro-header-pill";
import { useDiaryHeader } from "@/contexts/diary-header-ctx";
import {
  getDashboardNavigation,
  getDashboardPageMeta,
} from "@/config/dashboard-navigation";
import { useMe } from "@/lib/contest-api";

export function SiteHeader() {
  const pathname = usePathname();
  const { setTheme } = useTheme();
  const { actions } = useDiaryHeader();
  const { me } = useMe();
  const meta = getDashboardPageMeta(pathname);
  const isWhiteboard = pathname === "/dashboard/whiteboard";
  const isDiary = actions.onTemplate !== null;

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

  if (isWhiteboard) {
    return null;
  }

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

        <PomodoroHeaderPill />

        <MobileDashboardMenu navigationGroups={navigationGroups} />
      </div>
    </header>
  );
}

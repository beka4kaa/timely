"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  KeyboardIcon,
  Loader2,
  Redo2Icon,
  RefreshCwIcon,
  Settings2Icon,
  Undo2Icon,
} from "lucide-react";

import { LogoMark } from "@/components/landing/logo-mark";
import { ThemeSwitch } from "@/components/landing/theme-switch";
import { MobileDashboardMenu } from "@/components/mobile-dashboard-menu";
import { PomodoroHeaderPill } from "@/components/pomodoro/pomodoro-header-pill";
import { useDiaryHeader } from "@/contexts/diary-header-ctx";
import {
  getDashboardNavigation,
  getDashboardPageMeta,
} from "@/config/dashboard-navigation";
import { useMe } from "@/lib/contest-api";
import { useDashboardPath } from "@/lib/use-dashboard-path";

export function SiteHeader() {
  // Канонический путь, а не адресная строка: на app-хосте она чистая
  // (`/chat`), и заголовком любого раздела оставалось «Рабочее пространство».
  const pathname = useDashboardPath();
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

  if (isWhiteboard) {
    return null;
  }

  return (
    <header className="fixed inset-x-0 top-0 z-[90] flex h-12 items-center border-b border-tm-line bg-tm-bg/85 px-2.5 text-tm-ink backdrop-blur-xl md:px-3">
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <Link
          href="/dashboard/diary"
          className="flex shrink-0 items-center gap-2.5 outline-none focus-visible:ring-2 focus-visible:ring-tm-accent/35"
        >
          <LogoMark size={26} />
          <span className="sr-only">Timely</span>
          <span className="hidden h-6 w-px bg-tm-line sm:block" />
        </Link>

        {/* На узком экране остаётся ОДНО имя — раздела, а не продукта: логотип
            слева уже говорит, где человек находится, а название страницы теперь
            больше нигде не печатается (шапку внутри страницы убрали). До этого
            здесь было наоборот, и телефон показывал «Timely» без ответа на
            вопрос, что за экран открыт. */}
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="hidden text-[15px] font-semibold tracking-[-0.02em] text-tm-ink sm:inline">
            Timely
          </span>
          <span className="truncate font-serif text-[14.5px] text-tm-muted">
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
              className="grid h-8 w-8 place-items-center rounded-full text-tm-muted outline-none transition-colors hover:bg-tm-surface-2 disabled:pointer-events-none disabled:opacity-30"
            >
              <Undo2Icon className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={actions.onRedo ?? undefined}
              disabled={!actions.canRedo}
              aria-label="Вернуть"
              className="grid h-8 w-8 place-items-center rounded-full text-tm-muted outline-none transition-colors hover:bg-tm-surface-2 disabled:pointer-events-none disabled:opacity-30"
            >
              <Redo2Icon className="h-3.5 w-3.5" />
            </button>
            <Link
              href="/dashboard/diary/schedule"
              aria-label="Настройки расписания"
              className="grid h-8 w-8 place-items-center rounded-full text-tm-muted outline-none transition-colors hover:bg-tm-surface-2"
            >
              <Settings2Icon className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={actions.onTemplate ?? undefined}
              disabled={actions.applyingTemplate}
              aria-label="Применить шаблон"
              className="grid h-8 w-8 place-items-center rounded-full text-tm-muted outline-none transition-colors hover:bg-tm-surface-2 disabled:opacity-40"
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
              className="grid h-8 w-8 place-items-center rounded-full text-tm-muted outline-none transition-colors hover:bg-tm-surface-2"
            >
              <KeyboardIcon className="h-3.5 w-3.5" />
            </button>
            <span className="mx-1 h-5 w-px bg-tm-surface-3" />
          </div>
        )}

        <PomodoroHeaderPill />

        <ThemeSwitch compact />

        <MobileDashboardMenu navigationGroups={navigationGroups} />
      </div>
    </header>
  );
}

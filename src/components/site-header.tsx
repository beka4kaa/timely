"use client";

import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
import { useMemo } from "react";
import {
  KeyboardIcon,
  Loader2,
  LogOut,
  Redo2Icon,
  RefreshCwIcon,
  Settings2Icon,
  Undo2Icon,
  UserRound,
} from "lucide-react";

import { LogoMark } from "@/components/landing/logo-mark";
import { ThemeSwitch } from "@/components/landing/theme-switch";
import { PomodoroHeaderPill } from "@/components/pomodoro/pomodoro-header-pill";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getDashboardPageMeta } from "@/config/dashboard-navigation";
import { useDashboardShell } from "@/contexts/dashboard-shell";
import { useDiaryHeader } from "@/contexts/diary-header-ctx";
import { firstName, greetingFor, longDateLabel, shortDateLabel } from "@/lib/now-feed";
import { zonedDateKey } from "@/lib/studyplan-calendar";
import { useDashboardPath } from "@/lib/use-dashboard-path";
import { browserTimeZone, useNow } from "@/lib/use-now";
import { useFocusDock } from "@/stores/focus-dock-store";

export function SiteHeader() {
  // Канонический путь, а не адресная строка: на app-хосте она чистая
  // (`/chat`), и заголовком любого раздела оставалось «Рабочее пространство».
  const pathname = useDashboardPath();
  const { actions } = useDiaryHeader();
  const { pinned, ready, setHeaderSlot } = useDashboardShell();
  // Пока таймер виден в карточке «Сейчас», пилюля его не повторяет.
  const focusDocked = useFocusDock((state) => state.docked);
  const meta = getDashboardPageMeta(pathname);
  const isWhiteboard = pathname === "/dashboard/whiteboard";
  const isDiary = actions.onTemplate !== null;
  const isNow = pathname === "/dashboard";

  if (isWhiteboard) {
    return null;
  }

  return (
    <header
      className={`fixed left-0 right-0 top-0 z-[90] flex h-14 items-center gap-3 border-b border-tm-line bg-tm-bg/85 px-3 text-tm-ink backdrop-blur-xl md:px-6 ${
        ready ? "transition-[left] duration-300 ease-in-out" : ""
      } ${pinned ? "md:left-[248px]" : "md:left-[92px]"}`}
    >
      <div className="flex min-w-0 flex-1 basis-0 items-center gap-2.5">
        {/* На компьютере знак стоит в рейле; на телефоне рейла нет. */}
        <Link
          href="/dashboard"
          className="shrink-0 rounded-[10px] outline-none focus-visible:ring-2 focus-visible:ring-tm-accent/35 md:hidden"
          aria-label="Timely — сейчас"
        >
          <LogoMark size={30} />
        </Link>

        {isNow ? (
          <NowTitle />
        ) : (
          <p className="truncate font-serif text-[19px] font-medium leading-tight tracking-[-0.015em] text-tm-ink">
            {meta.title}
          </p>
        )}
      </div>

      {/* Середина шапки: сюда главная рисует полосу недели. На других
          страницах места под неё не нужно. */}
      {isNow && (
        <div ref={setHeaderSlot} className="hidden shrink-0 items-center xl:flex" />
      )}

      <div className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-2">
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

        {!focusDocked && <PomodoroHeaderPill />}

        <ThemeSwitch compact />

        <AccountMenu />
      </div>
    </header>
  );
}

/**
 * Заголовок главной: приветствие и сегодняшняя дата.
 *
 * Название раздела здесь не нужно — его и так подсвечивает рейл, — а дата
 * отвечает на вопрос, с которым на главную приходят: какой сегодня день.
 */
function NowTitle() {
  const now = useNow(60_000);
  const { data: session } = useSession();
  const timeZone = useMemo(browserTimeZone, []);
  const name = firstName(session?.user?.name);

  // Время известно только в браузере: до него — пустая строка той же высоты,
  // чтобы шапка не прыгала.
  if (!now) return <div className="h-10" aria-hidden="true" />;

  const today = zonedDateKey(now, timeZone);
  return (
    <div className="min-w-0 leading-tight">
      <p className="hidden truncate text-[12.5px] text-tm-muted sm:block">
        {greetingFor(now.getHours())}
        {name ? `, ${name}` : ""}
      </p>
      <p className="truncate font-serif text-[19px] font-medium tracking-[-0.02em] text-tm-ink sm:text-[21px]">
        <span className="hidden sm:inline">{longDateLabel(today)}</span>
        <span className="sm:hidden">{shortDateLabel(today)}</span>
      </p>
    </div>
  );
}

/** Профиль и выход. Раньше жили внизу рейла, теперь — там, где их ищут. */
function AccountMenu() {
  const { data: session } = useSession();
  const userName = session?.user?.name || "Ученик";
  const userEmail = session?.user?.email || "Профиль Timely";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Профиль и выход"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full outline-none transition-transform hover:scale-[1.04] focus-visible:ring-2 focus-visible:ring-tm-accent/35 data-[state=open]:ring-2 data-[state=open]:ring-tm-accent-line"
        >
          <UserAvatar size={32} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="w-60 rounded-[18px] border-tm-line bg-tm-surface/95 p-1.5 text-tm-ink shadow-[0_20px_55px_-12px_rgba(0,0,0,0.18)] backdrop-blur-2xl dark:shadow-[0_20px_55px_-12px_rgba(0,0,0,0.55)]"
      >
        <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2 font-normal">
          <UserAvatar size={36} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{userName}</span>
            <span className="block truncate text-xs text-tm-muted">{userEmail}</span>
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-tm-line" />
        <DropdownMenuItem
          asChild
          className="cursor-pointer rounded-xl px-2.5 py-2 focus:bg-tm-surface-2 focus:text-tm-ink"
        >
          <Link href="/dashboard/profile">
            <UserRound className="h-4 w-4" />
            Профиль
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className="cursor-pointer rounded-xl px-2.5 py-2 text-tm-danger focus:bg-tm-danger-soft focus:text-tm-danger"
        >
          <LogOut className="h-4 w-4" />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

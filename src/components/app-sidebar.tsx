"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import { LogOut, UserRound } from "lucide-react";

import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getDashboardNavigation } from "@/config/dashboard-navigation";
import { useMe } from "@/lib/contest-api";
import { useDashboardPath } from "@/lib/use-dashboard-path";

export function AppSidebar() {
  // Канонический путь: на app-хосте в адресной строке `/whiteboard`, и
  // рельс не убирался с доски, у которой есть собственный.
  const pathname = useDashboardPath();
  const { data: session } = useSession();
  const { me } = useMe();

  if (pathname === "/dashboard/whiteboard") {
    return null;
  }

  const navigationGroups = getDashboardNavigation({
    is_admin: me?.is_admin,
    is_moderator: me?.is_moderator,
    is_staff: me?.is_staff,
  });
  const userName = session?.user?.name || "User";
  const userEmail = session?.user?.email || "Профиль Timely";

  return (
    <aside className="fixed bottom-0 left-0 top-12 z-[70] hidden w-[58px] flex-col items-center border-r border-tm-line bg-tm-bg py-2 md:flex">
      <TooltipProvider delayDuration={120}>
        <nav
          aria-label="Разделы Timely"
          className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto px-2 [scrollbar-width:none]"
        >
          {navigationGroups.map((group, groupIndex) => (
            <div
              key={group.label}
              aria-label={group.label}
              className="flex w-full flex-col items-center gap-0.5"
            >
              {group.items.map((item) => {
                const active =
                  pathname === item.url || pathname.startsWith(`${item.url}/`);
                const Icon = item.icon;

                return (
                  <Tooltip key={item.url}>
                    <TooltipTrigger asChild>
                      <Link
                        href={item.url}
                        aria-label={item.title}
                        aria-current={active ? "page" : undefined}
                        className={`grid h-8 w-10 shrink-0 place-items-center rounded-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-tm-accent/35 ${
                          active
                            ? "bg-tm-strong text-tm-on-strong shadow-[0_8px_18px_-10px_rgba(0,0,0,0.45)]"
                            : "text-tm-faint hover:bg-tm-surface-2 hover:text-tm-ink"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      sideOffset={8}
                      className="border-tm-strong bg-tm-strong px-2.5 py-1.5 text-[11px] text-tm-on-strong"
                    >
                      {item.title}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
              {groupIndex < navigationGroups.length - 1 && (
                <span className="my-1 h-px w-5 bg-tm-line" />
              )}
            </div>
          ))}
        </nav>

        <div className="mt-1 flex flex-col items-center gap-1">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label="Открыть профиль"
                    className="grid h-10 w-10 place-items-center rounded-[12px] outline-none transition-colors hover:bg-tm-surface-2 focus-visible:ring-2 focus-visible:ring-tm-accent/35 data-[state=open]:bg-tm-surface-2"
                  >
                    <UserAvatar size={28} />
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={8}
                className="border-tm-strong bg-tm-strong px-2.5 py-1.5 text-[11px] text-tm-on-strong"
              >
                Профиль
              </TooltipContent>
            </Tooltip>

            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={8}
              className="w-60 rounded-[18px] border-tm-line bg-tm-surface/95 p-1.5 text-tm-ink shadow-[0_20px_55px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_20px_55px_-12px_rgba(0,0,0,0.55)] backdrop-blur-2xl"
            >
              <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2 font-normal">
                <UserAvatar size={36} />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {userName}
                  </span>
                  <span className="block truncate text-xs text-tm-muted">
                    {userEmail}
                  </span>
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
        </div>
      </TooltipProvider>
    </aside>
  );
}

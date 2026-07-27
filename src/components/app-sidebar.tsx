"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { signOut } from "next-auth/react";
import { LogOut, UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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

export function AppSidebar() {
  const pathname = usePathname();
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
  const initials = userName.slice(0, 2).toUpperCase();

  return (
    <aside className="fixed bottom-0 left-0 top-12 z-[70] hidden w-[58px] flex-col items-center border-r border-[#dedbd4] bg-[#fbfaf7] py-2 md:flex">
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
                        className={`grid h-8 w-10 shrink-0 place-items-center rounded-[10px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 ${
                          active
                            ? "border border-[#d9ad70] bg-[#fffaf1] text-[#a76b22] shadow-[0_3px_12px_rgba(116,75,28,0.07)]"
                            : "text-[#908a81] hover:bg-[#efede8] hover:text-[#34302b]"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </Link>
                    </TooltipTrigger>
                    <TooltipContent
                      side="right"
                      sideOffset={8}
                      className="border-[#302d2a] bg-[#302d2a] px-2.5 py-1.5 text-[11px] text-white"
                    >
                      {item.title}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
              {groupIndex < navigationGroups.length - 1 && (
                <span className="my-1 h-px w-5 bg-[#e0dcd5]" />
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
                    className="grid h-10 w-10 place-items-center rounded-[12px] outline-none transition-colors hover:bg-[#efede8] focus-visible:ring-2 focus-visible:ring-[#c9a16c]/35 data-[state=open]:bg-[#fff7e9]"
                  >
                    <Avatar className="h-7 w-7 rounded-[9px] border border-[#d9d2c8] bg-white shadow-sm">
                      <AvatarImage
                        src={session?.user?.image || "/avatars/user.jpg"}
                        alt={userName}
                      />
                      <AvatarFallback className="rounded-[8px] bg-[#fff7e8] text-[9px] font-semibold text-[#8a5b2b]">
                        {initials}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={8}
                className="border-[#302d2a] bg-[#302d2a] px-2.5 py-1.5 text-[11px] text-white"
              >
                Профиль
              </TooltipContent>
            </Tooltip>

            <DropdownMenuContent
              side="right"
              align="end"
              sideOffset={8}
              className="w-60 rounded-[18px] border-[#ddd6ca] bg-[#fbfaf7]/95 p-1.5 text-[#39332d] shadow-[0_20px_55px_rgba(63,47,29,0.16)] backdrop-blur-2xl"
            >
              <DropdownMenuLabel className="flex items-center gap-2.5 px-2 py-2 font-normal">
                <Avatar className="h-9 w-9 rounded-[11px] border border-[#ddd5c8]">
                  <AvatarImage
                    src={session?.user?.image || "/avatars/user.jpg"}
                    alt={userName}
                  />
                  <AvatarFallback className="rounded-[10px] bg-[#fff7e8] text-xs font-semibold text-[#8a5b2b]">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">
                    {userName}
                  </span>
                  <span className="block truncate text-xs text-[#8d857c]">
                    {userEmail}
                  </span>
                </span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-[#e5dfd6]" />
              <DropdownMenuItem
                asChild
                className="cursor-pointer rounded-xl px-2.5 py-2 focus:bg-[#f1ece3] focus:text-[#342f2a]"
              >
                <Link href="/dashboard/profile">
                  <UserRound className="h-4 w-4" />
                  Профиль
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => signOut({ callbackUrl: "/auth/signin" })}
                className="cursor-pointer rounded-xl px-2.5 py-2 text-[#9b4942] focus:bg-[#f8ebe8] focus:text-[#843a34]"
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

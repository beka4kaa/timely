"use client"

import {
  LogOutIcon,
  MoreVerticalIcon,
  UserCircleIcon,
} from "lucide-react"
import Link from "next/link"
import { signOut } from "next-auth/react"

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"

export function NavUser({
  user,
}: {
  user: {
    name: string
    email: string
    avatar: string
  }
}) {
  const { isMobile } = useSidebar()

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/auth/signin' })
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-[58px] rounded-[17px] border border-[#ded8cf] bg-[#f4f1eb] px-2.5 text-[#342f2a] shadow-[0_5px_18px_rgba(65,49,31,0.05)] transition-colors hover:border-[#cdb995] hover:bg-[#fffaf1] data-[state=open]:border-[#cdb995] data-[state=open]:bg-[#fff8ec]"
            >
              <Avatar className="h-10 w-10 rounded-[13px] border border-[#ddd5c8] bg-white shadow-sm">
                <AvatarImage src={user.avatar} alt={user.name} />
                <AvatarFallback className="rounded-[12px] bg-[#fffdfa] text-xs font-semibold text-[#8a5b2b]">
                  {user.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-[13px] font-semibold">
                  {user.name}
                </span>
                <span className="mt-0.5 truncate text-[11px] text-[#8d857c]">
                  {user.email || "Профиль Timely"}
                </span>
              </div>
              <MoreVerticalIcon className="ml-auto size-4 text-[#938b82]" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-[18px] border-[#ddd6ca] bg-[#fbfaf7]/95 p-1.5 text-[#39332d] shadow-[0_20px_55px_rgba(63,47,29,0.16)] backdrop-blur-2xl"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2.5 px-2 py-2 text-left text-sm">
                <Avatar className="h-9 w-9 rounded-[12px] border border-[#ddd5c8]">
                  <AvatarImage src={user.avatar} alt={user.name} />
                  <AvatarFallback className="rounded-[11px] bg-[#fff7e8] text-xs font-semibold text-[#8a5b2b]">
                    {user.name.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.name}</span>
                  <span className="truncate text-xs text-[#8d857c]">
                    {user.email || "Профиль Timely"}
                  </span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-[#e5dfd6]" />
            <DropdownMenuItem
              asChild
              className="cursor-pointer rounded-xl px-2.5 py-2 focus:bg-[#f1ece3] focus:text-[#342f2a]"
            >
              <Link href="/dashboard/profile">
                <UserCircleIcon />
                Профиль
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-[#e5dfd6]" />
            <DropdownMenuItem
              onClick={handleLogout}
              className="cursor-pointer rounded-xl px-2.5 py-2 text-[#9b4942] focus:bg-[#f8ebe8] focus:text-[#843a34]"
            >
              <LogOutIcon />
              Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

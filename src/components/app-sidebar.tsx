"use client"

import * as React from "react"
import Image from "next/image"
import {
  GraduationCapIcon,
  HeartIcon,
  HelpCircleIcon,
  LayoutDashboardIcon,
  NotebookPenIcon,
  SettingsIcon,
  TargetIcon,
  TrophyIcon,
  ZapIcon,
  PanelLeftClose,
  MedalIcon,
  SwordsIcon,
  EyeIcon,
} from "lucide-react"
import { useSession } from "next-auth/react"

import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"

const data = {
  navMain: [
    { title: "Дневник", url: "/dashboard/diary", icon: NotebookPenIcon },
    { title: "Доска", url: "/dashboard/whiteboard", icon: LayoutDashboardIcon },
    { title: "Subjects", url: "/dashboard/subjects", icon: GraduationCapIcon },
    { title: "Topics", url: "/dashboard/weaknesses", icon: ZapIcon },
    { title: "Program", url: "/dashboard/program", icon: TargetIcon },
    { title: "Contests", url: "/dashboard/arena/solve", icon: SwordsIcon },
    { title: "Arena (Review)", url: "/dashboard/arena/review", icon: EyeIcon },
    { title: "Leaderboard", url: "/dashboard/leaderboard", icon: MedalIcon },
    { title: "Achievements", url: "/dashboard/achievements", icon: TrophyIcon },
    { title: "Self Work", url: "/dashboard/self-work", icon: HeartIcon },
  ],
  navSecondary: [
    { title: "Settings", url: "/dashboard/settings", icon: SettingsIcon },
    { title: "Help", url: "/dashboard/help", icon: HelpCircleIcon },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession()
  const { toggleSidebar } = useSidebar()

  const user = {
    name: session?.user?.name || "User",
    email: session?.user?.email || "",
    avatar: session?.user?.image || "/avatars/user.jpg",
  }

  return (
    <Sidebar className="z-50 border-r border-sidebar-border shadow-2xl" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <div className="flex items-center justify-between w-full px-2 py-1.5">
              <a href="/dashboard" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                <Image src="/logo.svg" alt="Logo" width={22} height={22} className="shrink-0" />
                <span className="text-base font-semibold">Study Planner</span>
              </a>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-8 w-8 text-sidebar-foreground hover:bg-sidebar-accent" 
                onClick={toggleSidebar}
                title="Скрыть боковую панель"
              >
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            </div>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}

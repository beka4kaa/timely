"use client"

import * as React from "react"
import {
  ArrowUpCircleIcon,
  BarChartIcon,
  BookOpenIcon,
  BrainIcon,
  CalendarIcon,
  CheckSquareIcon,
  ClockIcon,
  GraduationCapIcon,
  HeartIcon,
  HelpCircleIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  SearchIcon,
  SettingsIcon,
  Sparkles,
  TargetIcon,
  TimerIcon,
  TrophyIcon,
  User,
  ZapIcon,
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
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboardIcon,
    },
    {
      title: "Study Planner",
      url: "/dashboard/study",
      icon: BookOpenIcon,
    },
    {
      title: "Subjects",
      url: "/dashboard/subjects",
      icon: GraduationCapIcon,
    },
    {
      title: "Topics",
      url: "/dashboard/weaknesses",
      icon: ZapIcon,
    },
    {
      title: "Study Tracker",
      url: "/dashboard/study-tracker",
      icon: TimerIcon,
    },
    {
      title: "Review",
      url: "/dashboard/review",
      icon: BrainIcon,
    },
    {
      title: "AI Assistant",
      url: "/dashboard/ai",
      icon: Sparkles,
    },
    {
      title: "Program",
      url: "/dashboard/program",
      icon: TargetIcon,
    },
    {
      title: "Profile",
      url: "/dashboard/profile",
      icon: User,
    },
    {
      title: "History",
      url: "/dashboard/history",
      icon: HistoryIcon,
    },
    {
      title: "Calendar",
      url: "/dashboard/calendar",
      icon: CalendarIcon,
    },
    {
      title: "Goals",
      url: "/dashboard/goals",
      icon: TargetIcon,
    },
    {
      title: "Achievements",
      url: "/dashboard/achievements",
      icon: TrophyIcon,
    },
    {
      title: "Self Work",
      url: "/dashboard/self-work",
      icon: HeartIcon,
    },
  ],
  navSecondary: [
    {
      title: "Settings",
      url: "/dashboard/settings",
      icon: SettingsIcon,
    },
    {
      title: "Help",
      url: "/dashboard/help",
      icon: HelpCircleIcon,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession()

  const user = {
    name: session?.user?.name || "User",
    email: session?.user?.email || "",
    avatar: session?.user?.image || "/avatars/user.jpg",
  }

  return (
    <Sidebar {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:!p-1.5"
            >
              <a href="/dashboard">
                <BookOpenIcon className="h-5 w-5" />
                <span className="text-base font-semibold">Study Planner</span>
              </a>
            </SidebarMenuButton>
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

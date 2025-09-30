"use client"

import * as React from "react"
import {
  ArrowUpCircleIcon,
  CalendarIcon,
  CheckSquareIcon,
  TrophyIcon,
  TargetIcon,
  HeartIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  HelpCircleIcon,
  SearchIcon,
  ClockIcon,
  BarChartIcon,
} from "lucide-react"
import { useSession } from "next-auth/react"

import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavProjects } from "@/components/nav-projects"
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
      title: "Календарь",
      url: "/dashboard/calendar",
      icon: CalendarIcon,
    },
    {
      title: "Задачи",
      url: "/dashboard/tasks",
      icon: CheckSquareIcon,
    },
    {
      title: "Цели",
      url: "/dashboard/goals",
      icon: TargetIcon,
    },
    {
      title: "Достижения",
      url: "/dashboard/achievements",
      icon: TrophyIcon,
    },
  ],
  navClouds: [
    {
      title: "Работа с собой",
      icon: HeartIcon,
      isActive: true,
      url: "/dashboard/self-work",
      items: [
        {
          title: "Неуверенности",
          url: "/dashboard/self-work/insecurities",
        },
        {
          title: "Рефлексия",
          url: "/dashboard/self-work/reflection",
        },
        {
          title: "Личный рост",
          url: "/dashboard/self-work/growth",
        },
      ],
    },
    {
      title: "Аналитика",
      icon: BarChartIcon,
      url: "/dashboard/analytics",
      items: [
        {
          title: "Продуктивность",
          url: "/dashboard/analytics/productivity",
        },
        {
          title: "Привычки",
          url: "/dashboard/analytics/habits",
        },
        {
          title: "Прогресс целей",
          url: "/dashboard/analytics/goals-progress",
        },
      ],
    },
  ],
  navSecondary: [
    {
      title: "Настройки",
      url: "/dashboard/settings",
      icon: SettingsIcon,
    },
    {
      title: "Помощь",
      url: "/dashboard/help",
      icon: HelpCircleIcon,
    },
    {
      title: "Поиск",
      url: "/dashboard/search",
      icon: SearchIcon,
    },
  ],
  documents: [
    {
      name: "Время сегодня",
      url: "/dashboard/today",
      icon: ClockIcon,
    },
    {
      name: "Статистика",
      url: "/dashboard/stats",
      icon: BarChartIcon,
    },
    {
      name: "Экспорт данных",
      url: "/dashboard/export",
      icon: ArrowUpCircleIcon,
    },
  ],
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session } = useSession()

  // Формируем данные пользователя из сессии
  const user = {
    name: session?.user?.name || "Пользователь",
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
                <ClockIcon className="h-5 w-5" />
                <span className="text-base font-semibold">Time Schedule</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={data.navMain} />
        <NavProjects projects={data.navClouds} />
        <NavDocuments items={data.documents} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}

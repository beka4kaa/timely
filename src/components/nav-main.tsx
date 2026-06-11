"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import { PlusIcon, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export interface NavItem {
  title: string
  url: string
  icon?: LucideIcon
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export function NavMain({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname()
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/")

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-0.5">
        {/* Quick Create */}
        <motion.div whileTap={{ scale: 0.97 }} className="px-1 pb-2">
          <Link
            href="/dashboard/tasks"
            className="flex items-center justify-center gap-2 h-9 rounded-lg bg-indigo-600 text-white text-[13px] font-medium hover:bg-indigo-500 transition-colors group-data-[collapsible=icon]:px-0"
          >
            <PlusIcon className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            <span className="group-data-[collapsible=icon]:hidden">Создать</span>
          </Link>
        </motion.div>

        {groups.map((group) => (
          <div key={group.label} className="flex flex-col">
            <div className="px-2.5 pt-3 pb-1 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground/45 group-data-[collapsible=icon]:hidden">
              {group.label}
            </div>
            <SidebarMenu className="gap-0.5">
              {group.items.map((item) => {
                const active = isActive(item.url)
                return (
                  <SidebarMenuItem key={item.title}>
                    <Link
                      href={item.url}
                      title={item.title}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors",
                        active
                          ? "text-indigo-600 dark:text-indigo-300 font-medium"
                          : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-black/[0.035] dark:hover:bg-white/[0.05]",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="sidebarActive"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                          className="absolute inset-0 rounded-lg bg-indigo-50 dark:bg-indigo-400/10"
                        />
                      )}
                      {item.icon && <item.icon className="relative z-10 h-[17px] w-[17px] shrink-0" strokeWidth={active ? 2.4 : 2} />}
                      <span className="relative z-10 group-data-[collapsible=icon]:hidden">{item.title}</span>
                    </Link>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </div>
        ))}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import { MailIcon, PlusCircleIcon, type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
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
      <SidebarGroupContent className="flex flex-col gap-1">
        {/* Quick Create */}
        <div className="flex items-center gap-2 px-1 pb-1.5">
          <motion.div whileTap={{ scale: 0.97 }} className="flex-1">
            <Link
              href="/dashboard/tasks"
              className="flex items-center justify-center gap-2 h-9 rounded-xl bg-indigo-600 text-white text-sm font-medium shadow-md shadow-indigo-500/25 hover:bg-indigo-500 transition-colors group-data-[collapsible=icon]:px-0"
            >
              <PlusCircleIcon className="h-4 w-4 shrink-0" />
              <span className="group-data-[collapsible=icon]:hidden">Quick Create</span>
            </Link>
          </motion.div>
          <Button
            size="icon"
            variant="outline"
            className="h-9 w-9 shrink-0 rounded-xl group-data-[collapsible=icon]:hidden"
          >
            <MailIcon className="h-4 w-4" />
            <span className="sr-only">Inbox</span>
          </Button>
        </div>

        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <div className="px-2.5 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 group-data-[collapsible=icon]:hidden">
              {group.label}
            </div>
            <SidebarMenu>
              {group.items.map((item) => {
                const active = isActive(item.url)
                return (
                  <SidebarMenuItem key={item.title}>
                    <Link
                      href={item.url}
                      title={item.title}
                      className={cn(
                        "relative flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors",
                        active
                          ? "text-indigo-600 dark:text-indigo-300 font-medium"
                          : "text-sidebar-foreground/80 hover:text-sidebar-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="sidebarActive"
                          transition={{ type: "spring", stiffness: 380, damping: 32 }}
                          className="absolute inset-0 rounded-xl bg-gray-100/80 dark:bg-white/10 ring-1 ring-indigo-500/10"
                        />
                      )}
                      {item.icon && <item.icon className="relative z-10 h-4 w-4 shrink-0" />}
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

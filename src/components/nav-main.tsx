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
            className="flex items-center justify-center gap-2 h-9 rounded-lg border border-border text-foreground text-[13px] font-medium hover:bg-foreground/5 transition-colors duration-150 group-data-[collapsible=icon]:px-0"
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
                        "relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-colors duration-150",
                        active
                          ? "text-foreground font-medium"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {active && (
                        <motion.span
                          layoutId="sidebarActive"
                          transition={{ type: "tween", duration: 0.18, ease: "easeOut" }}
                          className="absolute inset-0 rounded-lg bg-foreground/10"
                        />
                      )}
                      {item.icon && <item.icon className="relative z-10 h-[17px] w-[17px] shrink-0" strokeWidth={2} />}
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

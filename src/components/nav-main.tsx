"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { type LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { useDashboardPath } from "@/lib/use-dashboard-path"
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
  // Канонический путь: на app-хосте адресная строка чистая (`/diary`), и
  // подсветка пункта меню не зажигалась ни на одном разделе.
  const pathname = useDashboardPath()
  const isActive = (url: string) => pathname === url || pathname.startsWith(url + "/")

  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-0.5">
        {groups.map((group, gi) => (
          <div key={group.label} className="flex flex-col">
            <div className="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#a49b91] group-data-[collapsible=icon]:hidden">
              {group.label}
            </div>
            <SidebarMenu className="gap-0.5">
              {group.items.map((item, ii) => {
                const active = isActive(item.url)
                return (
                  <SidebarMenuItem key={item.title}>
                    <motion.div
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.22, delay: gi * 0.05 + ii * 0.025, ease: "easeOut" }}
                    >
                      <Link
                        href={item.url}
                        title={item.title}
                        className={cn(
                          "relative flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[13px] transition-[color,transform] duration-150 hover:translate-x-0.5",
                          active
                            ? "font-medium text-[#70491f]"
                            : "text-[#797269] hover:text-[#332f2a]",
                        )}
                      >
                        {active && (
                          <motion.span
                            layoutId="sidebarActive"
                            transition={{ type: "tween", duration: 0.18, ease: "easeOut" }}
                            className="absolute inset-0 rounded-lg border border-[#e0c59f] bg-[#fff8ec] shadow-[0_3px_14px_rgba(112,73,31,0.06)]"
                          />
                        )}
                        {item.icon && (
                          <item.icon
                            className="relative z-10 h-[17px] w-[17px] shrink-0"
                            strokeWidth={1.8}
                          />
                        )}
                        <span className="relative z-10 group-data-[collapsible=icon]:hidden">{item.title}</span>
                      </Link>
                    </motion.div>
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

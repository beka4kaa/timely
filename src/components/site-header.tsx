"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { Separator } from "@/components/ui/separator"

export function SiteHeader() {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Burger menu for mobile - toggles sidebar Sheet */}
          <SidebarTrigger className="md:hidden" />
          <Separator orientation="vertical" className="h-6 md:hidden" />
          <h1 className="text-lg font-semibold">Панель управления</h1>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

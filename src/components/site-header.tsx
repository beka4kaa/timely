"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { Separator } from "@/components/ui/separator"
import { useDiaryHeader } from "@/contexts/diary-header-ctx"
import { Button } from "@/components/ui/button"
import { RefreshCwIcon, Loader2, KeyboardIcon, Settings2Icon } from "lucide-react"
import Link from "next/link"

export function SiteHeader() {
  const { actions } = useDiaryHeader()
  const isDiary = actions.onTemplate !== null

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Burger menu for mobile */}
          <SidebarTrigger className="md:hidden" />
          <Separator orientation="vertical" className="h-6 md:hidden" />
          <h1 className="text-lg font-semibold">
            {isDiary ? "Дневник" : "Панель управления"}
          </h1>
        </div>

        <div className="flex items-center gap-1">
          {/* Diary-specific buttons — only shown on /dashboard/diary */}
          {isDiary && (
            <>
              {/* Schedule */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                title="Настройки расписания"
                asChild
              >
                <Link href="/dashboard/diary/schedule">
                  <Settings2Icon className="h-4 w-4" />
                </Link>
              </Button>

              {/* Template */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={actions.onTemplate ?? undefined}
                disabled={actions.applyingTemplate}
                title="Применить шаблон (Ctrl+Shift+T)"
              >
                {actions.applyingTemplate
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <RefreshCwIcon className="h-4 w-4" />}
              </Button>

              {/* Keyboard shortcuts */}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={actions.onShortcuts ?? undefined}
                title="Горячие клавиши (?)"
              >
                <KeyboardIcon className="h-4 w-4" />
              </Button>

              <Separator orientation="vertical" className="h-4 mx-1" />
            </>
          )}

          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

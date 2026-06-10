"use client"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/theme-toggle"
import { Separator } from "@/components/ui/separator"
import { useDiaryHeader } from "@/contexts/diary-header-ctx"
import { Button } from "@/components/ui/button"
import { RefreshCwIcon, Loader2, KeyboardIcon, Settings2Icon, Undo2Icon, Redo2Icon } from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

export function SiteHeader() {
  const pathname = usePathname()
  const { actions } = useDiaryHeader()
  const isDiary = actions.onTemplate !== null
  const isWhiteboard = pathname === "/dashboard/whiteboard"

  // 1. Умный Header для Интерактивной доски (Full-bleed прозрачный оверлей)
  if (isWhiteboard) {
    return (
      <header className="absolute top-4 left-4 z-50 flex items-center gap-2">
        <SidebarTrigger className="bg-zinc-900/80 backdrop-blur-md border border-zinc-700/50 text-zinc-100 rounded-xl shadow-xl hover:bg-zinc-800" />
      </header>
    )
  }

  // 2. Стандартный блочный Header для остальных страниц
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Универсальный триггер сайдбара, физически сдвигающий заголовок вправо */}
          <SidebarTrigger />
          <Separator orientation="vertical" className="h-6 mx-1" />
          <h1 className="text-lg font-semibold">
            {isDiary ? "Дневник" : "Панель управления"}
          </h1>
        </div>

        <div className="flex items-center gap-1">
          {/* Кнопки Дневника */}
          {isDiary && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 transition-opacity ${actions.canUndo ? 'text-muted-foreground' : 'text-muted-foreground opacity-30 pointer-events-none'}`}
                onClick={actions.onUndo ?? undefined}
                title="Отменить (Ctrl+Z)"
              >
                <Undo2Icon className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className={`h-8 w-8 transition-opacity ${actions.canRedo ? 'text-muted-foreground' : 'text-muted-foreground opacity-30 pointer-events-none'}`}
                onClick={actions.onRedo ?? undefined}
                title="Вернуть (Ctrl+Shift+Z)"
              >
                <Redo2Icon className="h-4 w-4" />
              </Button>

              <Separator orientation="vertical" className="h-4 mx-0.5" />

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

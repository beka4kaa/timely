"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"
import { ThemeProviderProps } from "next-themes"

/**
 * Печать всегда светлая. CSS-фолбэк в globals.css возвращает светлые токены,
 * но Tailwind-утилиты `dark:` висят на классе `.dark` у <html> и печатались бы
 * светлым по белому. Поэтому на время печати снимаем сам класс.
 */
function usePrintInLight() {
  React.useEffect(() => {
    const root = document.documentElement
    let wasDark = false
    const before = () => {
      wasDark = root.classList.contains("dark")
      if (!wasDark) return
      root.classList.remove("dark")
      root.style.colorScheme = "light"
    }
    const after = () => {
      if (!wasDark) return
      root.classList.add("dark")
      root.style.colorScheme = "dark"
    }
    window.addEventListener("beforeprint", before)
    window.addEventListener("afterprint", after)
    return () => {
      window.removeEventListener("beforeprint", before)
      window.removeEventListener("afterprint", after)
    }
  }, [])
}

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  usePrintInLight()
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}

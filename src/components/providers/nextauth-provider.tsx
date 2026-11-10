"use client"

// Первым: на хосте демо перехват запросов должен стоять раньше, чем сессия спросит сервер.
import "@/lib/demo-mock/install"
import { SessionProvider } from "next-auth/react"
import { ReactNode } from "react"

interface NextAuthProviderProps {
  children: ReactNode
}

export function NextAuthProvider({ children }: NextAuthProviderProps) {
  return (
    <SessionProvider>
      {children}
    </SessionProvider>
  )
}
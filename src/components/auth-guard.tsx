"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

interface AuthGuardProps {
  children: React.ReactNode
  requireAuth?: boolean
}

export function AuthGuard({ children, requireAuth = true }: AuthGuardProps) {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === "loading") return // Еще загружается

    if (requireAuth && !session) {
      router.push("/auth/signin")
      return
    }

    if (!requireAuth && session) {
      router.push("/dashboard")
      return
    }
  }, [session, status, requireAuth, router])

  // Показываем загрузчик пока проверяем сессию
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    )
  }

  // Если требуется авторизация, но пользователь не авторизован
  if (requireAuth && !session) {
    return null
  }

  // Если не требуется авторизация, но пользователь авторизован
  if (!requireAuth && session) {
    return null
  }

  return <>{children}</>
}
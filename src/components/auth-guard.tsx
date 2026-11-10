"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { LoadingMark } from "@/components/ui/loading-mark"
import { SIGN_IN_PATH } from "@/lib/demo-mode"

interface AuthGuardProps {
  children: React.ReactNode
  requireAuth?: boolean
}

export function AuthGuard({ children, requireAuth = true }: AuthGuardProps) {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === "loading") return // Еще загружается

    const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true"
    if (DEV_BYPASS_AUTH) return // Skip checks if bypassing auth

    if (requireAuth && !session) {
      router.push(SIGN_IN_PATH)
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
      <div className="flex min-h-screen items-center justify-center bg-tm-bg">
        <LoadingMark size={46} className="text-tm-accent" />
      </div>
    )
  }

  // Bypass logic for dev mode
  const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true"

  if (DEV_BYPASS_AUTH) {
    return <>{children}</>
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

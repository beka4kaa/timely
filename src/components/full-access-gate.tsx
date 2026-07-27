"use client"

import type { ReactNode } from "react"
import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useMe } from "@/lib/contest-api"

export function FullAccessGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { me, loading } = useMe()
  const allowed = Boolean(me?.has_full_access || me?.is_admin)

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace("/dashboard/diary")
    }
  }, [allowed, loading, router])

  if (loading || !allowed) return null

  return <>{children}</>
}

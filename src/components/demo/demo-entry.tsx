"use client"

// Вход в демо: заводит гостя, собирает ему копию аккаунта и открывает тур.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { signIn, useSession } from "next-auth/react"

import { AuthShell } from "@/components/auth/auth-shell"
import styles from "@/components/auth/auth.module.css"
import { LoadingMark } from "@/components/ui/loading-mark"
import { DemoStartError, startDemo } from "@/lib/demo-api"
import { demoLandingPath, withTourFlag, type DemoLang } from "@/lib/demo-mode"

import { DEMO_UI } from "./demo-copy"
import { markDemoFresh, savedDemoLang } from "./demo-store"
import entry from "./demo-entry.module.css"

type Phase = "signing" | "seeding" | "opening" | "failed"

/** `callbackUrl` от middleware — полный адрес. Берём из него только свой путь. */
function sameOriginPath(raw: string | null): string | null {
  if (!raw) return null
  try {
    const url = new URL(raw, window.location.origin)
    if (url.origin !== window.location.origin) return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

export function DemoEntry() {
  const router = useRouter()
  const { status } = useSession()
  const [lang, setLang] = useState<DemoLang>("en")
  const [phase, setPhase] = useState<Phase>("signing")
  const [tooMany, setTooMany] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const running = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    setLang(savedDemoLang())
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (status === "loading" || running.current) return
    running.current = true
    ;(async () => {
      try {
        if (status !== "authenticated") {
          setPhase("signing")
          const result = await signIn("demo", { redirect: false })
          if (!result || result.error) throw new DemoStartError(0, result?.error || "sign-in failed")
        }
        if (mounted.current) setPhase("seeding")
        await startDemo()
        markDemoFresh()
        if (mounted.current) setPhase("opening")
        const params = new URLSearchParams(window.location.search)
        router.replace(withTourFlag(demoLandingPath(sameOriginPath(params.get("callbackUrl")))))
      } catch (error) {
        running.current = false
        if (!mounted.current) return
        setTooMany(error instanceof DemoStartError && error.status === 429)
        setPhase("failed")
      }
    })()
  }, [status, attempt, router])

  const line =
    phase === "signing"
      ? DEMO_UI.entrySigningIn[lang]
      : phase === "seeding"
        ? DEMO_UI.entrySeeding[lang]
        : phase === "opening"
          ? DEMO_UI.entryOpening[lang]
          : tooMany
            ? DEMO_UI.entryTooMany[lang]
            : DEMO_UI.entryFailed[lang]

  return (
    <AuthShell title={DEMO_UI.entryTitle[lang]} subtitle={DEMO_UI.entrySubtitle[lang]}>
      <div className={entry.box} lang={lang} aria-live="polite">
        {phase === "failed" ? (
          <>
            <p className={styles.hint}>{line}</p>
            <button
              type="button"
              className={styles.primary}
              onClick={() => {
                setPhase("signing")
                setAttempt((value) => value + 1)
              }}
            >
              {DEMO_UI.entryRetry[lang]}
            </button>
          </>
        ) : (
          <div className={entry.line}>
            <LoadingMark size={18} />
            <span>{line}</span>
          </div>
        )}
      </div>
    </AuthShell>
  )
}

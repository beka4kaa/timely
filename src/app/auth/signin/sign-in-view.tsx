'use client'

import { useEffect, useState } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AuthShell, GoogleButton, SecondaryButton, authStyles } from '@/components/auth/auth-shell'
import { useT } from '@/lib/i18n/react'

/**
 * Куда вернуть человека после входа.
 *
 * Middleware отправляет незалогиненного на `/auth/signin?callbackUrl=<куда он
 * шёл>`, но кнопка входа этот адрес выбрасывала и вела на дневник. Открыл
 * «План» → вошёл → оказался в дневнике: ровно та жалоба, с которой всё
 * началось.
 *
 * Берём только внутренние пути: `callbackUrl` приходит из адресной строки, и
 * чужой абсолютный адрес превратил бы форму входа в открытый редиректор.
 *
 * Читаем из `window.location`, а не через `useSearchParams`: последний в Next
 * требует Suspense-границы вокруг страницы, и без неё падает сборка.
 */
function safeCallback(raw: string | null): string {
  if (!raw) return '/dashboard'
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/dashboard'
  return raw
}

// Пока вход только через Google (см. src/lib/auth.ts).
export function SignInView() {
  const { t } = useT()
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const [callbackUrl, setCallbackUrl] = useState('/dashboard')

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('callbackUrl')
    setCallbackUrl(safeCallback(raw))
  }, [])

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      await signIn('google', { callbackUrl, redirect: true })
    } catch (error) {
      toast.error(t('Ошибка входа через Google'))
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      title={t('С возвращением')}
      subtitle={t('Войди через Google, чтобы продолжить учёбу с того места, где остановился.')}
      footer={
        <>
          {t('Нет аккаунта?')} <Link href="/auth/register">{t('Создать аккаунт')}</Link>
        </>
      }
    >
      <GoogleButton onClick={handleGoogleSignIn} disabled={isLoading}>
        {isLoading ? t('Открываем Google…') : t('Продолжить с Google')}
      </GoogleButton>

      {process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true' && (
        <div className={authStyles.form}>
          <SecondaryButton onClick={() => router.push('/dashboard')} disabled={isLoading}>
            {t('Войти без аккаунта (dev)')}
          </SecondaryButton>
        </div>
      )}
    </AuthShell>
  )
}

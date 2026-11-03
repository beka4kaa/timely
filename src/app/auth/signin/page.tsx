'use client'

import { useEffect, useState } from 'react'
import { signIn, getSession } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AuthShell,
  Divider,
  Field,
  GoogleButton,
  PasswordInput,
  SecondaryButton,
  SubmitButton,
  TextInput,
  authStyles,
} from '@/components/auth/auth-shell'

/**
 * Куда вернуть человека после входа.
 *
 * Middleware отправляет незалогиненного на `/auth/signin?callbackUrl=<куда он
 * шёл>`, но обе кнопки входа этот адрес выбрасывали и вели на дневник. Открыл
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

export default function SignInPage() {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()
  const [callbackUrl, setCallbackUrl] = useState('/dashboard')

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('callbackUrl')
    setCallbackUrl(safeCallback(raw))
  }, [])

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    const formData = new FormData(event.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        toast.error('Неверный email или пароль', {
          description: 'Проверьте введённые данные и попробуйте снова.',
        })
      } else {
        const session = await getSession()
        if (session) {
          toast.success('Вы вошли в систему!', {
            description: `Добро пожаловать, ${session.user?.name || session.user?.email}!`,
          })
          router.push(callbackUrl)
        }
      }
    } catch (error) {
      toast.error('Произошла ошибка при входе')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      await signIn('google', { callbackUrl, redirect: true })
    } catch (error) {
      toast.error('Ошибка входа через Google')
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      title="С возвращением"
      subtitle="Войди, чтобы продолжить учёбу с того места, где остановился."
      footer={
        <>
          Нет аккаунта? <Link href="/auth/register">Создать аккаунт</Link>
        </>
      }
    >
      <GoogleButton onClick={handleGoogleSignIn} disabled={isLoading}>
        Продолжить с Google
      </GoogleButton>

      <Divider>или по почте</Divider>

      <form onSubmit={onSubmit} className={authStyles.form}>
        <Field label="Почта" htmlFor="email">
          <TextInput
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
            disabled={isLoading}
          />
        </Field>

        <Field label="Пароль" htmlFor="password">
          <PasswordInput
            id="password"
            name="password"
            autoComplete="current-password"
            placeholder="Твой пароль"
            required
            disabled={isLoading}
          />
        </Field>

        <SubmitButton disabled={isLoading}>{isLoading ? 'Входим…' : 'Войти'}</SubmitButton>

        {process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === 'true' && (
          <SecondaryButton onClick={() => router.push('/dashboard')} disabled={isLoading}>
            Войти без аккаунта (dev)
          </SecondaryButton>
        )}
      </form>
    </AuthShell>
  )
}

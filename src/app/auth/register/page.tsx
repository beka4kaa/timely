'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  AuthShell,
  Divider,
  Field,
  GoogleButton,
  PasswordInput,
  SubmitButton,
  TextInput,
  authStyles,
} from '@/components/auth/auth-shell'

export default function RegisterPage() {
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsLoading(true)

    const formData = new FormData(event.currentTarget)
    const email = formData.get('email') as string
    const password = formData.get('password') as string
    const name = formData.get('name') as string
    const confirmPassword = formData.get('confirmPassword') as string

    if (password !== confirmPassword) {
      toast.error('Пароли не совпадают', {
        description: 'Убедитесь, что оба поля пароля заполнены одинаково.',
      })
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      })

      const data = await response.json()

      if (response.ok) {
        toast.success('Аккаунт создан!', { description: 'Выполняем вход...' })
        const result = await signIn('credentials', {
          email,
          password,
          redirect: false,
        })

        if (result?.ok) {
          router.push('/dashboard/diary')
        } else {
          router.push('/auth/signin')
        }
      } else {
        const msg = data.email?.[0] || data.password?.[0] || data.error || 'Ошибка при регистрации'
        toast.error(msg)
      }
    } catch (error) {
      toast.error('Произошла ошибка при регистрации')
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      await signIn('google', { callbackUrl: '/dashboard/diary', redirect: true })
    } catch (error) {
      toast.error('Ошибка входа через Google')
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      title="Создай аккаунт"
      subtitle="Пара полей — и можно задавать первый вопрос тьютору."
      footer={
        <>
          Уже есть аккаунт? <Link href="/auth/signin">Войти</Link>
        </>
      }
    >
      <GoogleButton onClick={handleGoogleSignIn} disabled={isLoading}>
        Продолжить с Google
      </GoogleButton>

      <Divider>или по почте</Divider>

      <form onSubmit={onSubmit} className={authStyles.form}>
        <Field label="Имя" htmlFor="name">
          <TextInput
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            placeholder="Как к тебе обращаться"
            required
            disabled={isLoading}
          />
        </Field>

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

        <Field label="Пароль" htmlFor="password" hint="Минимум 8 символов">
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            placeholder="Придумай пароль"
            minLength={8}
            required
            disabled={isLoading}
          />
        </Field>

        <Field label="Повтори пароль" htmlFor="confirmPassword">
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            placeholder="Ещё раз тот же пароль"
            minLength={8}
            required
            disabled={isLoading}
          />
        </Field>

        <SubmitButton disabled={isLoading}>
          {isLoading ? 'Создаём аккаунт…' : 'Создать аккаунт'}
        </SubmitButton>
      </form>
    </AuthShell>
  )
}

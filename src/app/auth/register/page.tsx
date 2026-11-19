'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AuthShell, GoogleButton } from '@/components/auth/auth-shell'

// Пока аккаунт создаётся только через Google: первый вход и есть регистрация.
export default function RegisterPage() {
  const [isLoading, setIsLoading] = useState(false)

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      await signIn('google', { callbackUrl: '/dashboard', redirect: true })
    } catch (error) {
      toast.error('Ошибка входа через Google')
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      title="Создай аккаунт"
      subtitle="Один шаг через Google — и можно задавать первый вопрос тьютору."
      footer={
        <>
          Уже есть аккаунт? <Link href="/auth/signin">Войти</Link>
        </>
      }
    >
      <GoogleButton onClick={handleGoogleSignIn} disabled={isLoading}>
        {isLoading ? 'Открываем Google…' : 'Продолжить с Google'}
      </GoogleButton>
    </AuthShell>
  )
}

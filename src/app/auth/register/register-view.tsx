'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { toast } from 'sonner'
import { AuthShell, GoogleButton } from '@/components/auth/auth-shell'
import { useT } from '@/lib/i18n/react'

// Пока аккаунт создаётся только через Google: первый вход и есть регистрация.
export function RegisterView() {
  const { t } = useT()
  const [isLoading, setIsLoading] = useState(false)

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      await signIn('google', { callbackUrl: '/dashboard', redirect: true })
    } catch (error) {
      toast.error(t('Ошибка входа через Google'))
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      title={t('Создай аккаунт')}
      subtitle={t('Один шаг через Google — и можно задавать первый вопрос тьютору.')}
      footer={
        <>
          {t('Уже есть аккаунт?')} <Link href="/auth/signin">{t('Войти')}</Link>
        </>
      }
    >
      <GoogleButton onClick={handleGoogleSignIn} disabled={isLoading}>
        {isLoading ? t('Открываем Google…') : t('Продолжить с Google')}
      </GoogleButton>
    </AuthShell>
  )
}

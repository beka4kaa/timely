'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AuthShell, authStyles } from '@/components/auth/auth-shell'
import { useT } from '@/lib/i18n/react'

function AuthErrorContent() {
  const { t } = useT()
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  const errorMessages: Record<string, { title: string; description: string; solutions: string[] }> = {
    'OAuthSignin': {
      title: t('Ошибка OAuth авторизации'),
      description: t('Не удалось начать процесс авторизации через Google'),
      solutions: [
        t('Проверьте что GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET правильно установлены'),
        t('Убедитесь что NEXTAUTH_URL соответствует текущему домену'),
        t('Проверьте настройки в Google Cloud Console')
      ]
    },
    'OAuthCallback': {
      title: t('Ошибка OAuth callback'),
      description: t('Google вернул ошибку при авторизации'),
      solutions: [
        t('Проверьте что redirect URI в Google Console правильный'),
        t('Формат: https://yourdomain.com/api/auth/callback/google'),
        t('Убедитесь что домен добавлен в Authorized origins')
      ]
    },
    'OAuthCreateAccount': {
      title: t('Ошибка создания аккаунта'),
      description: t('Не удалось создать аккаунт в базе данных'),
      solutions: [
        t('Проверьте подключение к базе данных'),
        t('Убедитесь что схема Prisma актуальна'),
        t('Проверьте логи сервера для деталей')
      ]
    },
    'EmailCreateAccount': {
      title: t('Ошибка создания email аккаунта'),
      description: t('Проблема с созданием аккаунта через email'),
      solutions: [
        t('Проверьте что email provider настроен'),
        t('Убедитесь что SMTP настройки правильные')
      ]
    },
    'Callback': {
      title: t('Общая ошибка callback'),
      description: t('Неопределенная ошибка в процессе авторизации'),
      solutions: [
        t('Проверьте все environment variables'),
        t('Убедитесь что NEXTAUTH_SECRET установлен'),
        t('Проверьте логи сервера для деталей')
      ]
    },
    'OAuthAccountNotLinked': {
      title: t('Аккаунт не связан'),
      description: t('Email уже используется другим провайдером'),
      solutions: [
        t('Войдите через тот же провайдер, что использовали ранее'),
        t('Или используйте другой email адрес')
      ]
    },
    'EmailSignin': {
      title: t('Ошибка входа по email'),
      description: t('Не удалось отправить email для входа'),
      solutions: [
        t('Проверьте email настройки'),
        t('Убедитесь что SMTP сервер доступен')
      ]
    },
    'CredentialsSignin': {
      title: t('Неверные учетные данные'),
      description: t('Email или пароль неправильные'),
      solutions: [
        t('Проверьте email и пароль'),
        t('Убедитесь что аккаунт существует')
      ]
    },
    'SessionRequired': {
      title: t('Требуется авторизация'),
      description: t('Для доступа к этой странице нужно войти в систему'),
      solutions: [
        t('Войдите в систему'),
        t('Проверьте что сессия не истекла')
      ]
    }
  }

  const currentError = error ? errorMessages[error] : null

  return (
    <AuthShell
      title={currentError?.title || t('Не получилось войти')}
      subtitle={currentError?.description || t('Произошла неожиданная ошибка при авторизации.')}
      footer={t('Если ошибка повторяется, напишите администратору.')}
    >
      {error && (
        <p className={authStyles.notice}>
          {t('Код ошибки:')} <strong>{error}</strong>
          {errorDescription && <> — {errorDescription}</>}
        </p>
      )}

      {currentError?.solutions && (
        <details className={authStyles.details}>
          <summary>{t('Что можно проверить')}</summary>
          <ul>
            {currentError.solutions.map((solution, index) => (
              <li key={index}>{solution}</li>
            ))}
          </ul>
        </details>
      )}

      <div className={authStyles.actions}>
        <Link href="/auth/signin" className={authStyles.primary}>
          {t('Попробовать снова')}
        </Link>
        <Link href="/" className={authStyles.secondary}>
          {t('На главную')}
        </Link>
      </div>
    </AuthShell>
  )
}

export default function AuthErrorPage() {
  const { t } = useT()
  return (
    <Suspense
      fallback={
        <div className="grid min-h-svh place-items-center bg-tm-bg text-sm text-tm-muted">
          {t('Загрузка…')}
        </div>
      }
    >
      <AuthErrorContent />
    </Suspense>
  )
}

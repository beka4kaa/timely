'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { AuthShell, authStyles } from '@/components/auth/auth-shell'

function AuthErrorContent() {
  const searchParams = useSearchParams()
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')

  const errorMessages: Record<string, { title: string; description: string; solutions: string[] }> = {
    'OAuthSignin': {
      title: 'Ошибка OAuth авторизации',
      description: 'Не удалось начать процесс авторизации через Google',
      solutions: [
        'Проверьте что GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET правильно установлены',
        'Убедитесь что NEXTAUTH_URL соответствует текущему домену',
        'Проверьте настройки в Google Cloud Console'
      ]
    },
    'OAuthCallback': {
      title: 'Ошибка OAuth callback',
      description: 'Google вернул ошибку при авторизации',
      solutions: [
        'Проверьте что redirect URI в Google Console правильный',
        'Формат: https://yourdomain.com/api/auth/callback/google',
        'Убедитесь что домен добавлен в Authorized origins'
      ]
    },
    'OAuthCreateAccount': {
      title: 'Ошибка создания аккаунта',
      description: 'Не удалось создать аккаунт в базе данных',
      solutions: [
        'Проверьте подключение к базе данных',
        'Убедитесь что схема Prisma актуальна',
        'Проверьте логи сервера для деталей'
      ]
    },
    'EmailCreateAccount': {
      title: 'Ошибка создания email аккаунта',
      description: 'Проблема с созданием аккаунта через email',
      solutions: [
        'Проверьте что email provider настроен',
        'Убедитесь что SMTP настройки правильные'
      ]
    },
    'Callback': {
      title: 'Общая ошибка callback',
      description: 'Неопределенная ошибка в процессе авторизации',
      solutions: [
        'Проверьте все environment variables',
        'Убедитесь что NEXTAUTH_SECRET установлен',
        'Проверьте логи сервера для деталей'
      ]
    },
    'OAuthAccountNotLinked': {
      title: 'Аккаунт не связан',
      description: 'Email уже используется другим провайдером',
      solutions: [
        'Войдите через тот же провайдер, что использовали ранее',
        'Или используйте другой email адрес'
      ]
    },
    'EmailSignin': {
      title: 'Ошибка входа по email',
      description: 'Не удалось отправить email для входа',
      solutions: [
        'Проверьте email настройки',
        'Убедитесь что SMTP сервер доступен'
      ]
    },
    'CredentialsSignin': {
      title: 'Неверные учетные данные',
      description: 'Email или пароль неправильные',
      solutions: [
        'Проверьте email и пароль',
        'Убедитесь что аккаунт существует'
      ]
    },
    'SessionRequired': {
      title: 'Требуется авторизация',
      description: 'Для доступа к этой странице нужно войти в систему',
      solutions: [
        'Войдите в систему',
        'Проверьте что сессия не истекла'
      ]
    }
  }

  const currentError = error ? errorMessages[error] : null

  return (
    <AuthShell
      title={currentError?.title || 'Не получилось войти'}
      subtitle={currentError?.description || 'Произошла неожиданная ошибка при авторизации.'}
      footer="Если ошибка повторяется, напишите администратору."
    >
      {error && (
        <p className={authStyles.notice}>
          Код ошибки: <strong>{error}</strong>
          {errorDescription && <> — {errorDescription}</>}
        </p>
      )}

      {currentError?.solutions && (
        <details className={authStyles.details}>
          <summary>Что можно проверить</summary>
          <ul>
            {currentError.solutions.map((solution, index) => (
              <li key={index}>{solution}</li>
            ))}
          </ul>
        </details>
      )}

      <div className={authStyles.actions}>
        <Link href="/auth/signin" className={authStyles.primary}>
          Попробовать снова
        </Link>
        <Link href="/" className={authStyles.secondary}>
          На главную
        </Link>
      </div>
    </AuthShell>
  )
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div className="grid min-h-svh place-items-center bg-tm-bg text-sm text-tm-muted">
          Загрузка…
        </div>
      }
    >
      <AuthErrorContent />
    </Suspense>
  )
}

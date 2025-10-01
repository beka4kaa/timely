'use client'

import { useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertTriangle, ArrowLeft, RefreshCw } from 'lucide-react'

export default function AuthErrorPage() {
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <Card className="p-8">
          <div className="text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
            <h2 className="mt-6 text-3xl font-extrabold text-gray-900">
              {currentError?.title || 'Ошибка авторизации'}
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {currentError?.description || 'Произошла неожиданная ошибка при авторизации'}
            </p>
          </div>

          {error && (
            <div className="mt-6 p-4 bg-red-50 rounded-md">
              <p className="text-sm font-medium text-red-800">Код ошибки: {error}</p>
              {errorDescription && (
                <p className="text-sm text-red-700 mt-1">{errorDescription}</p>
              )}
            </div>
          )}

          {currentError?.solutions && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Возможные решения:</h3>
              <ul className="text-sm text-gray-600 space-y-2">
                {currentError.solutions.map((solution, index) => (
                  <li key={index} className="flex items-start">
                    <span className="flex-shrink-0 h-1.5 w-1.5 bg-gray-400 rounded-full mt-2 mr-3" />
                    {solution}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-8 space-y-3">
            <Button 
              onClick={() => window.location.href = '/auth/signin'}
              className="w-full flex items-center justify-center"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Попробовать снова
            </Button>
            
            <Button 
              variant="outline"
              onClick={() => window.location.href = '/'}
              className="w-full flex items-center justify-center"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              На главную
            </Button>

            <Button 
              variant="ghost"
              onClick={() => window.location.href = '/debug-oauth'}
              className="w-full flex items-center justify-center text-sm"
            >
              🔍 Диагностика (для разработчиков)
            </Button>
          </div>
        </Card>

        <div className="text-center">
          <p className="text-xs text-gray-500">
            Если проблема повторяется, обратитесь к администратору
          </p>
        </div>
      </div>
    </div>
  )
}
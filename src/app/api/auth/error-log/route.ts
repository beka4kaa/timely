import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const error = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  
  const errorInfo = {
    error,
    errorDescription,
    timestamp: new Date().toISOString(),
    url: req.url,
    headers: Object.fromEntries(req.headers.entries()),
    nextAuthUrl: process.env.NEXTAUTH_URL,
    nodeEnv: process.env.NODE_ENV,
  }

  console.error('❌ OAuth Error:', errorInfo)

  // Логируем в файл для production
  if (process.env.NODE_ENV === 'production') {
    console.error('PRODUCTION_OAUTH_ERROR:', JSON.stringify(errorInfo))
  }

  return NextResponse.json({
    message: 'OAuth error logged',
    ...errorInfo,
    solutions: getErrorSolutions(error)
  })
}

function getErrorSolutions(error: string | null) {
  const solutions: Record<string, string[]> = {
    'redirect_uri_mismatch': [
      'Проверьте что в Google Console добавлен правильный redirect URI',
      'Формат: https://yourdomain.com/api/auth/callback/google',
      'URL должен точно совпадать с production доменом'
    ],
    'invalid_client': [
      'Проверьте GOOGLE_CLIENT_ID в environment variables',
      'Проверьте GOOGLE_CLIENT_SECRET в environment variables',
      'Убедитесь что креды не содержат лишних пробелов'
    ],
    'access_denied': [
      'Пользователь отклонил авторизацию',
      'Проверьте что домен добавлен в Authorized origins в Google Console',
      'Попробуйте очистить cookies и попробовать снова'
    ],
    'invalid_request': [
      'Проверьте NEXTAUTH_URL - должен совпадать с текущим доменом',
      'Убедитесь что используется HTTPS на production',
      'Проверьте что все environment variables установлены'
    ]
  }
  
  return solutions[error || ''] || ['Неизвестная ошибка OAuth']
}
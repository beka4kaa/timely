import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  console.log('🚨 EMERGENCY OAUTH TEST CALLED')

  try {
    // Проверяем сессию
    const session = await getServerSession(authOptions)
    console.log('📱 Session check result:', !!session)

    // Тестируем NextAuth providers
    const providers = authOptions.providers || []
    console.log('🔧 Available providers:', providers.map(p => p.id))

    // Проверяем Google provider конфигурацию
    const googleProvider = providers.find(p => p.id === 'google')
    console.log('🔍 Google provider found:', !!googleProvider)

    if (googleProvider) {
      console.log('✅ Google provider config exists')
      // @ts-ignore
      console.log('🔑 Has client ID:', !!googleProvider.options?.clientId)
      // @ts-ignore
      console.log('🔒 Has client secret:', !!googleProvider.options?.clientSecret)
    }

    // Проверяем environment variables ПРЯМО СЕЙЧАС
    console.log('🌐 CURRENT ENV VARS:')
    console.log('   NEXTAUTH_URL:', process.env.NEXTAUTH_URL)
    console.log('   GOOGLE_CLIENT_ID length:', process.env.GOOGLE_CLIENT_ID?.length)
    console.log('   GOOGLE_CLIENT_SECRET starts with GOCSPX:', process.env.GOOGLE_CLIENT_SECRET?.startsWith('GOCSPX-'))

    // Создаем тестовый Google Auth URL
    const baseUrl = process.env.NEXTAUTH_URL || 'https://timelyplan.me'
    const testGoogleUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${baseUrl}/api/auth/callback/google&response_type=code&scope=openid%20email%20profile&state=test`

    return NextResponse.json({
      timestamp: new Date().toISOString(),
      session: !!session,
      user: session?.user ? {
        email: session.user.email,
        name: session.user.name
      } : null,
      environment: {
        NEXTAUTH_URL: process.env.NEXTAUTH_URL,
        hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
        hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
        googleClientIdLength: process.env.GOOGLE_CLIENT_ID?.length,
        googleSecretFormat: process.env.GOOGLE_CLIENT_SECRET?.startsWith('GOCSPX-')
      },
      nextAuthConfig: {
        providersCount: providers.length,
        hasGoogleProvider: !!googleProvider,
        googleProviderValid: !!googleProvider && !!(googleProvider as any).options?.clientId
      },
      testUrls: {
        signIn: '/api/auth/signin/google',
        callback: '/api/auth/callback/google',
        testGoogleDirectUrl: testGoogleUrl
      },
      diagnostics: {
        message: 'Проверьте логи сервера выше для детальной информации',
        nextStep: 'Попробуйте testGoogleDirectUrl в браузере чтобы увидеть ошибку Google'
      }
    })

  } catch (error: any) {
    console.error('❌ EMERGENCY TEST ERROR:', error)
    return NextResponse.json({
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    })
  }
}
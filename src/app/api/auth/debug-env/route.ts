import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const debugInfo = {
    timestamp: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV,
    nextAuthUrl: process.env.NEXTAUTH_URL,
    hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
    hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
    hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
    googleClientIdLength: process.env.GOOGLE_CLIENT_ID?.length,
    googleClientIdStart: process.env.GOOGLE_CLIENT_ID?.substring(0, 20),
    // Для безопасности показываем только первые символы
    nextAuthSecretStart: process.env.NEXTAUTH_SECRET?.substring(0, 10),
    hasAllVars: !!(
      process.env.NEXTAUTH_URL &&
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.NEXTAUTH_SECRET
    ),
    // Проверяем правильность URL
    nextAuthUrlValid: process.env.NEXTAUTH_URL?.startsWith('http'),
    isProduction: process.env.NODE_ENV === 'production',
    // Headers для диагностики
    host: req.headers.get('host'),
    protocol: req.headers.get('x-forwarded-proto') || 'http',
    origin: req.headers.get('origin'),
    userAgent: req.headers.get('user-agent'),
  }

  // Проверки безопасности
  const issues = []
  
  if (!process.env.NEXTAUTH_URL) {
    issues.push('NEXTAUTH_URL not set')
  }
  
  if (process.env.NEXTAUTH_URL?.includes('localhost') && process.env.NODE_ENV === 'production') {
    issues.push('NEXTAUTH_URL still pointing to localhost in production!')
  }
  
  if (!process.env.NEXTAUTH_URL?.startsWith('https') && process.env.NODE_ENV === 'production') {
    issues.push('NEXTAUTH_URL should use HTTPS in production')
  }

  const expectedUrl = `${debugInfo.protocol}://${debugInfo.host}`
  if (process.env.NEXTAUTH_URL !== expectedUrl) {
    issues.push(`NEXTAUTH_URL mismatch: expected ${expectedUrl}, got ${process.env.NEXTAUTH_URL}`)
  }

  return NextResponse.json({
    ...debugInfo,
    issues,
    status: issues.length === 0 ? 'OK' : 'ISSUES_FOUND'
  })
}
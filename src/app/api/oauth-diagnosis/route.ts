import { NextRequest, NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const test = searchParams.get('test')

  // Полная диагностика OAuth
  const diagnosis = {
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    
    // 🔍 Environment Variables
    env: {
      nextAuthUrl: process.env.NEXTAUTH_URL,
      hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
      hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
      hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
      googleClientIdStart: process.env.GOOGLE_CLIENT_ID?.substring(0, 20),
      googleClientSecretStart: process.env.GOOGLE_CLIENT_SECRET?.substring(0, 15),
    },
    
    // 🌐 Request Headers
    headers: {
      host: req.headers.get('host'),
      protocol: req.headers.get('x-forwarded-proto') || 'http',
      origin: req.headers.get('origin'),
      referer: req.headers.get('referer'),
      userAgent: req.headers.get('user-agent'),
    },
    
    // 🔧 NextAuth Configuration
    nextAuthConfig: {
      providersCount: authOptions.providers?.length || 0,
      hasGoogleProvider: authOptions.providers?.some(p => p.id === 'google') || false,
      callbacksConfigured: !!authOptions.callbacks,
      adapterConfigured: !!authOptions.adapter,
      debug: authOptions.debug,
    },
    
    // 🎯 Expected URLs
    expectedUrls: {
      baseUrl: process.env.NEXTAUTH_URL,
      googleCallbackUrl: `${process.env.NEXTAUTH_URL}/api/auth/callback/google`,
      expectedOrigin: process.env.NEXTAUTH_URL?.replace(/\/$/, ''),
    },
    
    // ⚡ Environment Checks
    checks: {
      urlValid: process.env.NEXTAUTH_URL?.startsWith('https://'),
      secretLength: process.env.NEXTAUTH_SECRET?.length || 0,
      clientIdFormat: process.env.GOOGLE_CLIENT_ID?.includes('.apps.googleusercontent.com'),
      secretFormat: process.env.GOOGLE_CLIENT_SECRET?.startsWith('GOCSPX-'),
    }
  }
  
  // 🚨 Issue Detection
  const issues = []
  
  if (!process.env.NEXTAUTH_URL) {
    issues.push('NEXTAUTH_URL missing')
  }
  
  if (process.env.NEXTAUTH_URL && !process.env.NEXTAUTH_URL.startsWith('https://')) {
    issues.push('NEXTAUTH_URL should use HTTPS in production')
  }
  
  if (!process.env.GOOGLE_CLIENT_ID) {
    issues.push('GOOGLE_CLIENT_ID missing')
  }
  
  if (!process.env.GOOGLE_CLIENT_SECRET) {
    issues.push('GOOGLE_CLIENT_SECRET missing')
  }
  
  if (process.env.GOOGLE_CLIENT_SECRET && !process.env.GOOGLE_CLIENT_SECRET.startsWith('GOCSPX-')) {
    issues.push('GOOGLE_CLIENT_SECRET format invalid (should start with GOCSPX-)')
  }
  
  if (!process.env.NEXTAUTH_SECRET || process.env.NEXTAUTH_SECRET.length < 32) {
    issues.push('NEXTAUTH_SECRET too short (should be 32+ chars)')
  }
  
  // 🧪 Test Mode
  if (test === 'google-config') {
    const googleProvider = authOptions.providers?.find(p => p.id === 'google')
    return NextResponse.json({
      ...diagnosis,
      googleProviderConfig: googleProvider ? {
        id: googleProvider.id,
        name: googleProvider.name,
        clientId: !!googleProvider.options?.clientId,
        clientSecret: !!googleProvider.options?.clientSecret,
      } : null,
      issues
    })
  }
  
  return NextResponse.json({
    ...diagnosis,
    issues,
    status: issues.length === 0 ? 'ALL_OK' : 'ISSUES_FOUND',
    recommendation: issues.length === 0 
      ? 'Configuration looks good. Check Google Console settings.'
      : 'Fix the issues above first.'
  })
}
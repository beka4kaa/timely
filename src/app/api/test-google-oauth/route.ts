import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')
  
  if (action === 'test-redirect') {
    // Тестируем редирект на Google
    const clientId = process.env.GOOGLE_CLIENT_ID
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/auth/callback/google`
    
    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    googleAuthUrl.searchParams.set('client_id', clientId!)
    googleAuthUrl.searchParams.set('redirect_uri', redirectUri)
    googleAuthUrl.searchParams.set('response_type', 'code')
    googleAuthUrl.searchParams.set('scope', 'openid email profile')
    googleAuthUrl.searchParams.set('state', 'test-state-123')
    
    return NextResponse.json({
      message: 'Google OAuth URL generated',
      clientId: clientId?.substring(0, 20) + '...',
      redirectUri,
      googleAuthUrl: googleAuthUrl.toString(),
      testInstructions: 'Copy googleAuthUrl and paste in browser to test Google OAuth flow'
    })
  }
  
  return NextResponse.json({
    message: 'Google OAuth Test Endpoint',
    availableActions: ['test-redirect'],
    usage: 'Add ?action=test-redirect to test Google OAuth URL generation',
    currentDomain: process.env.NEXTAUTH_URL,
    timestamp: new Date().toISOString()
  })
}
'use client'

import { useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function OAuthDebugPage() {
  const { data: session, status } = useSession()
  const [debugInfo, setDebugInfo] = useState<any>({})
  const [envCheck, setEnvCheck] = useState<any>({})

  useEffect(() => {
    // Получаем информацию о текущем окружении
    setDebugInfo({
      url: window.location.href,
      origin: window.location.origin,
      protocol: window.location.protocol,
      host: window.location.host,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString()
    })

    // Проверяем environment variables через API
    fetch('/api/auth/debug-env')
      .then(res => res.json())
      .then(setEnvCheck)
      .catch(console.error)
  }, [])

  return (
    <div className="container mx-auto p-8 space-y-6">
      <h1 className="text-3xl font-bold">🔍 OAuth Debug Page</h1>
      
      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">Session Status: {status}</h2>
        <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
          {JSON.stringify(session, null, 2)}
        </pre>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">🌍 Environment Info</h2>
        <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
          {JSON.stringify(debugInfo, null, 2)}
        </pre>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">⚙️ Server Environment</h2>
        <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto">
          {JSON.stringify(envCheck, null, 2)}
        </pre>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">🧪 Test Links</h2>
        <div className="space-y-2">
          <Button asChild className="block">
            <a href="/api/auth/signin" target="_blank">
              Test Sign In API
            </a>
          </Button>
          <Button asChild variant="outline" className="block">
            <a href="/api/auth/providers" target="_blank">
              Check Providers
            </a>
          </Button>
          <Button asChild variant="outline" className="block">
            <a href="/api/auth/session" target="_blank">
              Check Session API
            </a>
          </Button>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="text-xl font-semibold mb-4">📋 Common Issues Checklist</h2>
        <div className="space-y-2 text-sm">
          <div>✅ NEXTAUTH_URL matches current domain: {debugInfo.origin}</div>
          <div>✅ Google Console has correct redirect URI: {debugInfo.origin}/api/auth/callback/google</div>
          <div>✅ Google Console has correct origin: {debugInfo.origin}</div>
          <div>✅ Using HTTPS in production: {debugInfo.protocol === 'https:'}</div>
          <div>✅ Environment variables are set: {envCheck.hasAllVars ? '✅' : '❌'}</div>
        </div>
      </Card>
    </div>
  )
}
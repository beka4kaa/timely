"use client"

import { useState } from 'react'
import { signIn, useSession } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import Link from 'next/link'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function GoogleTestPage() {
  const { data: session, status } = useSession()
  const [isLoading, setIsLoading] = useState(false)

  const handleGoogleSignIn = async () => {
    setIsLoading(true)
    try {
      // Используем динамический URL или относительный путь
      const baseUrl = window.location.origin
      const result = await signIn('google', { 
        callbackUrl: `${baseUrl}/diagnostic`,
        redirect: true 
      })
      
      if (result?.error) {
        console.error('Google sign in error:', result.error)
      } else if (result?.url) {
        // Редирект произошел успешно
        window.location.href = result.url
      }
    } catch (error) {
      console.error('Sign in error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-6 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Тест Google OAuth</CardTitle>
          <CardDescription>
            Тестирование получения данных пользователя после входа через Google
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <strong>Статус:</strong> {status}
          </div>
          
          {status === 'unauthenticated' && (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  Для тестирования нажмите на кнопку ниже и войдите через Google.
                  После успешного входа вы будете перенаправлены на диагностическую страницу.
                </AlertDescription>
              </Alert>
              
              <Button 
                onClick={handleGoogleSignIn} 
                disabled={isLoading}
                className="w-full"
              >
                {isLoading ? 'Подключение...' : 'Войти через Google'}
              </Button>
            </div>
          )}
          
          {status === 'authenticated' && session && (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  ✅ Успешно авторизован как {session.user?.name || session.user?.email}
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2 text-sm">
                <p><strong>Имя:</strong> {session.user?.name || 'Не указано'}</p>
                <p><strong>Email:</strong> {session.user?.email || 'Не указан'}</p>
                <p><strong>ID:</strong> {session.user?.id || 'Не указан'}</p>
                <p><strong>Роль:</strong> {session.user?.role || 'user'}</p>
              </div>
              
              <div className="flex gap-2">
                <Button asChild className="flex-1">
                  <Link href="/diagnostic">Диагностика</Link>
                </Button>
                <Button asChild variant="outline" className="flex-1">
                  <Link href="/dashboard">Dashboard</Link>
                </Button>
              </div>
            </div>
          )}
          
          {status === 'loading' && (
            <Alert>
              <AlertDescription>
                Загрузка сессии...
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
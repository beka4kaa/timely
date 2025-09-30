"use client"

import { useSession, signIn, signOut } from "next-auth/react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import Link from 'next/link'

export default function TestAuthPage() {
  const { data: session, status } = useSession()

  console.log('Session data:', session)
  console.log('Session status:', status)

  if (status === "loading") {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="p-6">
            <p>Загрузка...</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="container mx-auto p-6 max-w-md">
        <Card>
          <CardHeader>
            <CardTitle>Тест Google Аутентификации</CardTitle>
            <CardDescription>
              Войдите через Google чтобы протестировать получение данных
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button 
              onClick={() => signIn('google', { callbackUrl: '/test-auth' })}
              className="w-full"
            >
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Войти через Google
            </Button>
            <div className="mt-4 text-center">
              <Link href="/" className="text-sm text-muted-foreground hover:underline">
                ← Назад на главную
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-6">✅ Google OAuth Успешно!</h1>
      
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Данные Пользователя</CardTitle>
            <CardDescription>
              Информация полученная из Google OAuth
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-4">
              <Avatar className="h-12 w-12">
                <AvatarImage src={session.user?.image || ''} alt={session.user?.name || ''} />
                <AvatarFallback>{session.user?.name?.charAt(0) || 'U'}</AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium">{session.user?.name}</p>
                <p className="text-sm text-muted-foreground">{session.user?.email}</p>
              </div>
            </div>
            
            <div className="space-y-2 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <span className="font-medium">ID:</span>
                <span className="break-all">{session.user?.id || 'Не указан'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <span className="font-medium">Роль:</span>
                <span>{session.user?.role || 'user'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <span className="font-medium">Провайдер:</span>
                <span>{session.user?.provider || 'Не указан'}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <span className="font-medium">Истекает:</span>
                <span>{new Date(session.expires).toLocaleString()}</span>
              </div>
            </div>
            
            <Button 
              onClick={() => signOut({ callbackUrl: '/test-auth' })}
              variant="outline"
              className="w-full"
            >
              Выйти
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Raw Session Data</CardTitle>
            <CardDescription>
              Полные данные сессии для отладки
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md text-xs overflow-auto max-h-96">
              {JSON.stringify(session, null, 2)}
            </pre>
          </CardContent>
        </Card>
      </div>
      
      <div className="mt-6 flex gap-4">
        <Button asChild>
          <Link href="/dashboard">Перейти в Dashboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/diagnostic">Диагностика API</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">На главную</Link>
        </Button>
      </div>
    </div>
  )
}
"use client"

import { useSession } from "next-auth/react"
import { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function DiagnosticPage() {
  const { data: session, status } = useSession()
  const [apiData, setApiData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const fetchApiData = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/user/profile')
      const data = await response.json()
      
      if (response.ok) {
        setApiData(data)
      } else {
        setError(data.error || 'Failed to fetch user data')
      }
    } catch (err) {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) {
      fetchApiData()
    }
  }, [session])

  return (
    <div className="container mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold mb-6">Диагностика аутентификации</h1>
      
      <Card>
        <CardHeader>
          <CardTitle>Статус сессии NextAuth</CardTitle>
          <CardDescription>
            Состояние: {status}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'loading' && <p>Загрузка...</p>}
          {status === 'unauthenticated' && <p>Не авторизован</p>}
          {status === 'authenticated' && session && (
            <div className="space-y-2">
              <p><strong>ID:</strong> {session.user?.id || 'Не указан'}</p>
              <p><strong>Имя:</strong> {session.user?.name || 'Не указано'}</p>
              <p><strong>Email:</strong> {session.user?.email || 'Не указан'}</p>
              <p><strong>Роль:</strong> {session.user?.role || 'Не указана'}</p>
              <p><strong>Провайдер:</strong> {session.user?.provider || 'Не указан'}</p>
              <p><strong>Аватар:</strong> {session.user?.image ? 'Есть' : 'Нет'}</p>
              <p><strong>Истекает:</strong> {session.expires}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Данные из API</CardTitle>
          <CardDescription>
            Данные пользователя из серверного API эндпоинта
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={fetchApiData} 
            disabled={loading || !session}
            className="mb-4"
          >
            {loading ? 'Загрузка...' : 'Обновить данные'}
          </Button>
          
          {error && <p className="text-red-500">Ошибка: {error}</p>}
          
          {apiData && (
            <div className="space-y-2">
              <h4 className="font-semibold">Данные пользователя:</h4>
              <pre className="bg-muted p-4 rounded-md text-sm overflow-auto">
                {JSON.stringify(apiData, null, 2)}
              </pre>
            </div>
          )}
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
          {session && (
            <pre className="bg-muted p-4 rounded-md text-sm overflow-auto">
              {JSON.stringify(session, null, 2)}
            </pre>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
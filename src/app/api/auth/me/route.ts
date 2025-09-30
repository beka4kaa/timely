import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  try {
    const authToken = request.cookies.get('auth-token')?.value

    if (!authToken) {
      return NextResponse.json(
        { error: 'Не авторизован' },
        { status: 401 }
      )
    }

    // В реальном проекте здесь была бы проверка JWT токена
    // Для демо извлекаем userId из токена
    const userId = authToken.split('-')[3]

    const mockUser = {
      id: userId,
      email: 'user@example.com',
      name: 'Пользователь',
      role: 'user'
    }

    return NextResponse.json({ user: mockUser })
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка при проверке авторизации' },
      { status: 500 }
    )
  }
}
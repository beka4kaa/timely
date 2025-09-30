import { NextRequest, NextResponse } from 'next/server'

// Временное хранилище пользователей (в продакшене будет заменено на базу данных)
let users = [
  {
    id: 'user-1',
    email: 'admin@example.com',
    password: 'admin123', // В реальном проекте пароли должны быть хешированы
    name: 'Администратор',
    role: 'admin'
  },
  {
    id: 'user-2', 
    email: 'user@example.com',
    password: 'user123',
    name: 'Пользователь',
    role: 'user'
  }
]

export async function POST(request: NextRequest) {
  try {
    const { email, password } = await request.json()

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email и пароль обязательны' },
        { status: 400 }
      )
    }

    const user = users.find(u => u.email === email && u.password === password)

    if (!user) {
      return NextResponse.json(
        { error: 'Неверный email или пароль' },
        { status: 401 }
      )
    }

    // В реальном проекте здесь создавался бы JWT токен
    const token = `fake-jwt-token-${user.id}-${Date.now()}`

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      },
      token
    })

    // Устанавливаем cookie с токеном
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7 // 7 дней
    })

    return response
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка при входе в систему' },
      { status: 500 }
    )
  }
}
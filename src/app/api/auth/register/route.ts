import { NextRequest, NextResponse } from 'next/server'

// Временное хранилище пользователей
let users: any[] = []

export async function POST(request: NextRequest) {
  try {
    const { email, password, name } = await request.json()

    if (!email || !password || !name) {
      return NextResponse.json(
        { error: 'Email, пароль и имя обязательны' },
        { status: 400 }
      )
    }

    // Проверяем, не существует ли уже пользователь с таким email
    const existingUser = users.find(u => u.email === email)
    if (existingUser) {
      return NextResponse.json(
        { error: 'Пользователь с таким email уже существует' },
        { status: 400 }
      )
    }

    // Создаем нового пользователя
    const newUser = {
      id: `user-${Date.now()}`,
      email,
      password, // В реальном проекте пароль должен быть захеширован
      name,
      role: 'user',
      createdAt: new Date().toISOString()
    }

    users.push(newUser)

    // В реальном проекте здесь создавался бы JWT токен
    const token = `fake-jwt-token-${newUser.id}-${Date.now()}`

    const response = NextResponse.json({
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role
      },
      token
    }, { status: 201 })

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
      { error: 'Ошибка при регистрации' },
      { status: 500 }
    )
  }
}
import { NextResponse } from 'next/server'

export async function POST() {
  try {
    const response = NextResponse.json({ message: 'Вы вышли из системы' })
    
    // Удаляем токен из cookie
    response.cookies.set('auth-token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      expires: new Date(0)
    })

    return response
  } catch (error) {
    return NextResponse.json(
      { error: 'Ошибка при выходе из системы' },
      { status: 500 }
    )
  }
}
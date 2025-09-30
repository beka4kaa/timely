import { NextRequest, NextResponse } from 'next/server'

// Простое API для проверки валидности Gemini API ключа
export async function POST(req: NextRequest) {
  try {
    const { apiKey } = await req.json()
    
    if (!apiKey) {
      return NextResponse.json({ 
        valid: false, 
        error: 'API ключ не предоставлен' 
      }, { status: 400 })
    }

    // Простая проверка формата ключа (базовая валидация)
    const isValidFormat = /^AIzaSy[a-zA-Z0-9_-]{33}$/.test(apiKey)
    
    if (!isValidFormat) {
      return NextResponse.json({ 
        valid: false, 
        error: 'Неверный формат API ключа' 
      }, { status: 400 })
    }

    // В реальном приложении здесь можно сделать тестовый запрос к Gemini API
    // Сейчас просто возвращаем успех для валидного формата
    return NextResponse.json({ 
      valid: true, 
      message: 'API ключ имеет корректный формат' 
    })

  } catch (error) {
    console.error('Ошибка проверки API ключа:', error)
    return NextResponse.json({ 
      valid: false, 
      error: 'Внутренняя ошибка сервера' 
    }, { status: 500 })
  }
}
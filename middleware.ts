import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl
    const token = req.nextauth.token
    
    console.log('🔒 MIDDLEWARE:', { 
      pathname, 
      hasToken: !!token, 
      userEmail: token?.email 
    })

    // Публичные маршруты только для неавторизованных пользователей
    const publicPaths = ['/auth/signin', '/auth/register']
    const isPublicPath = publicPaths.some(path => pathname.startsWith(path))

    // Если пользователь авторизован и пытается попасть на страницу входа/регистрации
    if (isPublicPath && token) {
      console.log('✅ MIDDLEWARE: Authenticated user redirecting from auth page to dashboard')
      return NextResponse.redirect(new URL('/dashboard', req.url))
    }

    // Редирект с корневой страницы
    if (pathname === '/') {
      if (token) {
        return NextResponse.redirect(new URL('/dashboard', req.url))
      } else {
        return NextResponse.redirect(new URL('/auth/signin', req.url))
      }
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const { pathname } = req.nextUrl
        
        // Защищенные маршруты
        const protectedPaths = ['/dashboard']
        const isProtectedPath = protectedPaths.some(path => pathname.startsWith(path))
        
        // Публичные маршруты
        const publicPaths = ['/login', '/register']
        const isPublicPath = publicPaths.some(path => pathname.startsWith(path))
        
        // Разрешаем доступ к публичным маршрутам
        if (isPublicPath) return true
        
        // Разрешаем доступ к защищенным маршрутам только авторизованным пользователям
        if (isProtectedPath) return !!token
        
        // Разрешаем доступ к остальным маршрутам
        return true
      },
    },
  }
)

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|public).*)',
  ],
}
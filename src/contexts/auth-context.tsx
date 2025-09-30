"use client"

import { createContext, useContext, ReactNode } from 'react'
import { useSession, signIn as nextAuthSignIn, signOut as nextAuthSignOut } from 'next-auth/react'

interface User {
  id: string
  email: string
  name: string
  role: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (email: string, password: string, name: string) => Promise<{ success: boolean; error?: string }>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession()
  
  // Преобразуем данные сессии NextAuth в формат нашего User
  const user = session?.user ? {
    id: session.user.id || '',
    email: session.user.email || '',
    name: session.user.name || '',
    role: session.user.role || 'user'
  } : null

  const isLoading = status === 'loading'

  const login = async (email: string, password: string) => {
    try {
      const result = await nextAuthSignIn('credentials', {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        return { success: false, error: result.error }
      } else {
        return { success: true }
      }
    } catch (error) {
      return { success: false, error: 'Ошибка при входе в систему' }
    }
  }

  const register = async (email: string, password: string, name: string) => {
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password, name }),
      })

      const data = await response.json()

      if (response.ok) {
        // После успешной регистрации автоматически входим через NextAuth
        await nextAuthSignIn('credentials', {
          email,
          password,
          redirect: false,
        })
        return { success: true }
      } else {
        return { success: false, error: data.error }
      }
    } catch (error) {
      return { success: false, error: 'Ошибка при регистрации' }
    }
  }

  const logout = async () => {
    try {
      await nextAuthSignOut({ redirect: false })
    } catch (error) {
      console.error('Ошибка при выходе:', error)
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth должен использоваться внутри AuthProvider')
  }
  return context
}
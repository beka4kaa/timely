"use client"

import { createContext, useContext, ReactNode } from 'react'
import { useSession, signOut as nextAuthSignOut } from 'next-auth/react'

interface User {
  id: string
  email: string
  name: string
  role: string
}

interface AuthContextType {
  user: User | null
  isLoading: boolean
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

  const logout = async () => {
    try {
      await nextAuthSignOut({ redirect: false })
    } catch (error) {
      console.error('Ошибка при выходе:', error)
    }
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth должен использоваться внутри AuthProvider') // i18n-skip
  }
  return context
}
'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function TestOAuthPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    console.log('🧪 TEST OAUTH PAGE:', { status, session })
    
    if (status === 'authenticated' && session) {
      console.log('✅ OAuth SUCCESS! Redirecting to dashboard...', session.user)
      setTimeout(() => {
        router.push('/dashboard')
      }, 2000)
    }
  }, [status, session, router])

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-gray-900 mx-auto"></div>
          <p className="mt-4">Checking authentication...</p>
        </div>
      </div>
    )
  }

  if (status === 'authenticated' && session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-green-600 mb-4">✅ OAuth Success!</h1>
          <p className="mb-2">Welcome, {session.user?.name || session.user?.email}!</p>
          <p className="text-sm text-gray-600">Redirecting to dashboard in 2 seconds...</p>
          <div className="mt-4 p-4 bg-gray-100 rounded text-left text-sm">
            <strong>Session Data:</strong>
            <pre>{JSON.stringify(session, null, 2)}</pre>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-red-600 mb-4">❌ Not Authenticated</h1>
        <p>Please sign in first</p>
        <button 
          onClick={() => router.push('/auth/signin')}
          className="mt-4 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Go to Sign In
        </button>
      </div>
    </div>
  )
}
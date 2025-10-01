'use client'

import { useEffect, useState } from 'react'

// Отключаем SSR для этой страницы
export const dynamic = 'force-dynamic'

export default function DebugEnvPage() {
  const [envData, setEnvData] = useState<any>(null)

  useEffect(() => {
    // Проверяем переменные окружения через API
    fetch('/api/debug-env')
      .then(res => res.json())
      .then(data => setEnvData(data))
      .catch(err => console.error('Env check failed:', err))
  }, [])

  return (
    <div className="min-h-screen p-8">
      <h1 className="text-2xl font-bold mb-4">🔍 Environment Debug</h1>
      
      <div className="space-y-4">
        <div className="p-4 border rounded">
          <h2 className="font-semibold mb-2">Environment Variables</h2>
          <pre className="text-sm bg-gray-100 p-2 rounded">
            {JSON.stringify(envData, null, 2)}
          </pre>
        </div>
        
        <div className="p-4 border rounded">
          <h2 className="font-semibold mb-2">Google OAuth Test</h2>
          <p>Check console for detailed logs when testing OAuth</p>
          <a 
            href="/auth/signin"
            className="inline-block mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Test Google OAuth
          </a>
        </div>
      </div>
    </div>
  )
}
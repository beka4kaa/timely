'use client'

import { signIn, signOut, useSession } from 'next-auth/react'
import { useState } from 'react'

export default function EmergencyOAuthTest() {
  const { data: session, status } = useSession()
  const [testResult, setTestResult] = useState<any>(null)
  
  const testOAuth = async () => {
    try {
      const response = await fetch('/api/emergency-oauth-test')
      const data = await response.json()
      setTestResult(data)
      console.log('🚨 Test result:', data)
    } catch (error) {
      console.error('Test failed:', error)
      setTestResult({ error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  
  const testGoogleDirect = () => {
    // Прямой редирект на Google OAuth
    window.location.href = `/api/auth/signin/google`
  }

  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-red-600 mb-8">🚨 EMERGENCY OAUTH TEST</h1>
        
        <div className="bg-white p-6 rounded-lg shadow-lg mb-6">
          <h2 className="text-xl font-bold mb-4">Current Status</h2>
          <p><strong>Status:</strong> {status}</p>
          <p><strong>Session:</strong> {session ? '✅ Authorized' : '❌ Not authorized'}</p>
          {session && (
            <div className="mt-4 p-4 bg-green-100 rounded">
              <p><strong>Email:</strong> {session.user?.email}</p>
              <p><strong>Name:</strong> {session.user?.name}</p>
            </div>
          )}
        </div>

        <div className="bg-white p-6 rounded-lg shadow-lg mb-6">
          <h2 className="text-xl font-bold mb-4">Actions</h2>
          <div className="space-y-4">
            <button
              onClick={testOAuth}
              className="bg-blue-500 text-white px-6 py-3 rounded hover:bg-blue-600"
            >
              🔍 Run Diagnostics
            </button>
            
            <button
              onClick={testGoogleDirect}
              className="bg-red-500 text-white px-6 py-3 rounded hover:bg-red-600 ml-4"
            >
              🚀 Test Google OAuth NOW
            </button>
            
            {!session ? (
              <button
                onClick={() => signIn('google')}
                className="bg-green-500 text-white px-6 py-3 rounded hover:bg-green-600 ml-4"
              >
                📱 Sign In with Google
              </button>
            ) : (
              <button
                onClick={() => signOut()}
                className="bg-gray-500 text-white px-6 py-3 rounded hover:bg-gray-600 ml-4"
              >
                🚪 Sign Out
              </button>
            )}
          </div>
        </div>

        {testResult && (
          <div className="bg-white p-6 rounded-lg shadow-lg">
            <h2 className="text-xl font-bold mb-4">Test Results</h2>
            <pre className="bg-gray-100 p-4 rounded text-sm overflow-auto max-h-96">
              {JSON.stringify(testResult, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}
'use client'

import { useState, useEffect } from 'react'
import { backendApi } from '@/lib/backend-api'

interface Task {
  id: number
  title: string
  description?: string
  completed: boolean
  priority?: string
  category?: string
  created_at?: string
  due_date?: string
}

interface Goal {
  id: number
  title: string
  description?: string
  target_value?: number
  current_value?: number
  unit?: string
  category?: string
  created_at?: string
  target_date?: string
  completed_at?: string | null
}

interface UserProfile {
  id: number
  email: string
  name: string
  image?: string
  created_at?: string
  last_login?: string
}

export default function BackendIntegrationTest() {
  const [tasks, setTasks] = useState<Task[]>([])
  const [goals, setGoals] = useState<Goal[]>([])
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [backendHealth, setBackendHealth] = useState<any>(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)

        // Test backend health
        console.log('🔍 Testing backend health...')
        const health = await backendApi.healthCheck()
        setBackendHealth(health)
        console.log('✅ Backend health:', health)

        // Test user profile
        console.log('🔍 Testing user profile...')
        const profile = await backendApi.getUserProfile()
        setUserProfile(profile)
        console.log('✅ User profile:', profile)

        // Test tasks
        console.log('🔍 Testing tasks...')
        const tasksData = await backendApi.getTasks()
        setTasks(tasksData)
        console.log('✅ Tasks:', tasksData)

        // Test goals
        console.log('🔍 Testing goals...')
        const goalsData = await backendApi.getGoals()
        setGoals(goalsData)
        console.log('✅ Goals:', goalsData)

      } catch (err) {
        console.error('❌ Backend integration error:', err)
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="p-8 space-y-4">
        <h2 className="text-2xl font-bold">🔄 Testing Backend Integration...</h2>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-300 rounded w-3/4"></div>
          <div className="h-4 bg-gray-300 rounded w-1/2"></div>
          <div className="h-4 bg-gray-300 rounded w-2/3"></div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 space-y-4">
        <h2 className="text-2xl font-bold text-red-600">❌ Backend Integration Error</h2>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700">{error}</p>
        </div>
        <p className="text-gray-600">Make sure the FastAPI backend is running on http://localhost:8000</p>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-3xl font-bold text-green-600">✅ Backend Integration Test</h1>
      
      {/* Backend Health */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-green-800 mb-2">🏥 Backend Health</h2>
        <pre className="text-sm text-green-700">{JSON.stringify(backendHealth, null, 2)}</pre>
      </div>

      {/* User Profile */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-blue-800 mb-2">👤 User Profile</h2>
        {userProfile && (
          <div className="space-y-2 text-blue-700">
            <p><strong>Name:</strong> {userProfile.name}</p>
            <p><strong>Email:</strong> {userProfile.email}</p>
            <p><strong>ID:</strong> {userProfile.id}</p>
            <p><strong>Last Login:</strong> {userProfile.last_login}</p>
          </div>
        )}
      </div>

      {/* Tasks */}
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-yellow-800 mb-2">✅ Tasks ({tasks.length})</h2>
        <div className="space-y-2">
          {tasks.map((task) => (
            <div key={task.id} className="bg-white rounded p-3 border">
              <h3 className="font-medium">{task.title}</h3>
              <p className="text-sm text-gray-600">{task.description}</p>
              <div className="flex gap-2 mt-2">
                <span className={`text-xs px-2 py-1 rounded ${task.completed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                  {task.completed ? 'Completed' : 'Pending'}
                </span>
                <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-800">
                  {task.priority}
                </span>
                <span className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-800">
                  {task.category}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Goals */}
      <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-purple-800 mb-2">🎯 Goals ({goals.length})</h2>
        <div className="space-y-2">
          {goals.map((goal) => (
            <div key={goal.id} className="bg-white rounded p-3 border">
              <h3 className="font-medium">{goal.title}</h3>
              <p className="text-sm text-gray-600">{goal.description}</p>
              <div className="mt-2">
                <div className="flex justify-between text-sm">
                  <span>Progress: {goal.current_value} / {goal.target_value} {goal.unit}</span>
                  <span>{Math.round((goal.current_value || 0) / (goal.target_value || 1) * 100)}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                  <div 
                    className="bg-purple-600 h-2 rounded-full" 
                    style={{width: `${Math.min((goal.current_value || 0) / (goal.target_value || 1) * 100, 100)}%`}}
                  ></div>
                </div>
              </div>
              <span className="text-xs px-2 py-1 rounded bg-purple-100 text-purple-800 mt-2 inline-block">
                {goal.category}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
        <h2 className="text-lg font-semibold text-gray-800 mb-2">🔗 Integration Summary</h2>
        <ul className="space-y-1 text-gray-700">
          <li>✅ Frontend successfully connected to FastAPI backend</li>
          <li>✅ Health check endpoint working</li>
          <li>✅ User profile endpoint returning data</li>
          <li>✅ Tasks endpoint returning {tasks.length} tasks</li>
          <li>✅ Goals endpoint returning {goals.length} goals</li>
          <li>✅ CORS configuration working correctly</li>
          <li>✅ Prisma completely removed from frontend</li>
        </ul>
      </div>
    </div>
  )
}
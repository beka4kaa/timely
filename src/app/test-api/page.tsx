"use client"

import { useState } from 'react'
import { FastAPIClient } from '@/lib/fastapi-client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function TestAPIPage() {
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const client = new FastAPIClient()

  const testHealthCheck = async () => {
    setLoading(true)
    try {
      const response = await client.healthCheck()
      console.log('Health check response:', response)
      setResult({ type: 'health', data: response })
    } catch (error) {
      console.error('Health check error:', error)
      setResult({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setLoading(false)
    }
  }

  const testGetTasks = async () => {
    setLoading(true)
    try {
      const response = await client.getTasks()
      console.log('Get tasks response:', response)
      setResult({ type: 'tasks', data: response })
    } catch (error) {
      console.error('Get tasks error:', error)
      setResult({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setLoading(false)
    }
  }

  const testCreateTask = async () => {
    setLoading(true)
    try {
      const task = {
        title: 'Test Task from Frontend',
        description: 'This is a test task created from Next.js',
        priority: 'medium',
        category: 'work'
      }
      const response = await client.createTask(task)
      console.log('Create task response:', response)
      setResult({ type: 'create', data: response })
    } catch (error) {
      console.error('Create task error:', error)
      setResult({ type: 'error', data: error instanceof Error ? error.message : 'Unknown error' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>FastAPI Integration Test</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Button onClick={testHealthCheck} disabled={loading}>
              Test Health Check
            </Button>
            <Button onClick={testGetTasks} disabled={loading}>
              Test Get Tasks
            </Button>
            <Button onClick={testCreateTask} disabled={loading}>
              Test Create Task
            </Button>
          </div>
          
          {loading && (
            <div className="flex items-center gap-2">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
              <span>Loading...</span>
            </div>
          )}

          {result && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Result ({result.type})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="bg-gray-100 p-4 rounded-md overflow-auto">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
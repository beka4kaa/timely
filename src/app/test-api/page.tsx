"use client"

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

interface UserStats {
  overview: {
    totalGoals: number
    completedGoals: number
    totalTasks: number
    completedTasks: number
    totalAchievements: number
    totalEvents: number
  }
  completionRates: {
    goals: number
    tasks: number
  }
  recentActivity: {
    goalsCreated: number
    tasksCompleted: number
    achievementsEarned: number
  }
}

interface Goal {
  id: string
  title: string
  description?: string
  status: 'ACTIVE' | 'COMPLETED' | 'PAUSED'
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  targetDate?: string
  color?: string
  createdAt: string
  updatedAt: string
}

export default function TestApiPage() {
  const { data: session } = useSession()
  const [stats, setStats] = useState<UserStats | null>(null)
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(false)
  const [newGoal, setNewGoal] = useState({
    title: '',
    description: '',
    priority: 'MEDIUM' as 'LOW' | 'MEDIUM' | 'HIGH',
    targetDate: '',
    color: '#3b82f6'
  })

  const fetchStats = async () => {
    try {
      const response = await fetch('/api/user/stats')
      if (response.ok) {
        const data = await response.json()
        setStats(data.stats)
      }
    } catch (error) {
      console.error('Error fetching stats:', error)
    }
  }

  const fetchGoals = async () => {
    try {
      const response = await fetch('/api/goals')
      if (response.ok) {
        const data = await response.json()
        setGoals(data.goals)
      }
    } catch (error) {
      console.error('Error fetching goals:', error)
    }
  }

  const createGoal = async () => {
    if (!newGoal.title) return
    
    setLoading(true)
    try {
      const response = await fetch('/api/goals', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...newGoal,
          targetDate: newGoal.targetDate ? new Date(newGoal.targetDate).toISOString() : undefined
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setGoals(prev => [...prev, data.goal])
        setNewGoal({
          title: '',
          description: '',
          priority: 'MEDIUM',
          targetDate: '',
          color: '#3b82f6'
        })
        await fetchStats() // Update stats
      }
    } catch (error) {
      console.error('Error creating goal:', error)
    }
    setLoading(false)
  }

  const deleteGoal = async (id: string) => {
    try {
      const response = await fetch(`/api/goals/${id}`, {
        method: 'DELETE'
      })
      
      if (response.ok) {
        setGoals(prev => prev.filter(goal => goal.id !== id))
        await fetchStats() // Update stats
      }
    } catch (error) {
      console.error('Error deleting goal:', error)
    }
  }

  useEffect(() => {
    if (session) {
      fetchStats()
      fetchGoals()
    }
  }, [session])

  if (!session) {
    return (
      <div className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <CardTitle>API Test Page</CardTitle>
            <CardDescription>Please sign in to test the APIs</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">API Test Dashboard</h1>
        <Badge variant="outline">User ID: {session.user?.id}</Badge>
      </div>

      {/* User Stats */}
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle>User Statistics</CardTitle>
            <CardDescription>Overview of your progress</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.overview.totalGoals}</div>
              <div className="text-sm text-muted-foreground">Total Goals</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{stats.overview.completedGoals}</div>
              <div className="text-sm text-muted-foreground">Completed Goals</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">{stats.overview.totalTasks}</div>
              <div className="text-sm text-muted-foreground">Total Tasks</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">{stats.overview.totalAchievements}</div>
              <div className="text-sm text-muted-foreground">Achievements</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-indigo-600">{stats.completionRates.goals}%</div>
              <div className="text-sm text-muted-foreground">Goals Completion</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-pink-600">{stats.completionRates.tasks}%</div>
              <div className="text-sm text-muted-foreground">Tasks Completion</div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create New Goal */}
      <Card>
        <CardHeader>
          <CardTitle>Create New Goal</CardTitle>
          <CardDescription>Test the goal creation API</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Goal title"
            value={newGoal.title}
            onChange={(e) => setNewGoal(prev => ({ ...prev, title: e.target.value }))}
          />
          <Textarea
            placeholder="Goal description (optional)"
            value={newGoal.description}
            onChange={(e) => setNewGoal(prev => ({ ...prev, description: e.target.value }))}
          />
          <div className="grid grid-cols-2 gap-4">
            <select
              value={newGoal.priority}
              onChange={(e) => setNewGoal(prev => ({ ...prev, priority: e.target.value as 'LOW' | 'MEDIUM' | 'HIGH' }))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="LOW">Low Priority</option>
              <option value="MEDIUM">Medium Priority</option>
              <option value="HIGH">High Priority</option>
            </select>
            <Input
              type="date"
              value={newGoal.targetDate}
              onChange={(e) => setNewGoal(prev => ({ ...prev, targetDate: e.target.value }))}
            />
          </div>
          <Button onClick={createGoal} disabled={loading || !newGoal.title}>
            {loading ? 'Creating...' : 'Create Goal'}
          </Button>
        </CardContent>
      </Card>

      {/* Goals List */}
      <Card>
        <CardHeader>
          <CardTitle>Your Goals</CardTitle>
          <CardDescription>All goals from your account</CardDescription>
        </CardHeader>
        <CardContent>
          {goals.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No goals yet. Create your first goal above!</p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {goals.map((goal) => (
                <Card key={goal.id} className="relative">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <CardTitle className="text-lg">{goal.title}</CardTitle>
                      <Badge 
                        variant={goal.status === 'COMPLETED' ? 'default' : 'secondary'}
                        className="ml-2"
                      >
                        {goal.status}
                      </Badge>
                    </div>
                    {goal.description && (
                      <CardDescription>{goal.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <Badge variant="outline">{goal.priority}</Badge>
                      {goal.targetDate && (
                        <span className="text-muted-foreground">
                          Due: {new Date(goal.targetDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => deleteGoal(goal.id)}
                      className="w-full"
                    >
                      Delete Goal
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
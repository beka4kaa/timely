"use client"

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import { 
  Plus, 
  Target, 
  Calendar,
  TrendingUp,
  Award,
  CheckCircle2,
  Circle,
  Clock,
  Flag,
  CalendarDays,
  Clipboard,
  CalendarClock,
  Zap,
  Sprout,
  Briefcase,
  Dumbbell,
  DollarSign,
  BookOpen,
  Users
} from 'lucide-react'

interface Goal {
  id: string
  title: string
  description?: string
  period: 'yearly' | 'quarterly' | 'monthly' | 'weekly'
  category: 'personal' | 'professional' | 'health' | 'financial' | 'learning' | 'relationships'
  progress: number // 0-100
  targetDate: Date
  createdAt: Date
  status: 'active' | 'completed' | 'paused' | 'cancelled'
}

const PERIODS = {
  yearly: { label: 'Годовые', duration: '12 месяцев', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300', icon: CalendarDays },
  quarterly: { label: 'Квартальные', duration: '3 месяца', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300', icon: Clipboard },
  monthly: { label: 'Месячные', duration: '1 месяц', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300', icon: CalendarClock },
  weekly: { label: 'Недельные', duration: '1 неделя', color: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300', icon: Zap },
}

const CATEGORIES = {
  personal: { label: 'Личностный рост', icon: Sprout, color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' },
  professional: { label: 'Карьера', icon: Briefcase, color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300' },
  health: { label: 'Здоровье', icon: Dumbbell, color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
  financial: { label: 'Финансы', icon: DollarSign, color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' },
  learning: { label: 'Обучение', icon: BookOpen, color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300' },
  relationships: { label: 'Отношения', icon: Users, color: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300' },
}

export function GoalsComponent() {
  const [goals, setGoals] = useState<Goal[]>([
    {
      id: '1',
      title: 'Изучить React и Next.js',
      description: 'Полное изучение современной разработки фронтенда',
      period: 'yearly',
      category: 'learning',
      progress: 65,
      targetDate: new Date('2024-12-31'),
      createdAt: new Date('2024-01-01'),
      status: 'active'
    },
    {
      id: '2',
      title: 'Заниматься спортом 4 раза в неделю',
      description: 'Поддержание физической формы',
      period: 'weekly',
      category: 'health',
      progress: 80,
      targetDate: new Date('2024-12-31'),
      createdAt: new Date('2024-01-15'),
      status: 'active'
    }
  ])

  const [newGoal, setNewGoal] = useState({
    title: '',
    description: '',
    period: 'monthly' as const,
    category: 'personal' as const
  })

  const [isDialogOpen, setIsDialogOpen] = useState(false)

  const addGoal = () => {
    if (!newGoal.title) return

    const goal: Goal = {
      id: Math.random().toString(36).substring(7),
      title: newGoal.title,
      description: newGoal.description,
      period: newGoal.period,
      category: newGoal.category,
      progress: 0,
      targetDate: new Date(),
      createdAt: new Date(),
      status: 'active'
    }

    setGoals([...goals, goal])
    setNewGoal({ title: '', description: '', period: 'monthly', category: 'personal' })
    setIsDialogOpen(false)
  }

  const updateProgress = (goalId: string, progress: number) => {
    setGoals(goals.map(goal => 
      goal.id === goalId 
        ? { ...goal, progress: Math.max(0, Math.min(100, progress)) }
        : goal
    ))
  }

  const activeGoals = goals.filter(goal => goal.status === 'active')
  const completedGoals = goals.filter(goal => goal.progress >= 100)

  return (
    <div className="space-y-6">
      {/* Статистика */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Активных целей</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeGoals.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Завершено</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedGoals.length}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Средний прогресс</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {activeGoals.length > 0 
                ? Math.round(activeGoals.reduce((sum, goal) => sum + goal.progress, 0) / activeGoals.length)
                : 0}%
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Мотивация</CardTitle>
            <Award className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">💪</div>
            <p className="text-xs text-muted-foreground">Продолжайте!</p>
          </CardContent>
        </Card>
      </div>

      {/* Управление */}
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-medium">Мои цели</h3>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Новая цель
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Создать новую цель</DialogTitle>
              <DialogDescription>
                Определите цель и сроки её достижения
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Input
                  placeholder="Название цели"
                  value={newGoal.title}
                  onChange={(e) => setNewGoal({ ...newGoal, title: e.target.value })}
                />
              </div>
              <div>
                <Textarea
                  placeholder="Описание (необязательно)"
                  value={newGoal.description}
                  onChange={(e) => setNewGoal({ ...newGoal, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Select
                  value={newGoal.period}
                  onValueChange={(value) => setNewGoal({ ...newGoal, period: value as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PERIODS).map(([key, period]) => (
                      <SelectItem key={key} value={key}>
                        {React.createElement(period.icon, { className: "h-4 w-4 inline mr-2" })}
                        {period.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                
                <Select
                  value={newGoal.category}
                  onValueChange={(value) => setNewGoal({ ...newGoal, category: value as any })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORIES).map(([key, category]) => (
                      <SelectItem key={key} value={key}>
                        {React.createElement(category.icon, { className: "h-4 w-4 inline mr-2" })}
                        {category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={addGoal}>Создать цель</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Список целей */}
      <Tabs defaultValue="active" className="w-full">
        <TabsList>
          <TabsTrigger value="active">Активные</TabsTrigger>
          <TabsTrigger value="completed">Завершенные</TabsTrigger>
          <TabsTrigger value="all">Все</TabsTrigger>
        </TabsList>
        
        <TabsContent value="active" className="space-y-4">
          {activeGoals.map((goal) => (
            <Card key={goal.id}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {React.createElement(CATEGORIES[goal.category].icon, { className: "h-5 w-5" })}
                    <CardTitle className="text-lg">{goal.title}</CardTitle>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="secondary" className={PERIODS[goal.period].color}>
                      {React.createElement(PERIODS[goal.period].icon, { className: "h-3 w-3 mr-1" })}
                      {PERIODS[goal.period].label}
                    </Badge>
                    <Badge variant="outline" className={CATEGORIES[goal.category].color}>
                      {React.createElement(CATEGORIES[goal.category].icon, { className: "h-3 w-3 mr-1" })}
                      {CATEGORIES[goal.category].label}
                    </Badge>
                  </div>
                </div>
                {goal.description && (
                  <p className="text-sm text-muted-foreground">{goal.description}</p>
                )}
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-sm">
                    <span>Прогресс</span>
                    <span className="font-medium">{goal.progress}%</span>
                  </div>
                  <Progress value={goal.progress} className="w-full" />
                  <div className="flex space-x-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateProgress(goal.id, goal.progress - 10)}
                    >
                      -10%
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => updateProgress(goal.id, goal.progress + 10)}
                    >
                      +10%
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => updateProgress(goal.id, 100)}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" />
                      Завершить
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
        
        <TabsContent value="completed" className="space-y-4">
          {completedGoals.map((goal) => (
            <Card key={goal.id} className="opacity-75">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {React.createElement(CATEGORIES[goal.category].icon, { className: "h-5 w-5" })}
                    <CardTitle className="text-lg line-through">{goal.title}</CardTitle>
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </TabsContent>
        
        <TabsContent value="all" className="space-y-4">
          {goals.map((goal) => (
            <Card key={goal.id} className={goal.progress >= 100 ? "opacity-75" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    {React.createElement(CATEGORIES[goal.category].icon, { className: "h-5 w-5" })}
                    <CardTitle className={`text-lg ${goal.progress >= 100 ? "line-through" : ""}`}>
                      {goal.title}
                    </CardTitle>
                    {goal.progress >= 100 && <CheckCircle2 className="h-5 w-5 text-green-600" />}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant="secondary" className={PERIODS[goal.period].color}>
                      {React.createElement(PERIODS[goal.period].icon, { className: "h-3 w-3 mr-1" })}
                      {PERIODS[goal.period].label}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  )
}
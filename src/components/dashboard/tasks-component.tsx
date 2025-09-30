"use client"

import React, { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
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
  Plus, 
  CheckSquare, 
  Clock,
  AlertCircle,
  Briefcase,
  Home,
  Dumbbell,
  BookOpen,
  Palette,
  Flag,
  Calendar,
  Filter,
  MoreHorizontal,
  Edit,
  Trash2
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Task {
  id: string
  title: string
  description?: string
  completed: boolean
  priority: 'high' | 'medium' | 'low'
  category: 'work' | 'personal' | 'health' | 'learning' | 'hobby'
  dueDate?: Date
  createdAt: Date
  completedAt?: Date
}

const PRIORITIES = {
  high: { label: 'Высокий', color: 'bg-red-100 text-red-800', icon: AlertCircle },
  medium: { label: 'Средний', color: 'bg-yellow-100 text-yellow-800', icon: Flag },
  low: { label: 'Низкий', color: 'bg-green-100 text-green-800', icon: Clock },
}

const CATEGORIES = {
  work: { label: 'Работа', color: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300', icon: Briefcase },
  personal: { label: 'Личное', color: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300', icon: Home },
  health: { label: 'Здоровье', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300', icon: Dumbbell },
  learning: { label: 'Обучение', color: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-300', icon: BookOpen },
  hobby: { label: 'Хобби', color: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300', icon: Palette },
}

export function TasksComponent() {
  const [tasks, setTasks] = useState<Task[]>([
    {
      id: '1',
      title: 'Завершить проект по React',
      description: 'Добавить последние компоненты и протестировать',
      completed: false,
      priority: 'high',
      category: 'work',
      dueDate: new Date(Date.now() + 86400000), // завтра
      createdAt: new Date(),
    },
    {
      id: '2',
      title: 'Утренняя зарядка',
      completed: true,
      priority: 'medium',
      category: 'health',
      createdAt: new Date(),
      completedAt: new Date(),
    },
    {
      id: '3',
      title: 'Прочитать главу книги',
      description: 'Продолжить чтение "Clean Code"',
      completed: false,
      priority: 'low',
      category: 'learning',
      createdAt: new Date(),
    }
  ])

  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  
  // Форма новой задачи
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium' as Task['priority'],
    category: 'personal' as Task['category'],
    dueDate: '',
  })

  // Фильтрация задач
  const filteredTasks = tasks.filter(task => {
    if (filter === 'active' && task.completed) return false
    if (filter === 'completed' && !task.completed) return false
    if (categoryFilter !== 'all' && task.category !== categoryFilter) return false
    if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false
    return true
  })

  // Переключение выполнения задачи
  const toggleTask = (taskId: string) => {
    setTasks(prev => prev.map(task => 
      task.id === taskId 
        ? { 
            ...task, 
            completed: !task.completed,
            completedAt: !task.completed ? new Date() : undefined
          }
        : task
    ))
  }

  // Добавление новой задачи
  const addTask = () => {
    if (!newTask.title.trim()) return

    const task: Task = {
      id: Date.now().toString(),
      title: newTask.title,
      description: newTask.description || undefined,
      completed: false,
      priority: newTask.priority,
      category: newTask.category,
      dueDate: newTask.dueDate ? new Date(newTask.dueDate) : undefined,
      createdAt: new Date(),
    }

    setTasks(prev => [task, ...prev])
    setNewTask({
      title: '',
      description: '',
      priority: 'medium',
      category: 'personal',
      dueDate: '',
    })
    setIsAddDialogOpen(false)
  }

  // Удаление задачи
  const deleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(task => task.id !== taskId))
  }

  // Статистика
  const stats = {
    total: tasks.length,
    completed: tasks.filter(t => t.completed).length,
    active: tasks.filter(t => !t.completed).length,
    todayDue: tasks.filter(t => {
      if (!t.dueDate) return false
      const today = new Date()
      const due = new Date(t.dueDate)
      return due.toDateString() === today.toDateString()
    }).length
  }

  // Проверка просроченных задач
  const isOverdue = (task: Task) => {
    if (!task.dueDate || task.completed) return false
    return new Date(task.dueDate) < new Date()
  }

  return (
    <div className="space-y-6">
      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Всего задач</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-600">{stats.completed}</div>
            <p className="text-xs text-muted-foreground">Выполнено</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.active}</div>
            <p className="text-xs text-muted-foreground">Активных</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-orange-600">{stats.todayDue}</div>
            <p className="text-xs text-muted-foreground">На сегодня</p>
          </CardContent>
        </Card>
      </div>

      {/* Фильтры и добавление */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between">
        <div className="flex flex-wrap gap-2">
          <Select value={filter} onValueChange={(value: any) => setFilter(value)}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Все задачи" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все задачи</SelectItem>
              <SelectItem value="active">Активные</SelectItem>
              <SelectItem value="completed">Выполненные</SelectItem>
            </SelectContent>
          </Select>

          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Категория" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все категории</SelectItem>
              {Object.entries(CATEGORIES).map(([key, category]) => (
                <SelectItem key={key} value={key}>
                  {React.createElement(category.icon, { className: "h-4 w-4 inline mr-2" })}
                  {category.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Приоритет" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все приоритеты</SelectItem>
              {Object.entries(PRIORITIES).map(([key, priority]) => (
                <SelectItem key={key} value={key}>
                  {priority.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Новая задача
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Добавить новую задачу</DialogTitle>
              <DialogDescription>
                Создайте новую задачу с описанием и приоритетом
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4">
              <div>
                <Input
                  placeholder="Название задачи..."
                  value={newTask.title}
                  onChange={(e) => setNewTask(prev => ({ ...prev, title: e.target.value }))}
                />
              </div>
              
              <div>
                <Textarea
                  placeholder="Описание (необязательно)..."
                  value={newTask.description}
                  onChange={(e) => setNewTask(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Категория</label>
                  <Select 
                    value={newTask.category} 
                    onValueChange={(value: Task['category']) => 
                      setNewTask(prev => ({ ...prev, category: value }))
                    }
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
                
                <div>
                  <label className="text-sm font-medium mb-2 block">Приоритет</label>
                  <Select 
                    value={newTask.priority} 
                    onValueChange={(value: Task['priority']) => 
                      setNewTask(prev => ({ ...prev, priority: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(PRIORITIES).map(([key, priority]) => (
                        <SelectItem key={key} value={key}>
                          {priority.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Срок выполнения</label>
                <Input
                  type="date"
                  value={newTask.dueDate}
                  onChange={(e) => setNewTask(prev => ({ ...prev, dueDate: e.target.value }))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Отмена
              </Button>
              <Button onClick={addTask} disabled={!newTask.title.trim()}>
                Добавить задачу
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Список задач */}
      <div className="space-y-3">
        {filteredTasks.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <CheckSquare className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-medium mb-2">Нет задач</h3>
              <p className="text-muted-foreground mb-4">
                {filter === 'completed' 
                  ? 'Вы еще не выполнили ни одной задачи'
                  : filter === 'active'
                  ? 'У вас нет активных задач'
                  : 'Добавьте свою первую задачу'
                }
              </p>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить задачу
              </Button>
            </CardContent>
          </Card>
        ) : (
          filteredTasks.map(task => (
            <Card key={task.id} className={cn(
              "transition-all duration-200",
              task.completed && "opacity-70",
              isOverdue(task) && "border-red-200 bg-red-50"
            )}>
              <CardContent className="p-4">
                <div className="flex items-start space-x-3">
                  <Checkbox
                    checked={task.completed}
                    onCheckedChange={() => toggleTask(task.id)}
                    className="mt-1"
                  />
                  
                  <div className="flex-1 space-y-2">
                    <div className="flex items-start justify-between">
                      <h3 className={cn(
                        "font-medium",
                        task.completed && "line-through text-muted-foreground"
                      )}>
                        {task.title}
                      </h3>
                      
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </div>
                    
                    {task.description && (
                      <p className="text-sm text-muted-foreground">
                        {task.description}
                      </p>
                    )}
                    
                    <div className="flex flex-wrap gap-2">
                      <Badge className={CATEGORIES[task.category].color}>
                        {React.createElement(CATEGORIES[task.category].icon, { className: "h-4 w-4" })} {CATEGORIES[task.category].label}
                      </Badge>
                      
                      <Badge className={PRIORITIES[task.priority].color}>
                        {PRIORITIES[task.priority].label}
                      </Badge>
                      
                      {task.dueDate && (
                        <Badge variant={isOverdue(task) ? "destructive" : "outline"}>
                          <Calendar className="h-3 w-3 mr-1" />
                          {new Date(task.dueDate).toLocaleDateString('ru-RU')}
                        </Badge>
                      )}
                      
                      {task.completed && task.completedAt && (
                        <Badge variant="outline" className="text-green-700">
                          <CheckSquare className="h-3 w-3 mr-1" />
                          Выполнено {new Date(task.completedAt).toLocaleDateString('ru-RU')}
                        </Badge>
                      )}
                      
                      {isOverdue(task) && (
                        <Badge variant="destructive">
                          <AlertCircle className="h-3 w-3 mr-1" />
                          Просрочено
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
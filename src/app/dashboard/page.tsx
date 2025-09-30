import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { 
  Calendar,
  CheckSquare,
  Target,
  Trophy,
  Heart,
  TrendingUp,
  Clock,
  Star,
  Zap,
  ArrowRight,
  Plus
} from "lucide-react"
import Link from "next/link"

export default function DashboardPage() {
  // Моковые данные для демонстрации
  const stats = {
    tasks: {
      total: 15,
      completed: 8,
      today: 5
    },
    goals: {
      active: 4,
      avgProgress: 65
    },
    achievements: {
      total: 12,
      thisMonth: 3
    },
    streak: {
      current: 7,
      best: 21
    }
  }

  const todayTasks = [
    { id: 1, title: "Утренняя зарядка", completed: true, priority: "medium" },
    { id: 2, title: "Завершить проект React", completed: false, priority: "high" },
    { id: 3, title: "Прочитать главу книги", completed: false, priority: "low" },
  ]

  const recentAchievements = [
    { id: 1, title: "Получил повышение на работе", date: "15 сен", category: "professional" },
    { id: 2, title: "Пробежал первый полумарафон", date: "20 авг", category: "health" },
  ]

  const activeGoals = [
    { id: 1, title: "Изучить React и Next.js", progress: 65, target: "31 дек" },
    { id: 2, title: "Заниматься спортом 4 раза в неделю", progress: 30, target: "31 дек" },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center gap-2 py-4">
            <Separator orientation="vertical" className="mr-2 h-4" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink href="/">
                    Time Schedule
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Dashboard</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          {/* Приветствие */}
          <div className="mb-6">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <Zap className="h-8 w-8" />
              Добро пожаловать!
            </h1>
            <p className="text-muted-foreground">
              Сегодня {new Date().toLocaleDateString('ru-RU', { 
                weekday: 'long', 
                year: 'numeric', 
                month: 'long', 
                day: 'numeric' 
              })}
            </p>
          </div>

          {/* Основная статистика */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <CheckSquare className="h-8 w-8 text-blue-600" />
                  <div>
                    <div className="text-2xl font-bold">{stats.tasks.completed}/{stats.tasks.total}</div>
                    <p className="text-xs text-muted-foreground">Задач выполнено</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Target className="h-8 w-8 text-purple-600" />
                  <div>
                    <div className="text-2xl font-bold">{stats.goals.avgProgress}%</div>
                    <p className="text-xs text-muted-foreground">Прогресс целей</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Trophy className="h-8 w-8 text-yellow-600" />
                  <div>
                    <div className="text-2xl font-bold">{stats.achievements.total}</div>
                    <p className="text-xs text-muted-foreground">Достижений</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <div className="flex items-center space-x-2">
                  <Zap className="h-8 w-8 text-orange-600" />
                  <div>
                    <div className="text-2xl font-bold">{stats.streak.current}</div>
                    <p className="text-xs text-muted-foreground">Дней подряд</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Быстрые действия */}
          <Card className="mb-6">
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Zap className="h-5 w-5" />
                <span>Быстрые действия</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Link href="/dashboard/tasks">
                  <Button variant="outline" className="w-full h-16 flex-col">
                    <Plus className="h-6 w-6 mb-1" />
                    <span className="text-xs">Новая задача</span>
                  </Button>
                </Link>

                <Link href="/dashboard/goals">
                  <Button variant="outline" className="w-full h-16 flex-col">
                    <Target className="h-6 w-6 mb-1" />
                    <span className="text-xs">Новая цель</span>
                  </Button>
                </Link>

                <Link href="/dashboard/achievements">
                  <Button variant="outline" className="w-full h-16 flex-col">
                    <Trophy className="h-6 w-6 mb-1" />
                    <span className="text-xs">Достижение</span>
                  </Button>
                </Link>

                <Link href="/dashboard/self-work">
                  <Button variant="outline" className="w-full h-16 flex-col">
                    <Heart className="h-6 w-6 mb-1" />
                    <span className="text-xs">Рефлексия</span>
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Задачи на сегодня */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center space-x-2">
                  <Clock className="h-5 w-5" />
                  <span>Задачи на сегодня</span>
                </CardTitle>
                <Link href="/dashboard/tasks">
                  <Button variant="ghost" size="sm">
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="space-y-3">
                {todayTasks.map(task => (
                  <div key={task.id} className="flex items-center space-x-3 p-3 rounded-lg border">
                    <div className={`w-4 h-4 rounded border-2 ${task.completed ? 'bg-green-500 border-green-500' : 'border-gray-300'}`}>
                      {task.completed && <CheckSquare className="h-3 w-3 text-white" />}
                    </div>
                    <span className={`flex-1 ${task.completed ? 'line-through text-muted-foreground' : ''}`}>
                      {task.title}
                    </span>
                    <Badge variant={task.priority === 'high' ? 'destructive' : task.priority === 'medium' ? 'default' : 'secondary'}>
                      {task.priority}
                    </Badge>
                  </div>
                ))}
                {todayTasks.length === 0 && (
                  <div className="text-center py-6 text-muted-foreground">
                    <CheckSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Нет задач на сегодня</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Активные цели */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center space-x-2">
                  <Target className="h-5 w-5" />
                  <span>Активные цели</span>
                </CardTitle>
                <Link href="/dashboard/goals">
                  <Button variant="ghost" size="sm">
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </CardHeader>
              <CardContent className="space-y-4">
                {activeGoals.map(goal => (
                  <div key={goal.id} className="space-y-2">
                    <div className="flex justify-between items-start">
                      <span className="font-medium text-sm">{goal.title}</span>
                      <span className="text-xs text-muted-foreground">{goal.progress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div 
                        className="bg-blue-600 h-2 rounded-full transition-all" 
                        style={{ width: `${goal.progress}%` }}
                      />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      До {goal.target}
                    </div>
                  </div>
                ))}
                {activeGoals.length === 0 && (
                  <div className="text-center py-6 text-muted-foreground">
                    <Target className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Нет активных целей</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Последние достижения */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center space-x-2">
                <Trophy className="h-5 w-5" />
                <span>Недавние достижения</span>
              </CardTitle>
              <Link href="/dashboard/achievements">
                <Button variant="ghost" size="sm">
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-2 gap-4">
                {recentAchievements.map(achievement => (
                  <div key={achievement.id} className="flex items-center space-x-3 p-3 rounded-lg border bg-gradient-to-r from-yellow-50 to-orange-50">
                    <div className="bg-yellow-100 p-2 rounded-full">
                      <Star className="h-4 w-4 text-yellow-600" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-medium text-sm">{achievement.title}</h4>
                      <p className="text-xs text-muted-foreground">{achievement.date}</p>
                    </div>
                    <Badge variant="outline">{achievement.category}</Badge>
                  </div>
                ))}
                {recentAchievements.length === 0 && (
                  <div className="col-span-2 text-center py-6 text-muted-foreground">
                    <Trophy className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    <p>Нет достижений пока</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Мотивационная цитата */}
          <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
            <CardContent className="p-6 text-center">
              <div className="mb-4">
                <Heart className="h-8 w-8 mx-auto text-purple-600" />
              </div>
              <blockquote className="text-lg font-medium text-purple-900 mb-2">
                &ldquo;Каждое достижение начинается с решения попробовать.&rdquo;
              </blockquote>
              <p className="text-sm text-purple-600">— Мотивация дня</p>
            </CardContent>
          </Card>
    </div>
  )
}

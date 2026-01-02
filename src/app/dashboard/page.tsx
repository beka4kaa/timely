import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

export const dynamic = 'force-dynamic'

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
  Clock,
  BookOpen,
  ArrowRight,
  Target,
  Zap,
  Play
} from "lucide-react"
import Link from "next/link"

export default function DashboardPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center gap-2 py-4">
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink href="/">
                Study Planner
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Dashboard</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Welcome */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
          <BookOpen className="h-8 w-8" />
          Study Planner
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

      {/* Main CTA */}
      <Card className="bg-gradient-to-r from-violet-500/10 to-purple-500/10 border-violet-200 dark:border-violet-800">
        <CardContent className="p-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold mb-2">Начать планирование</h2>
              <p className="text-muted-foreground mb-4">
                Создайте уроки, события и перерывы для вашего дня
              </p>
              <Link href="/dashboard/study">
                <Button size="lg" className="gap-2">
                  <Play className="h-5 w-5" />
                  Открыть планировщик
                </Button>
              </Link>
            </div>
            <div className="hidden md:block">
              <div className="text-6xl">📚</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link href="/dashboard/study">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="bg-violet-100 dark:bg-violet-900/30 p-3 rounded-full">
                  <BookOpen className="h-6 w-6 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-semibold">План на сегодня</h3>
                  <p className="text-sm text-muted-foreground">Уроки и события</p>
                </div>
                <ArrowRight className="h-5 w-5 ml-auto text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/history">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="bg-blue-100 dark:bg-blue-900/30 p-3 rounded-full">
                  <Calendar className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <h3 className="font-semibold">История</h3>
                  <p className="text-sm text-muted-foreground">Последние 14 дней</p>
                </div>
                <ArrowRight className="h-5 w-5 ml-auto text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/schedule">
          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="bg-green-100 dark:bg-green-900/30 p-3 rounded-full">
                  <Clock className="h-6 w-6 text-green-600" />
                </div>
                <div>
                  <h3 className="font-semibold">Расписание</h3>
                  <p className="text-sm text-muted-foreground">Недельный вид</p>
                </div>
                <ArrowRight className="h-5 w-5 ml-auto text-muted-foreground" />
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Возможности
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="text-2xl">📚</div>
              <div>
                <h4 className="font-medium">Уроки с сегментами</h4>
                <p className="text-sm text-muted-foreground">
                  Разбивайте занятия на теорию и практику
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="text-2xl">⏱️</div>
              <div>
                <h4 className="font-medium">Таймер сегментов</h4>
                <p className="text-sm text-muted-foreground">
                  Отслеживайте время каждого сегмента
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="text-2xl">✅</div>
              <div>
                <h4 className="font-medium">Чек-листы</h4>
                <p className="text-sm text-muted-foreground">
                  Добавляйте подзадачи к урокам
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50">
              <div className="text-2xl">📋</div>
              <div>
                <h4 className="font-medium">Копирование планов</h4>
                <p className="text-sm text-muted-foreground">
                  Копируйте план с предыдущего дня
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Motivational quote */}
      <Card className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 border-purple-200 dark:border-purple-800">
        <CardContent className="p-6 text-center">
          <blockquote className="text-lg font-medium text-purple-900 dark:text-purple-100 mb-2">
            &ldquo;Планирование — это приведение будущего в настоящее, чтобы вы могли что-то с этим сделать сейчас.&rdquo;
          </blockquote>
          <p className="text-sm text-purple-600 dark:text-purple-400">— Алан Лейкен</p>
        </CardContent>
      </Card>
    </div>
  )
}

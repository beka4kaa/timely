"use client"

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
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
import { Progress } from '@/components/ui/progress'
import { 
  Plus, 
  Heart, 
  Brain,
  Target,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Lightbulb,
  Shield,
  Compass,
  Flame,
  Eye,
  BookOpen,
  MessageCircle,
  Users,
  Briefcase,
  User,
  DollarSign,
  Smile,
  Meh,
  Frown
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Insecurity {
  id: string
  title: string
  description: string
  category: 'social' | 'professional' | 'personal' | 'physical' | 'financial'
  severity: 'high' | 'medium' | 'low'
  triggers: string[]
  actionPlan: string
  progress: number // 0-100
  createdAt: Date
  lastUpdated: Date
  status: 'active' | 'improving' | 'resolved'
}

interface Reflection {
  id: string
  date: Date
  mood: 'excellent' | 'good' | 'neutral' | 'bad' | 'terrible'
  achievements: string
  challenges: string
  lessons: string
  gratitude: string
  tomorrowGoals: string
  emotionalState: string
  energyLevel: number // 1-10
  productivityLevel: number // 1-10
}

interface GrowthArea {
  id: string
  title: string
  description: string
  currentLevel: number // 1-10
  targetLevel: number // 1-10
  skills: string[]
  resources: string[]
  milestones: { text: string; completed: boolean }[]
  createdAt: Date
}

const INSECURITY_CATEGORIES = {
  social: { label: 'Социальные', icon: Users, color: 'bg-blue-100 text-blue-800' },
  professional: { label: 'Профессиональные', icon: Briefcase, color: 'bg-purple-100 text-purple-800' },
  personal: { label: 'Личностные', icon: Brain, color: 'bg-green-100 text-green-800' },
  physical: { label: 'Внешность', icon: User, color: 'bg-orange-100 text-orange-800' },
  financial: { label: 'Финансовые', icon: DollarSign, color: 'bg-yellow-100 text-yellow-800' },
}

const SEVERITY_LEVELS = {
  high: { label: 'Сильно беспокоит', color: 'bg-red-100 text-red-800', icon: AlertTriangle },
  medium: { label: 'Умеренно', color: 'bg-yellow-100 text-yellow-800', icon: Eye },
  low: { label: 'Слегка', color: 'bg-green-100 text-green-800', icon: Shield },
}

const MOODS = {
  excellent: { label: 'Отлично', icon: Smile, color: 'bg-green-100 text-green-800' },
  good: { label: 'Хорошо', icon: Smile, color: 'bg-blue-100 text-blue-800' },
  neutral: { label: 'Нормально', icon: Meh, color: 'bg-gray-100 text-gray-800' },
  bad: { label: 'Плохо', icon: Frown, color: 'bg-orange-100 text-orange-800' },
  terrible: { label: 'Ужасно', icon: Frown, color: 'bg-red-100 text-red-800' },
}

export function SelfWorkComponent() {
  const [activeTab, setActiveTab] = useState('insecurities')
  
  // Неуверенности
  const [insecurities, setInsecurities] = useState<Insecurity[]>([
    {
      id: '1',
      title: 'Страх публичных выступлений',
      description: 'Боюсь выступать перед большой аудиторией, начинаю сильно волноваться',
      category: 'social',
      severity: 'high',
      triggers: ['Большая аудитория', 'Незнакомые люди', 'Оценка других'],
      actionPlan: 'Записаться на курсы ораторского мастерства, практиковаться с друзьями',
      progress: 25,
      createdAt: new Date(2024, 8, 1),
      lastUpdated: new Date(),
      status: 'improving'
    }
  ])

  // Рефлексии
  const [reflections, setReflections] = useState<Reflection[]>([
    {
      id: '1',
      date: new Date(),
      mood: 'good',
      achievements: 'Завершил важный проект на работе, выучил новую технологию',
      challenges: 'Было трудно найти баланс между работой и личной жизнью',
      lessons: 'Важно планировать время и не забывать об отдыхе',
      gratitude: 'Благодарен семье за поддержку и пониманию коллег',
      tomorrowGoals: 'Начать читать новую книгу, заняться спортом',
      emotionalState: 'Чувствую удовлетворение от проделанной работы',
      energyLevel: 7,
      productivityLevel: 8
    }
  ])

  // Области роста
  const [growthAreas, setGrowthAreas] = useState<GrowthArea[]>([
    {
      id: '1',
      title: 'Лидерские навыки',
      description: 'Развитие способности управлять командой и принимать решения',
      currentLevel: 4,
      targetLevel: 8,
      skills: ['Коммуникация', 'Мотивация команды', 'Стратегическое мышление'],
      resources: ['Книги по лидерству', 'Онлайн курсы', 'Ментор'],
      milestones: [
        { text: 'Прочитать 3 книги по лидерству', completed: true },
        { text: 'Пройти курс по управлению', completed: false },
        { text: 'Получить ментора', completed: false },
      ],
      createdAt: new Date(2024, 7, 1)
    }
  ])

  const [isInsecurityDialogOpen, setIsInsecurityDialogOpen] = useState(false)
  const [isReflectionDialogOpen, setIsReflectionDialogOpen] = useState(false)
  const [isGrowthDialogOpen, setIsGrowthDialogOpen] = useState(false)

  // Формы
  const [newInsecurity, setNewInsecurity] = useState({
    title: '',
    description: '',
    category: 'personal' as Insecurity['category'],
    severity: 'medium' as Insecurity['severity'],
    triggers: '',
    actionPlan: ''
  })

  const [newReflection, setNewReflection] = useState({
    mood: 'neutral' as Reflection['mood'],
    achievements: '',
    challenges: '',
    lessons: '',
    gratitude: '',
    tomorrowGoals: '',
    emotionalState: '',
    energyLevel: 5,
    productivityLevel: 5
  })

  const [newGrowthArea, setNewGrowthArea] = useState({
    title: '',
    description: '',
    currentLevel: 1,
    targetLevel: 10,
    skills: '',
    resources: '',
    milestones: ''
  })

  // Добавление неуверенности
  const addInsecurity = () => {
    if (!newInsecurity.title.trim()) return

    const insecurity: Insecurity = {
      id: Date.now().toString(),
      title: newInsecurity.title,
      description: newInsecurity.description,
      category: newInsecurity.category,
      severity: newInsecurity.severity,
      triggers: newInsecurity.triggers.split(',').map(t => t.trim()).filter(t => t),
      actionPlan: newInsecurity.actionPlan,
      progress: 0,
      createdAt: new Date(),
      lastUpdated: new Date(),
      status: 'active'
    }

    setInsecurities(prev => [insecurity, ...prev])
    setNewInsecurity({
      title: '',
      description: '',
      category: 'personal',
      severity: 'medium',
      triggers: '',
      actionPlan: ''
    })
    setIsInsecurityDialogOpen(false)
  }

  // Добавление рефлексии
  const addReflection = () => {
    const reflection: Reflection = {
      id: Date.now().toString(),
      date: new Date(),
      mood: newReflection.mood,
      achievements: newReflection.achievements,
      challenges: newReflection.challenges,
      lessons: newReflection.lessons,
      gratitude: newReflection.gratitude,
      tomorrowGoals: newReflection.tomorrowGoals,
      emotionalState: newReflection.emotionalState,
      energyLevel: newReflection.energyLevel,
      productivityLevel: newReflection.productivityLevel
    }

    setReflections(prev => [reflection, ...prev])
    setNewReflection({
      mood: 'neutral',
      achievements: '',
      challenges: '',
      lessons: '',
      gratitude: '',
      tomorrowGoals: '',
      emotionalState: '',
      energyLevel: 5,
      productivityLevel: 5
    })
    setIsReflectionDialogOpen(false)
  }

  // Добавление области роста
  const addGrowthArea = () => {
    if (!newGrowthArea.title.trim()) return

    const growthArea: GrowthArea = {
      id: Date.now().toString(),
      title: newGrowthArea.title,
      description: newGrowthArea.description,
      currentLevel: newGrowthArea.currentLevel,
      targetLevel: newGrowthArea.targetLevel,
      skills: newGrowthArea.skills.split(',').map(s => s.trim()).filter(s => s),
      resources: newGrowthArea.resources.split(',').map(r => r.trim()).filter(r => r),
      milestones: newGrowthArea.milestones.split('\n').map(m => ({
        text: m.trim(),
        completed: false
      })).filter(m => m.text),
      createdAt: new Date()
    }

    setGrowthAreas(prev => [growthArea, ...prev])
    setNewGrowthArea({
      title: '',
      description: '',
      currentLevel: 1,
      targetLevel: 10,
      skills: '',
      resources: '',
      milestones: ''
    })
    setIsGrowthDialogOpen(false)
  }

  return (
    <div className="space-y-6">
      {/* Заголовок с мотивацией */}
      <Card className="bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200">
        <CardContent className="p-6">
          <div className="flex items-start space-x-4">
            <div className="bg-indigo-100 p-3 rounded-full">
              <Heart className="h-8 w-8 text-indigo-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-indigo-900 mb-2">
                💝 Работа с собой
              </h3>
              <p className="text-indigo-700">
                "Знание себя — начало всей мудрости." — Аристотель
              </p>
              <p className="text-sm text-indigo-600 mt-2">
                Честность с собой — это первый шаг к личностному росту и внутренней гармонии.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="insecurities">🛡️ Неуверенности</TabsTrigger>
          <TabsTrigger value="reflection">📝 Рефлексия</TabsTrigger>
          <TabsTrigger value="growth">📈 Рост</TabsTrigger>
        </TabsList>

        {/* Неуверенности */}
        <TabsContent value="insecurities" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Мои неуверенности и страхи</h3>
              <p className="text-sm text-muted-foreground">
                Определите свои слабые места, чтобы работать над ними
              </p>
            </div>
            
            <Dialog open={isInsecurityDialogOpen} onOpenChange={setIsInsecurityDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Новая неуверенность</DialogTitle>
                  <DialogDescription>
                    Честно опишите то, что вас беспокоит
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4">
                  <Input
                    placeholder="Что вас беспокоит?..."
                    value={newInsecurity.title}
                    onChange={(e) => setNewInsecurity(prev => ({ ...prev, title: e.target.value }))}
                  />
                  
                  <Textarea
                    placeholder="Подробное описание..."
                    value={newInsecurity.description}
                    onChange={(e) => setNewInsecurity(prev => ({ ...prev, description: e.target.value }))}
                  />
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Категория</label>
                      <Select 
                        value={newInsecurity.category} 
                        onValueChange={(value: Insecurity['category']) => 
                          setNewInsecurity(prev => ({ ...prev, category: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(INSECURITY_CATEGORIES).map(([key, category]) => (
                            <SelectItem key={key} value={key}>
                              {React.createElement(category.icon, { className: 'w-4 h-4 mr-1 inline' })}{category.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium mb-2 block">Степень беспокойства</label>
                      <Select 
                        value={newInsecurity.severity} 
                        onValueChange={(value: Insecurity['severity']) => 
                          setNewInsecurity(prev => ({ ...prev, severity: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(SEVERITY_LEVELS).map(([key, level]) => (
                            <SelectItem key={key} value={key}>
                              {level.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium mb-2 block">Триггеры (через запятую)</label>
                    <Input
                      placeholder="Что вызывает эту неуверенность?..."
                      value={newInsecurity.triggers}
                      onChange={(e) => setNewInsecurity(prev => ({ ...prev, triggers: e.target.value }))}
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium mb-2 block">План действий</label>
                    <Textarea
                      placeholder="Как вы планируете работать над этим?..."
                      value={newInsecurity.actionPlan}
                      onChange={(e) => setNewInsecurity(prev => ({ ...prev, actionPlan: e.target.value }))}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsInsecurityDialogOpen(false)}>
                    Отмена
                  </Button>
                  <Button onClick={addInsecurity} disabled={!newInsecurity.title.trim()}>
                    Добавить
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-4">
            {insecurities.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <Shield className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <h3 className="text-lg font-medium mb-2">Пока нет записей</h3>
                  <p className="text-muted-foreground mb-4">
                    Начните честно работать с собой, определив свои неуверенности
                  </p>
                </CardContent>
              </Card>
            ) : (
              insecurities.map(insecurity => {
                const category = INSECURITY_CATEGORIES[insecurity.category]
                const severity = SEVERITY_LEVELS[insecurity.severity]
                const IconComponent = severity.icon
                
                return (
                  <Card key={insecurity.id} className="border-l-4 border-l-orange-400">
                    <CardContent className="p-6">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-start space-x-3">
                          <IconComponent className="h-5 w-5 mt-1 text-orange-600" />
                          <div>
                            <h4 className="font-medium text-lg">{insecurity.title}</h4>
                            <p className="text-sm text-muted-foreground mt-1">
                              {insecurity.description}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex gap-2">
                          <Badge className={category.color}>
                            {React.createElement(category.icon, { className: 'w-4 h-4 mr-1 inline' })}{category.label}
                          </Badge>
                          <Badge className={severity.color}>
                            {severity.label}
                          </Badge>
                        </div>
                      </div>
                      
                      {/* Прогресс работы */}
                      <div className="mb-4">
                        <div className="flex justify-between text-sm mb-2">
                          <span>Прогресс работы над проблемой</span>
                          <span className="font-medium">{insecurity.progress}%</span>
                        </div>
                        <Progress value={insecurity.progress} className="h-2" />
                      </div>
                      
                      {/* Триггеры */}
                      {insecurity.triggers.length > 0 && (
                        <div className="mb-4">
                          <h5 className="text-sm font-medium mb-2">Триггеры:</h5>
                          <div className="flex flex-wrap gap-1">
                            {insecurity.triggers.map(trigger => (
                              <Badge key={trigger} variant="outline" className="text-xs">
                                {trigger}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {/* План действий */}
                      {insecurity.actionPlan && (
                        <div className="bg-blue-50 p-3 rounded-lg">
                          <h5 className="text-sm font-medium mb-1 flex items-center">
                            <Lightbulb className="h-4 w-4 mr-1 text-blue-600" />
                            План действий
                          </h5>
                          <p className="text-sm text-blue-800">{insecurity.actionPlan}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        </TabsContent>

        {/* Рефлексия */}
        <TabsContent value="reflection" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Ежедневная рефлексия</h3>
              <p className="text-sm text-muted-foreground">
                Анализируйте свой день для лучшего понимания себя
              </p>
            </div>
            
            <Dialog open={isReflectionDialogOpen} onOpenChange={setIsReflectionDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Новая рефлексия
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Рефлексия дня</DialogTitle>
                  <DialogDescription>
                    Проанализируйте свой день честно и подробно
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium mb-2 block">Настроение</label>
                    <Select 
                      value={newReflection.mood} 
                      onValueChange={(value: Reflection['mood']) => 
                        setNewReflection(prev => ({ ...prev, mood: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(MOODS).map(([key, mood]) => (
                          <SelectItem key={key} value={key}>
                            {React.createElement(mood.icon, { className: 'w-4 h-4 mr-1 inline' })}{mood.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Уровень энергии (1-10)</label>
                      <Input
                        type="number"
                        min="1"
                        max="10"
                        value={newReflection.energyLevel}
                        onChange={(e) => setNewReflection(prev => ({ 
                          ...prev, 
                          energyLevel: parseInt(e.target.value) || 1 
                        }))}
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium mb-2 block">Продуктивность (1-10)</label>
                      <Input
                        type="number"
                        min="1"
                        max="10"
                        value={newReflection.productivityLevel}
                        onChange={(e) => setNewReflection(prev => ({ 
                          ...prev, 
                          productivityLevel: parseInt(e.target.value) || 1 
                        }))}
                      />
                    </div>
                  </div>
                  
                  <Textarea
                    placeholder="Чего я достиг сегодня?..."
                    value={newReflection.achievements}
                    onChange={(e) => setNewReflection(prev => ({ ...prev, achievements: e.target.value }))}
                  />
                  
                  <Textarea
                    placeholder="С какими вызовами я столкнулся?..."
                    value={newReflection.challenges}
                    onChange={(e) => setNewReflection(prev => ({ ...prev, challenges: e.target.value }))}
                  />
                  
                  <Textarea
                    placeholder="Какие уроки я извлек?..."
                    value={newReflection.lessons}
                    onChange={(e) => setNewReflection(prev => ({ ...prev, lessons: e.target.value }))}
                  />
                  
                  <Textarea
                    placeholder="За что я благодарен?..."
                    value={newReflection.gratitude}
                    onChange={(e) => setNewReflection(prev => ({ ...prev, gratitude: e.target.value }))}
                  />
                  
                  <Textarea
                    placeholder="Что планирую на завтра?..."
                    value={newReflection.tomorrowGoals}
                    onChange={(e) => setNewReflection(prev => ({ ...prev, tomorrowGoals: e.target.value }))}
                  />
                  
                  <Textarea
                    placeholder="Мое эмоциональное состояние..."
                    value={newReflection.emotionalState}
                    onChange={(e) => setNewReflection(prev => ({ ...prev, emotionalState: e.target.value }))}
                  />
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsReflectionDialogOpen(false)}>
                    Отмена
                  </Button>
                  <Button onClick={addReflection}>
                    Сохранить рефлексию
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-4">
            {reflections.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <BookOpen className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <h3 className="text-lg font-medium mb-2">Начните рефлексировать</h3>
                  <p className="text-muted-foreground mb-4">
                    Ежедневная рефлексия поможет лучше понять себя и свой прогресс
                  </p>
                </CardContent>
              </Card>
            ) : (
              reflections.map(reflection => {
                const mood = MOODS[reflection.mood]
                
                return (
                  <Card key={reflection.id}>
                    <CardHeader>
                      <CardTitle className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Calendar className="h-5 w-5" />
                          <span>{reflection.date.toLocaleDateString('ru-RU')}</span>
                        </div>
                        <Badge className={mood.color}>
                          {React.createElement(mood.icon, { className: 'w-4 h-4 mr-1 inline' })}{mood.label}
                        </Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <span className="text-sm font-medium">Энергия: </span>
                          <Badge variant="outline">{reflection.energyLevel}/10</Badge>
                        </div>
                        <div>
                          <span className="text-sm font-medium">Продуктивность: </span>
                          <Badge variant="outline">{reflection.productivityLevel}/10</Badge>
                        </div>
                      </div>
                      
                      {reflection.achievements && (
                        <div>
                          <h5 className="font-medium text-sm mb-1 text-green-700">✅ Достижения</h5>
                          <p className="text-sm">{reflection.achievements}</p>
                        </div>
                      )}
                      
                      {reflection.challenges && (
                        <div>
                          <h5 className="font-medium text-sm mb-1 text-orange-700">⚠️ Вызовы</h5>
                          <p className="text-sm">{reflection.challenges}</p>
                        </div>
                      )}
                      
                      {reflection.lessons && (
                        <div>
                          <h5 className="font-medium text-sm mb-1 text-blue-700">💡 Уроки</h5>
                          <p className="text-sm">{reflection.lessons}</p>
                        </div>
                      )}
                      
                      {reflection.gratitude && (
                        <div>
                          <h5 className="font-medium text-sm mb-1 text-pink-700">🙏 Благодарность</h5>
                          <p className="text-sm">{reflection.gratitude}</p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        </TabsContent>

        {/* Личностный рост */}
        <TabsContent value="growth" className="space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-medium">Области для развития</h3>
              <p className="text-sm text-muted-foreground">
                Определите навыки и качества, которые хотите развить
              </p>
            </div>
            
            <Dialog open={isGrowthDialogOpen} onOpenChange={setIsGrowthDialogOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить область
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Новая область развития</DialogTitle>
                  <DialogDescription>
                    Определите навык или качество для развития
                  </DialogDescription>
                </DialogHeader>
                
                <div className="space-y-4">
                  <Input
                    placeholder="Что хотите развить?..."
                    value={newGrowthArea.title}
                    onChange={(e) => setNewGrowthArea(prev => ({ ...prev, title: e.target.value }))}
                  />
                  
                  <Textarea
                    placeholder="Описание и важность для вас..."
                    value={newGrowthArea.description}
                    onChange={(e) => setNewGrowthArea(prev => ({ ...prev, description: e.target.value }))}
                  />
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium mb-2 block">Текущий уровень (1-10)</label>
                      <Input
                        type="number"
                        min="1"
                        max="10"
                        value={newGrowthArea.currentLevel}
                        onChange={(e) => setNewGrowthArea(prev => ({ 
                          ...prev, 
                          currentLevel: parseInt(e.target.value) || 1 
                        }))}
                      />
                    </div>
                    
                    <div>
                      <label className="text-sm font-medium mb-2 block">Целевой уровень (1-10)</label>
                      <Input
                        type="number"
                        min="1"
                        max="10"
                        value={newGrowthArea.targetLevel}
                        onChange={(e) => setNewGrowthArea(prev => ({ 
                          ...prev, 
                          targetLevel: parseInt(e.target.value) || 10 
                        }))}
                      />
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium mb-2 block">Конкретные навыки (через запятую)</label>
                    <Input
                      placeholder="коммуникация, эмпатия, лидерство..."
                      value={newGrowthArea.skills}
                      onChange={(e) => setNewGrowthArea(prev => ({ ...prev, skills: e.target.value }))}
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium mb-2 block">Ресурсы для изучения (через запятую)</label>
                    <Input
                      placeholder="книги, курсы, менторы..."
                      value={newGrowthArea.resources}
                      onChange={(e) => setNewGrowthArea(prev => ({ ...prev, resources: e.target.value }))}
                    />
                  </div>
                  
                  <div>
                    <label className="text-sm font-medium mb-2 block">Этапы развития (каждый с новой строки)</label>
                    <Textarea
                      placeholder="Прочитать книгу по теме&#10;Пройти онлайн курс&#10;Применить на практике"
                      value={newGrowthArea.milestones}
                      onChange={(e) => setNewGrowthArea(prev => ({ ...prev, milestones: e.target.value }))}
                    />
                  </div>
                </div>

                <DialogFooter>
                  <Button variant="outline" onClick={() => setIsGrowthDialogOpen(false)}>
                    Отмена
                  </Button>
                  <Button onClick={addGrowthArea} disabled={!newGrowthArea.title.trim()}>
                    Добавить область
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          <div className="space-y-4">
            {growthAreas.length === 0 ? (
              <Card>
                <CardContent className="p-8 text-center">
                  <TrendingUp className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
                  <h3 className="text-lg font-medium mb-2">Начните развиваться</h3>
                  <p className="text-muted-foreground mb-4">
                    Определите области, в которых хотите стать лучше
                  </p>
                </CardContent>
              </Card>
            ) : (
              growthAreas.map(area => (
                <Card key={area.id} className="border-l-4 border-l-green-400">
                  <CardContent className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h4 className="font-medium text-lg flex items-center">
                          <TrendingUp className="h-5 w-5 mr-2 text-green-600" />
                          {area.title}
                        </h4>
                        <p className="text-sm text-muted-foreground mt-1">
                          {area.description}
                        </p>
                      </div>
                      
                      <div className="text-right">
                        <div className="text-sm font-medium">
                          {area.currentLevel}/{area.targetLevel}
                        </div>
                        <Progress 
                          value={(area.currentLevel / area.targetLevel) * 100} 
                          className="h-2 w-24" 
                        />
                      </div>
                    </div>
                    
                    {/* Навыки */}
                    {area.skills.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium mb-2">Навыки для развития:</h5>
                        <div className="flex flex-wrap gap-1">
                          {area.skills.map(skill => (
                            <Badge key={skill} className="bg-green-100 text-green-800">
                              {skill}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Ресурсы */}
                    {area.resources.length > 0 && (
                      <div className="mb-4">
                        <h5 className="text-sm font-medium mb-2">Ресурсы:</h5>
                        <div className="flex flex-wrap gap-1">
                          {area.resources.map(resource => (
                            <Badge key={resource} variant="outline">
                              {resource}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {/* Этапы */}
                    {area.milestones.length > 0 && (
                      <div>
                        <h5 className="text-sm font-medium mb-2 flex items-center">
                          <Target className="h-4 w-4 mr-1" />
                          Этапы развития:
                        </h5>
                        <div className="space-y-2">
                          {area.milestones.map((milestone, index) => (
                            <div key={index} className="flex items-center space-x-2">
                              {milestone.completed ? (
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                              ) : (
                                <div className="h-4 w-4 rounded-full border-2 border-gray-300" />
                              )}
                              <span className={cn(
                                "text-sm",
                                milestone.completed && "line-through text-muted-foreground"
                              )}>
                                {milestone.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
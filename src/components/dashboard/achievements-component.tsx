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
import { 
  Plus, 
  Trophy, 
  Award,
  Star,
  Calendar,
  Briefcase,
  GraduationCap,
  Dumbbell,
  DollarSign,
  Palette,
  Users,
  Heart,
  Medal,
  Crown,
  Zap,
  Sparkles,
  Target
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Achievement {
  id: string
  title: string
  description: string
  category: 'professional' | 'educational' | 'health' | 'personal' | 'creative' | 'financial'
  importance: 'high' | 'medium' | 'low'
  date: Date
  tags: string[]
  imageUrl?: string
  feeling?: string // как чувствовал себя при достижении
  impact?: string // как это повлияло на жизнь
}

const CATEGORIES = {
  professional: { 
    label: 'Профессиональные', 
    icon: Briefcase,
    color: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900 dark:text-blue-300 dark:border-blue-800',
    description: 'Карьерные достижения и рабочие успехи'
  },
  educational: { 
    label: 'Образовательные', 
    icon: GraduationCap,
    color: 'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900 dark:text-indigo-300 dark:border-indigo-800',
    description: 'Обучение, сертификаты, новые знания'
  },
  health: { 
    label: 'Здоровье и спорт', 
    icon: Dumbbell,
    color: 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900 dark:text-green-300 dark:border-green-800',
    description: 'Спортивные достижения, здоровый образ жизни'
  },
  personal: { 
    label: 'Личные достижения', 
    icon: Star,
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200 dark:bg-yellow-900 dark:text-yellow-300 dark:border-yellow-800',
    description: 'Личностный рост, преодоление страхов'
  },
  creative: { 
    label: 'Творчество', 
    icon: Palette,
    color: 'bg-pink-100 text-pink-800 border-pink-200 dark:bg-pink-900 dark:text-pink-300 dark:border-pink-800',
    description: 'Творческие проекты, искусство, хобби'
  },
  financial: { 
    label: 'Финансовые', 
    icon: DollarSign,
    color: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900 dark:text-emerald-300 dark:border-emerald-800',
    description: 'Финансовые цели, инвестиции, накопления'
  },
}

const IMPORTANCE_LEVELS = {
  high: { label: 'Очень важно', color: 'bg-red-100 text-red-800', icon: Crown },
  medium: { label: 'Важно', color: 'bg-orange-100 text-orange-800', icon: Medal },
  low: { label: 'Приятно', color: 'bg-gray-100 text-gray-800', icon: Star },
}

const MOTIVATIONAL_QUOTES = [
  "Каждое достижение начинается с решения попробовать.",
  "Успех — это сумма небольших усилий, повторяемых изо дня в день.",
  "Не бойтесь идти медленно, бойтесь остановиться.",
  "Ваши достижения — это результат ваших решений.",
  "Гордитесь каждым шагом на пути к своим целям."
]

export function AchievementsComponent() {
  const [achievements, setAchievements] = useState<Achievement[]>([
    {
      id: '1',
      title: 'Получил повышение на работе',
      description: 'Стал senior разработчиком после 2 лет работы junior-ом',
      category: 'professional',
      importance: 'high',
      date: new Date(2024, 8, 15), // 15 сентября
      tags: ['карьера', 'разработка', 'рост'],
      feeling: 'Чувствую гордость и уверенность в своих силах',
      impact: 'Повысилась самооценка, появилось больше ответственности'
    },
    {
      id: '2',
      title: 'Пробежал первый полумарафон',
      description: 'Преодолел дистанцию 21 км за 2 часа 15 минут',
      category: 'health',
      importance: 'high',
      date: new Date(2024, 7, 20), // 20 августа
      tags: ['спорт', 'бег', 'выносливость'],
      feeling: 'Невероятная эйфория и чувство собственной силы',
      impact: 'Понял, что могу достичь любых целей с упорством'
    },
    {
      id: '3',
      title: 'Завершил курс по React',
      description: 'Изучил современную разработку фронтенда за 3 месяца',
      category: 'educational',
      importance: 'medium',
      date: new Date(2024, 6, 10), // 10 июля
      tags: ['программирование', 'react', 'frontend'],
      feeling: 'Удовлетворение от новых знаний и навыков',
      impact: 'Открылись новые возможности в карьере'
    },
    {
      id: '4',
      title: 'Создал свой первый сайт',
      description: 'Запустил личный портфолио сайт с нуля',
      category: 'creative',
      importance: 'medium',
      date: new Date(2024, 5, 25), // 25 июня
      tags: ['веб-разработка', 'дизайн', 'портфолио'],
      feeling: 'Восторг от создания чего-то своего',
      impact: 'Появилась уверенность в технических способностях'
    }
  ])

  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false)
  const [randomQuote] = useState(MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)])
  
  const [newAchievement, setNewAchievement] = useState({
    title: '',
    description: '',
    category: 'personal' as Achievement['category'],
    importance: 'medium' as Achievement['importance'],
    date: new Date().toISOString().split('T')[0],
    tags: '',
    feeling: '',
    impact: ''
  })

  // Фильтрация достижений
  const filteredAchievements = achievements.filter(achievement => 
    selectedCategory === 'all' || achievement.category === selectedCategory
  )

  // Статистика
  const stats = {
    total: achievements.length,
    thisMonth: achievements.filter(a => {
      const now = new Date()
      const achievementDate = new Date(a.date)
      return achievementDate.getMonth() === now.getMonth() && 
             achievementDate.getFullYear() === now.getFullYear()
    }).length,
    highImportance: achievements.filter(a => a.importance === 'high').length,
    categories: Object.keys(CATEGORIES).length
  }

  // Добавление достижения
  const addAchievement = () => {
    if (!newAchievement.title.trim()) return

    const achievement: Achievement = {
      id: Date.now().toString(),
      title: newAchievement.title,
      description: newAchievement.description,
      category: newAchievement.category,
      importance: newAchievement.importance,
      date: new Date(newAchievement.date),
      tags: newAchievement.tags.split(',').map(tag => tag.trim()).filter(tag => tag),
      feeling: newAchievement.feeling || undefined,
      impact: newAchievement.impact || undefined
    }

    setAchievements(prev => [achievement, ...prev])
    setNewAchievement({
      title: '',
      description: '',
      category: 'personal',
      importance: 'medium',
      date: new Date().toISOString().split('T')[0],
      tags: '',
      feeling: '',
      impact: ''
    })
    setIsAddDialogOpen(false)
  }

  // Получить случайное достижение для мотивации
  const getRandomAchievement = () => {
    if (achievements.length === 0) return null
    return achievements[Math.floor(Math.random() * achievements.length)]
  }

  const randomAchievement = getRandomAchievement()

  return (
    <div className="space-y-6">
      {/* Мотивационная секция */}
      <Card className="bg-gradient-to-r from-purple-50 to-pink-50 border-purple-200">
        <CardContent className="p-6">
          <div className="flex items-start space-x-4">
            <div className="bg-purple-100 p-3 rounded-full">
              <Sparkles className="h-8 w-8 text-purple-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-purple-900 mb-2 flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-purple-600" />
                Мотивация дня
              </h3>
              <p className="text-purple-700 font-medium mb-3">"{randomQuote}"</p>
              {randomAchievement && (
                <div className="bg-white/70 p-3 rounded-lg">
                  <p className="text-sm text-purple-600 font-medium flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Вспомните: {randomAchievement.title}
                  </p>
                  <p className="text-xs text-purple-500 mt-1">
                    {randomAchievement.date.toLocaleDateString('ru-RU')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Статистика */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-purple-600">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Всего достижений</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-blue-600">{stats.thisMonth}</div>
            <p className="text-xs text-muted-foreground">В этом месяце</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-red-600">{stats.highImportance}</div>
            <p className="text-xs text-muted-foreground">Важных достижений</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-green-600">{stats.categories}</div>
            <p className="text-xs text-muted-foreground">Категорий освоено</p>
          </CardContent>
        </Card>
      </div>

      {/* Фильтры и добавление */}
      <div className="flex justify-between items-center">
        <Tabs value={selectedCategory} onValueChange={setSelectedCategory} className="w-auto">
          <TabsList className="grid w-fit grid-cols-7">
            <TabsTrigger value="all">Все</TabsTrigger>
            {Object.entries(CATEGORIES).map(([key, category]) => (
              <TabsTrigger key={key} value={key} className="text-xs">
                {React.createElement(category.icon, { className: 'w-4 h-4' })}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700">
              <Plus className="h-4 w-4 mr-2" />
              Новое достижение
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center space-x-2">
                <Trophy className="h-5 w-5 text-yellow-500" />
                <span>Добавить достижение</span>
              </DialogTitle>
              <DialogDescription>
                Запишите свой успех, чтобы помнить и гордиться им
              </DialogDescription>
            </DialogHeader>
            
            <div className="space-y-4 max-h-96 overflow-y-auto">
              <div>
                <Input
                  placeholder="Чем вы гордитесь?..."
                  value={newAchievement.title}
                  onChange={(e) => setNewAchievement(prev => ({ ...prev, title: e.target.value }))}
                />
              </div>
              
              <div>
                <Textarea
                  placeholder="Расскажите подробнее о своем достижении..."
                  value={newAchievement.description}
                  onChange={(e) => setNewAchievement(prev => ({ ...prev, description: e.target.value }))}
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">Категория</label>
                  <Select 
                    value={newAchievement.category} 
                    onValueChange={(value: Achievement['category']) => 
                      setNewAchievement(prev => ({ ...prev, category: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CATEGORIES).map(([key, category]) => (
                        <SelectItem key={key} value={key}>
                          {React.createElement(category.icon, { className: "h-4 w-4 inline mr-2" })}{category.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div>
                  <label className="text-sm font-medium mb-2 block">Важность</label>
                  <Select 
                    value={newAchievement.importance} 
                    onValueChange={(value: Achievement['importance']) => 
                      setNewAchievement(prev => ({ ...prev, importance: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(IMPORTANCE_LEVELS).map(([key, level]) => (
                        <SelectItem key={key} value={key}>
                          {level.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Дата достижения</label>
                <Input
                  type="date"
                  value={newAchievement.date}
                  onChange={(e) => setNewAchievement(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Теги (через запятую)</label>
                <Input
                  placeholder="карьера, успех, гордость..."
                  value={newAchievement.tags}
                  onChange={(e) => setNewAchievement(prev => ({ ...prev, tags: e.target.value }))}
                />
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Как вы себя чувствовали?</label>
                <Textarea
                  placeholder="Опишите свои эмоции и чувства..."
                  value={newAchievement.feeling}
                  onChange={(e) => setNewAchievement(prev => ({ ...prev, feeling: e.target.value }))}
                />
              </div>
              
              <div>
                <label className="text-sm font-medium mb-2 block">Как это повлияло на вашу жизнь?</label>
                <Textarea
                  placeholder="Какие изменения это принесло..."
                  value={newAchievement.impact}
                  onChange={(e) => setNewAchievement(prev => ({ ...prev, impact: e.target.value }))}
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                Отмена
              </Button>
              <Button onClick={addAchievement} disabled={!newAchievement.title.trim()}>
                Сохранить достижение
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Список достижений */}
      <div className="grid gap-4">
        {filteredAchievements.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Trophy className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-medium mb-2">Нет достижений</h3>
              <p className="text-muted-foreground mb-4">
                {selectedCategory === 'all' 
                  ? 'Добавьте свое первое достижение и начните коллекцию успехов'
                  : `Нет достижений в категории "${CATEGORIES[selectedCategory as keyof typeof CATEGORIES]?.label}"`
                }
              </p>
              <Button onClick={() => setIsAddDialogOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Добавить достижение
              </Button>
            </CardContent>
          </Card>
        ) : (
          filteredAchievements.map(achievement => {
            const category = CATEGORIES[achievement.category]
            const importance = IMPORTANCE_LEVELS[achievement.importance]
            const IconComponent = category.icon
            
            return (
              <Card key={achievement.id} className={cn(
                "transition-all duration-200 hover:shadow-md",
                category.color,
                "border-l-4"
              )}>
                <CardContent className="p-6">
                  <div className="flex items-start space-x-4">
                    <div className="bg-white p-3 rounded-full">
                      <IconComponent className="h-6 w-6" />
                    </div>
                    
                    <div className="flex-1 space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <h3 className="font-semibold text-lg">{achievement.title}</h3>
                          <p className="text-sm opacity-80 mt-1">{achievement.description}</p>
                        </div>
                        
                        <div className="flex items-center space-x-2">
                          <Badge className={importance.color}>
                            {importance.label}
                          </Badge>
                          <Badge variant="outline">
                            <Calendar className="h-3 w-3 mr-1" />
                            {achievement.date.toLocaleDateString('ru-RU')}
                          </Badge>
                        </div>
                      </div>
                      
                      {/* Теги */}
                      {achievement.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {achievement.tags.map(tag => (
                            <Badge key={tag} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      )}
                      
                      {/* Эмоции и влияние */}
                      <div className="grid md:grid-cols-2 gap-4 mt-4">
                        {achievement.feeling && (
                          <div className="bg-white/70 p-3 rounded-lg">
                            <h4 className="text-sm font-medium mb-1 flex items-center">
                              <Heart className="h-4 w-4 mr-1 text-red-500" />
                              Ощущения
                            </h4>
                            <p className="text-sm opacity-80">{achievement.feeling}</p>
                          </div>
                        )}
                        
                        {achievement.impact && (
                          <div className="bg-white/70 p-3 rounded-lg">
                            <h4 className="text-sm font-medium mb-1 flex items-center">
                              <Zap className="h-4 w-4 mr-1 text-yellow-500" />
                              Влияние
                            </h4>
                            <p className="text-sm opacity-80">{achievement.impact}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
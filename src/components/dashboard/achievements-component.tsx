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
    color: 'bg-[#edf1f2] text-[#516a70] border-[#c9d8da]',
    description: 'Карьерные достижения и рабочие успехи'
  },
  educational: { 
    label: 'Образовательные', 
    icon: GraduationCap,
    color: 'bg-[#eeeaf2] text-[#675e73] border-[#d5cddd]',
    description: 'Обучение, сертификаты, новые знания'
  },
  health: { 
    label: 'Здоровье и спорт', 
    icon: Dumbbell,
    color: 'bg-[#eaf1e9] text-[#58705b] border-[#ccdbca]',
    description: 'Спортивные достижения, здоровый образ жизни'
  },
  personal: { 
    label: 'Личные достижения', 
    icon: Star,
    color: 'bg-[#f7eedc] text-[#856432] border-[#e2cfaa]',
    description: 'Личностный рост, преодоление страхов'
  },
  creative: { 
    label: 'Творчество', 
    icon: Palette,
    color: 'bg-[#f4e9e7] text-[#825f58] border-[#dfccc8]',
    description: 'Творческие проекты, искусство, хобби'
  },
  financial: { 
    label: 'Финансовые', 
    icon: DollarSign,
    color: 'bg-[#e8f0eb] text-[#52705d] border-[#c9d9cf]',
    description: 'Финансовые цели, инвестиции, накопления'
  },
}

const IMPORTANCE_LEVELS = {
  high: { label: 'Очень важно', color: 'bg-[#f4e2dc] text-[#8b4d42]', icon: Crown },
  medium: { label: 'Важно', color: 'bg-[#f5e9d5] text-[#855e2f]', icon: Medal },
  low: { label: 'Приятно', color: 'bg-[#ebe8e2] text-[#6e675f]', icon: Star },
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
    <div className="space-y-5 text-[#39332e]">
      {/* Мотивационная секция */}
      <Card className="overflow-hidden rounded-[20px] border-[#ddc8a7] bg-gradient-to-r from-[#f2e5d1] via-[#faf4ea] to-[#f4eadc] shadow-[0_12px_40px_rgba(78,57,31,0.06)]">
        <CardContent className="p-6">
          <div className="flex items-start space-x-4">
            <div className="rounded-[15px] border border-[#ddc39c] bg-[#fff8eb] p-3">
              <Sparkles className="h-7 w-7 text-[#9a6730]" />
            </div>
            <div className="flex-1">
              <h3 className="mb-2 flex items-center gap-2 font-serif text-lg font-medium text-[#493b2e]">
                Мотивация дня
              </h3>
              <p className="mb-3 text-[13px] font-medium leading-6 text-[#725b43]">&ldquo;{randomQuote}&rdquo;</p>
              {randomAchievement && (
                <div className="rounded-[13px] border border-white/80 bg-white/60 p-3">
                  <p className="flex items-center gap-2 text-[12px] font-medium text-[#865c31]">
                    <Target className="h-4 w-4" />
                    Вспомните: {randomAchievement.title}
                  </p>
                  <p className="mt-1 text-[10px] text-[#a18668]">
                    {randomAchievement.date.toLocaleDateString('ru-RU')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Статистика */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="rounded-[17px] border-[#ded7cd] bg-[#fbfaf7] shadow-[0_8px_28px_rgba(65,49,31,0.04)]">
          <CardContent className="p-4">
            <div className="font-serif text-2xl font-medium text-[#8a5b2b]">{stats.total}</div>
            <p className="text-[10px] text-[#8e857b]">Всего достижений</p>
          </CardContent>
        </Card>
        <Card className="rounded-[17px] border-[#ded7cd] bg-[#fbfaf7] shadow-[0_8px_28px_rgba(65,49,31,0.04)]">
          <CardContent className="p-4">
            <div className="font-serif text-2xl font-medium text-[#60747a]">{stats.thisMonth}</div>
            <p className="text-[10px] text-[#8e857b]">В этом месяце</p>
          </CardContent>
        </Card>
        <Card className="rounded-[17px] border-[#ded7cd] bg-[#fbfaf7] shadow-[0_8px_28px_rgba(65,49,31,0.04)]">
          <CardContent className="p-4">
            <div className="font-serif text-2xl font-medium text-[#9a5549]">{stats.highImportance}</div>
            <p className="text-[10px] text-[#8e857b]">Важных достижений</p>
          </CardContent>
        </Card>
        <Card className="rounded-[17px] border-[#ded7cd] bg-[#fbfaf7] shadow-[0_8px_28px_rgba(65,49,31,0.04)]">
          <CardContent className="p-4">
            <div className="font-serif text-2xl font-medium text-[#55705c]">{stats.categories}</div>
            <p className="text-[10px] text-[#8e857b]">Категорий освоено</p>
          </CardContent>
        </Card>
      </div>

      {/* Фильтры и добавление */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <Tabs value={selectedCategory} onValueChange={setSelectedCategory} className="w-auto">
          <TabsList className="grid w-fit grid-cols-7 rounded-full border border-[#ded7cd] bg-[#eee9e1] p-1">
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
            <Button className="rounded-full bg-[#8a5b2b] px-4 text-white hover:bg-[#72471f]">
              <Plus className="h-4 w-4 mr-2" />
              Новое достижение
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl rounded-[22px] border-[#d9d1c5] bg-[#fbfaf7] text-[#39332e] shadow-[0_24px_75px_rgba(61,46,29,0.18)]">
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
      <div className="grid gap-3">
        {filteredAchievements.length === 0 ? (
          <Card className="rounded-[20px] border-[#ded7cd] bg-[#fbfaf7]">
            <CardContent className="p-8 text-center">
              <Trophy className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="text-lg font-medium mb-2">Нет достижений</h3>
              <p className="text-muted-foreground mb-4">
                {selectedCategory === 'all' 
                  ? 'Добавьте свое первое достижение и начните коллекцию успехов'
                  : `Нет достижений в категории "${CATEGORIES[selectedCategory as keyof typeof CATEGORIES]?.label}"`
                }
              </p>
              <Button
                onClick={() => setIsAddDialogOpen(true)}
                className="rounded-full bg-[#8a5b2b] text-white hover:bg-[#72471f]"
              >
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
                "overflow-hidden rounded-[20px] shadow-[0_10px_34px_rgba(65,49,31,0.05)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_16px_42px_rgba(65,49,31,0.08)]",
                category.color,
                "border-l-4"
              )}>
                <CardContent className="p-6">
                  <div className="flex items-start space-x-4">
                    <div className="rounded-[14px] border border-white/80 bg-white/80 p-3 shadow-sm">
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
                          <div className="rounded-[13px] border border-white/80 bg-white/65 p-3">
                            <h4 className="text-sm font-medium mb-1 flex items-center">
                              <Heart className="h-4 w-4 mr-1 text-red-500" />
                              Ощущения
                            </h4>
                            <p className="text-sm opacity-80">{achievement.feeling}</p>
                          </div>
                        )}
                        
                        {achievement.impact && (
                          <div className="rounded-[13px] border border-white/80 bg-white/65 p-3">
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

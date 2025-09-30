"use client"

import React, { useState, useEffect } from 'react'
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
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Calendar as CalendarIcon,
  Clock,
  MapPin,
  Users,
  Bell,
  Edit3,
  Trash2,
  Eye,
  Grid,
  List,
  Search,
  Filter
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { format, addDays, startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, addWeeks, subWeeks, addMonths, subMonths, startOfMonth, endOfMonth, isSameMonth } from 'date-fns'
import { ru } from 'date-fns/locale'

interface CalendarEvent {
  id: string
  title: string
  description?: string
  date: Date
  startTime: string
  endTime: string
  type: 'work' | 'meeting' | 'personal' | 'reminder' | 'goal'
  priority: 'high' | 'medium' | 'low'
  location?: string
  attendees?: string[]
  recurring?: 'none' | 'daily' | 'weekly' | 'monthly'
  reminders?: number[] // minutes before event
  color?: string
  isAllDay?: boolean
  userId?: string
}

const EVENT_TYPES = {
  work: { label: 'Работа', color: 'bg-blue-500', textColor: 'text-blue-700' },
  meeting: { label: 'Встреча', color: 'bg-purple-500', textColor: 'text-purple-700' },
  personal: { label: 'Личное', color: 'bg-green-500', textColor: 'text-green-700' },
  reminder: { label: 'Напоминание', color: 'bg-yellow-500', textColor: 'text-yellow-700' },
  goal: { label: 'Цель', color: 'bg-red-500', textColor: 'text-red-700' }
}

const PRIORITY_LEVELS = {
  high: { label: 'Высокий', color: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300' },
  medium: { label: 'Средний', color: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300' },
  low: { label: 'Низкий', color: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300' }
}

const TIME_SLOTS = Array.from({ length: 24 }, (_, i) => 
  `${i.toString().padStart(2, '0')}:00`
)

export function EnhancedCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month')
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [isLoadingEvents, setIsLoadingEvents] = useState(true)

  const [isAddEventOpen, setIsAddEventOpen] = useState(false)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterType, setFilterType] = useState<string>('all')

  const [newEvent, setNewEvent] = useState<Partial<CalendarEvent>>({
    title: '',
    description: '',
    date: new Date(),
    startTime: '09:00',
    endTime: '10:00',
    type: 'work',
    priority: 'medium',
    location: '',
    recurring: 'none',
    isAllDay: false
  })

  // Get events for a specific date
  const getEventsForDate = (date: Date) => {
    return events.filter(event => isSameDay(event.date, date))
  }

  // Get filtered events based on search and filter
  const getFilteredEvents = () => {
    let filteredEvents = events

    if (searchTerm) {
      filteredEvents = filteredEvents.filter(event =>
        event.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        event.description?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }

    if (filterType !== 'all') {
      filteredEvents = filteredEvents.filter(event => event.type === filterType)
    }

    return filteredEvents
  }

  // Navigation functions
  const navigatePrevious = () => {
    switch (viewMode) {
      case 'month':
        setCurrentDate(subMonths(currentDate, 1))
        break
      case 'week':
        setCurrentDate(subWeeks(currentDate, 1))
        break
      case 'day':
        setCurrentDate(addDays(currentDate, -1))
        break
    }
  }

  const navigateNext = () => {
    switch (viewMode) {
      case 'month':
        setCurrentDate(addMonths(currentDate, 1))
        break
      case 'week':
        setCurrentDate(addWeeks(currentDate, 1))
        break
      case 'day':
        setCurrentDate(addDays(currentDate, 1))
        break
    }
  }

  // Load events from API
  const loadEvents = async () => {
    try {
      setIsLoadingEvents(true)
      const response = await fetch('/api/events')
      if (response.ok) {
        const data = await response.json()
        const eventsWithDates = data.events.map((event: any) => ({
          ...event,
          date: new Date(event.date)
        }))
        setEvents(eventsWithDates)
      }
    } catch (error) {
      console.error('Ошибка при загрузке событий:', error)
    } finally {
      setIsLoadingEvents(false)
    }
  }

  // Load events on mount
  useEffect(() => {
    loadEvents()
  }, [])

  // Add new event
  const addEvent = async () => {
    if (!newEvent.title?.trim()) return

    try {
      const eventData = {
        title: newEvent.title,
        description: newEvent.description || '',
        date: newEvent.date?.toISOString() || new Date().toISOString(),
        startTime: newEvent.startTime || '09:00',
        endTime: newEvent.endTime || '10:00',
        type: newEvent.type || 'work',
        priority: newEvent.priority || 'medium',
        location: newEvent.location || '',
        recurring: newEvent.recurring || 'none',
        isAllDay: newEvent.isAllDay || false
      }

      const response = await fetch('/api/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(eventData),
      })

      if (response.ok) {
        const data = await response.json()
        const eventWithDate = {
          ...data.event,
          date: new Date(data.event.date)
        }
        setEvents(prev => [...prev, eventWithDate])
        setNewEvent({
          title: '',
          description: '',
          date: new Date(),
          startTime: '09:00',
          endTime: '10:00',
          type: 'work',
          priority: 'medium',
          location: '',
          recurring: 'none',
          isAllDay: false
        })
        setIsAddEventOpen(false)
      }
    } catch (error) {
      console.error('Ошибка при создании события:', error)
    }
  }

  // Delete event
  const deleteEvent = async (eventId: string) => {
    try {
      const response = await fetch(`/api/events/${eventId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        setEvents(prev => prev.filter(event => event.id !== eventId))
        setSelectedEvent(null)
      }
    } catch (error) {
      console.error('Ошибка при удалении события:', error)
    }
  }

  // Render calendar grid for month view
  const renderMonthView = () => {
    const monthStart = startOfMonth(currentDate)
    const monthEnd = endOfMonth(currentDate)
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 1 })
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })
    
    const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd })

    return (
      <div className="grid grid-cols-7 gap-1">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(day => (
          <div key={day} className="p-2 text-center font-semibold text-sm text-muted-foreground">
            {day}
          </div>
        ))}
        {calendarDays.map(day => {
          const dayEvents = getEventsForDate(day)
          const isCurrentMonth = isSameMonth(day, currentDate)
          const isToday = isSameDay(day, new Date())
          const isSelected = selectedDate && isSameDay(day, selectedDate)

          return (
            <div
              key={day.toISOString()}
              className={cn(
                "min-h-24 p-1 border border-border cursor-pointer hover:bg-muted/50 transition-colors",
                !isCurrentMonth && "text-muted-foreground bg-muted/20",
                isToday && "bg-blue-50 border-blue-200 dark:bg-blue-900/20",
                isSelected && "bg-blue-100 border-blue-300 dark:bg-blue-800/30"
              )}
              onClick={() => setSelectedDate(day)}
            >
              <div className="flex justify-between items-start mb-1">
                <span className={cn(
                  "text-sm font-medium",
                  isToday && "text-blue-600 dark:text-blue-400"
                )}>
                  {format(day, 'd')}
                </span>
                {dayEvents.length > 0 && (
                  <Badge variant="secondary" className="text-xs px-1 py-0">
                    {dayEvents.length}
                  </Badge>
                )}
              </div>
              <div className="space-y-1">
                {dayEvents.slice(0, 2).map(event => (
                  <div
                    key={event.id}
                    className={cn(
                      "text-xs p-1 rounded text-white truncate",
                      EVENT_TYPES[event.type].color
                    )}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedEvent(event)
                    }}
                  >
                    {event.startTime} {event.title}
                  </div>
                ))}
                {dayEvents.length > 2 && (
                  <div className="text-xs text-muted-foreground">
                    +{dayEvents.length - 2} ещё
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  // Render week view
  const renderWeekView = () => {
    const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
    const weekDays = eachDayOfInterval({ 
      start: weekStart, 
      end: endOfWeek(weekStart, { weekStartsOn: 1 })
    })

    return (
      <div className="grid grid-cols-8 gap-1 h-96 overflow-auto">
        <div className="border-r border-border p-2"></div>
        {weekDays.map(day => (
          <div key={day.toISOString()} className="border-r border-border p-2 text-center">
            <div className={cn(
              "text-sm font-semibold",
              isSameDay(day, new Date()) && "text-blue-600 dark:text-blue-400"
            )}>
              {format(day, 'EEE', { locale: ru })}
            </div>
            <div className={cn(
              "text-lg font-bold",
              isSameDay(day, new Date()) && "text-blue-600 dark:text-blue-400"
            )}>
              {format(day, 'd')}
            </div>
          </div>
        ))}
        {TIME_SLOTS.map(time => (
          <React.Fragment key={time}>
            <div className="border-r border-t border-border p-2 text-sm text-muted-foreground">
              {time}
            </div>
            {weekDays.map(day => {
              const dayEvents = getEventsForDate(day).filter(event => 
                event.startTime <= time && event.endTime > time
              )
              
              return (
                <div 
                  key={`${day.toISOString()}-${time}`} 
                  className="border-r border-t border-border p-1 relative"
                >
                  {dayEvents.map(event => (
                    <div
                      key={event.id}
                      className={cn(
                        "text-xs p-1 rounded text-white cursor-pointer mb-1",
                        EVENT_TYPES[event.type].color
                      )}
                      onClick={() => setSelectedEvent(event)}
                    >
                      {event.title}
                    </div>
                  ))}
                </div>
              )
            })}
          </React.Fragment>
        ))}
      </div>
    )
  }

  // Render day view
  const renderDayView = () => {
    const dayEvents = getEventsForDate(currentDate)
    
    return (
      <div className="grid grid-cols-2 gap-4 h-96">
        <div className="space-y-2 overflow-auto">
          <h3 className="font-semibold text-lg">
            {format(currentDate, 'd MMMM yyyy', { locale: ru })}
          </h3>
          {TIME_SLOTS.map(time => {
            const timeEvents = dayEvents.filter(event => 
              event.startTime <= time && event.endTime > time
            )
            
            return (
              <div key={time} className="flex items-start space-x-2 border-b border-border pb-2">
                <div className="text-sm text-muted-foreground w-16">{time}</div>
                <div className="flex-1">
                  {timeEvents.map(event => (
                    <div
                      key={event.id}
                      className={cn(
                        "text-sm p-2 rounded cursor-pointer mb-1",
                        EVENT_TYPES[event.type].color,
                        "text-white"
                      )}
                      onClick={() => setSelectedEvent(event)}
                    >
                      <div className="font-medium">{event.title}</div>
                      <div className="text-xs opacity-90">
                        {event.startTime} - {event.endTime}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        
        <div className="space-y-4">
          <div>
            <h4 className="font-medium mb-2">События дня</h4>
            <div className="space-y-2">
              {dayEvents.map(event => (
                <Card key={event.id} className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => setSelectedEvent(event)}>
                  <CardContent className="p-3">
                    <div className="flex justify-between items-start mb-1">
                      <h5 className="font-medium">{event.title}</h5>
                      <Badge className={PRIORITY_LEVELS[event.priority].color}>
                        {PRIORITY_LEVELS[event.priority].label}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground mb-1">
                      {event.startTime} - {event.endTime}
                    </div>
                    {event.location && (
                      <div className="text-sm text-muted-foreground flex items-center">
                        <MapPin className="h-3 w-3 mr-1" />
                        {event.location}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
              {dayEvents.length === 0 && (
                <div className="text-center text-muted-foreground py-4">
                  Нет событий на этот день
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold">Календарь</h1>
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={navigatePrevious}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCurrentDate(new Date())}>
              Сегодня
            </Button>
            <Button variant="outline" size="sm" onClick={navigateNext}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {/* Search */}
          <div className="relative">
            <Search className="h-4 w-4 absolute left-2 top-2.5 text-muted-foreground" />
            <Input
              placeholder="Поиск событий..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 w-48"
            />
          </div>

          {/* Filter */}
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-32">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все</SelectItem>
              {Object.entries(EVENT_TYPES).map(([key, type]) => (
                <SelectItem key={key} value={key}>{type.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* View mode */}
          <Tabs value={viewMode} onValueChange={(value) => setViewMode(value as any)}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="month">Месяц</TabsTrigger>
              <TabsTrigger value="week">Неделя</TabsTrigger>
              <TabsTrigger value="day">День</TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Add event button */}
          <Dialog open={isAddEventOpen} onOpenChange={setIsAddEventOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                Добавить
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Новое событие</DialogTitle>
                <DialogDescription>
                  Создайте новое событие в календаре
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Название *</label>
                  <Input
                    placeholder="Введите название события..."
                    value={newEvent.title || ''}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Описание</label>
                  <Textarea
                    placeholder="Добавьте описание..."
                    value={newEvent.description || ''}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, description: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Дата</label>
                    <Input
                      type="date"
                      value={newEvent.date ? format(newEvent.date, 'yyyy-MM-dd') : ''}
                      onChange={(e) => setNewEvent(prev => ({ ...prev, date: new Date(e.target.value) }))}
                    />
                  </div>
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id="allDay"
                      checked={newEvent.isAllDay || false}
                      onChange={(e) => setNewEvent(prev => ({ ...prev, isAllDay: e.target.checked }))}
                    />
                    <label htmlFor="allDay" className="text-sm font-medium">Весь день</label>
                  </div>
                </div>

                {!newEvent.isAllDay && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Начало</label>
                      <Select 
                        value={newEvent.startTime || '09:00'} 
                        onValueChange={(value) => setNewEvent(prev => ({ ...prev, startTime: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIME_SLOTS.map(time => (
                            <SelectItem key={time} value={time}>{time}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Конец</label>
                      <Select 
                        value={newEvent.endTime || '10:00'} 
                        onValueChange={(value) => setNewEvent(prev => ({ ...prev, endTime: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TIME_SLOTS.map(time => (
                            <SelectItem key={time} value={time}>{time}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium">Тип</label>
                    <Select 
                      value={newEvent.type || 'work'} 
                      onValueChange={(value) => setNewEvent(prev => ({ ...prev, type: value as any }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(EVENT_TYPES).map(([key, type]) => (
                          <SelectItem key={key} value={key}>{type.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm font-medium">Приоритет</label>
                    <Select 
                      value={newEvent.priority || 'medium'} 
                      onValueChange={(value) => setNewEvent(prev => ({ ...prev, priority: value as any }))}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(PRIORITY_LEVELS).map(([key, level]) => (
                          <SelectItem key={key} value={key}>{level.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="text-sm font-medium">Местоположение</label>
                  <Input
                    placeholder="Введите адрес или место проведения..."
                    value={newEvent.location || ''}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, location: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Повторение</label>
                  <Select 
                    value={newEvent.recurring || 'none'} 
                    onValueChange={(value) => setNewEvent(prev => ({ ...prev, recurring: value as any }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Не повторять</SelectItem>
                      <SelectItem value="daily">Ежедневно</SelectItem>
                      <SelectItem value="weekly">Еженедельно</SelectItem>
                      <SelectItem value="monthly">Ежемесячно</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddEventOpen(false)}>
                  Отмена
                </Button>
                <Button onClick={addEvent} disabled={!newEvent.title?.trim()}>
                  Создать событие
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Current date display */}
      <div className="text-center">
        <h2 className="text-xl font-semibold">
          {viewMode === 'month' && format(currentDate, 'LLLL yyyy', { locale: ru })}
          {viewMode === 'week' && `${format(startOfWeek(currentDate, { weekStartsOn: 1 }), 'd MMM', { locale: ru })} - ${format(endOfWeek(currentDate, { weekStartsOn: 1 }), 'd MMM yyyy', { locale: ru })}`}
          {viewMode === 'day' && format(currentDate, 'd MMMM yyyy, EEEE', { locale: ru })}
        </h2>
      </div>

      {/* Calendar Views */}
      <Card>
        <CardContent className="p-0">
          {viewMode === 'month' && renderMonthView()}
          {viewMode === 'week' && renderWeekView()}
          {viewMode === 'day' && renderDayView()}
        </CardContent>
      </Card>

      {/* Event Details Dialog */}
      {selectedEvent && (
        <Dialog open={!!selectedEvent} onOpenChange={() => setSelectedEvent(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-start justify-between">
                <span>{selectedEvent.title}</span>
                <div className="flex space-x-2">
                  <Button variant="ghost" size="sm">
                    <Edit3 className="h-4 w-4" />
                  </Button>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => deleteEvent(selectedEvent.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4">
              {selectedEvent.description && (
                <div>
                  <h4 className="font-medium mb-1">Описание</h4>
                  <p className="text-sm text-muted-foreground">{selectedEvent.description}</p>
                </div>
              )}
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-1">Дата</h4>
                  <p className="text-sm">{format(selectedEvent.date, 'd MMMM yyyy', { locale: ru })}</p>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Время</h4>
                  <p className="text-sm">
                    {selectedEvent.isAllDay ? 'Весь день' : `${selectedEvent.startTime} - ${selectedEvent.endTime}`}
                  </p>
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h4 className="font-medium mb-1">Тип</h4>
                  <Badge className={`${EVENT_TYPES[selectedEvent.type].color} text-white`}>
                    {EVENT_TYPES[selectedEvent.type].label}
                  </Badge>
                </div>
                <div>
                  <h4 className="font-medium mb-1">Приоритет</h4>
                  <Badge className={PRIORITY_LEVELS[selectedEvent.priority].color}>
                    {PRIORITY_LEVELS[selectedEvent.priority].label}
                  </Badge>
                </div>
              </div>

              {selectedEvent.location && (
                <div>
                  <h4 className="font-medium mb-1 flex items-center">
                    <MapPin className="h-4 w-4 mr-1" />
                    Местоположение
                  </h4>
                  <p className="text-sm text-muted-foreground">{selectedEvent.location}</p>
                </div>
              )}

              {selectedEvent.attendees && selectedEvent.attendees.length > 0 && (
                <div>
                  <h4 className="font-medium mb-1 flex items-center">
                    <Users className="h-4 w-4 mr-1" />
                    Участники
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedEvent.attendees.map((attendee, index) => (
                      <Badge key={index} variant="secondary">{attendee}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {selectedEvent.reminders && selectedEvent.reminders.length > 0 && (
                <div>
                  <h4 className="font-medium mb-1 flex items-center">
                    <Bell className="h-4 w-4 mr-1" />
                    Напоминания
                  </h4>
                  <div className="flex flex-wrap gap-1">
                    {selectedEvent.reminders.map((reminder, index) => (
                      <Badge key={index} variant="outline">
                        За {reminder} мин
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
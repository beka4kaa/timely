"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Calendar as CalendarIcon,
  Clock,
  X,
  Loader2,
  GripVertical
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from 'next-auth/react'

interface TimeSlot {
  id: string
  startTime: string
  endTime: string
  task: string
  color: string
  date: string
  top: number
  height: number
}

interface CalendarEvent {
  id: string
  title: string
  description?: string
  start: string
  end: string
  category: string
  priority: string
  color: string
  userId: string
}

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

// Генерируем часы с 6:00 до 23:00
const generateHours = () => {
  const hours = []
  for (let i = 6; i <= 23; i++) {
    hours.push(`${i.toString().padStart(2, '0')}:00`)
  }
  return hours
}

const HOURS = generateHours()
const HOUR_HEIGHT = 60 // высота часа в пикселях

export function GoogleCalendarComponent() {
  const { data: session } = useSession()
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [newEvent, setNewEvent] = useState({
    title: '',
    startTime: '09:00',
    endTime: '10:00',
    color: '#3b82f6'
  })
  const [draggedItem, setDraggedItem] = useState<{ id: string; type: 'slot' | 'event'; offset: { x: number; y: number } } | null>(null)
  const [showEventForm, setShowEventForm] = useState(false)

  // Fetch events from API
  const fetchEvents = useCallback(async () => {
    if (!session?.user) {
      console.log('No session available')
      return
    }

    setLoading(true)
    try {
      const response = await fetch('/api/google-calendar-events')
      
      if (!response.ok) {
        throw new Error('Failed to fetch calendar events')
      }
      
      const data = await response.json()
      setEvents(data.items || [])
    } catch (error) {
      console.error('Error fetching events:', error)
    } finally {
      setLoading(false)
    }
  }, [session?.user])

  useEffect(() => {
    if (session) {
      fetchEvents()
    }
  }, [session, fetchEvents])

  // Конвертируем время в позицию Y
  const timeToPosition = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number)
    const totalMinutes = (hours - 6) * 60 + minutes // 6:00 это начало
    return (totalMinutes / 60) * HOUR_HEIGHT
  }

  // Конвертируем позицию Y в время
  const positionToTime = (position: number): string => {
    const totalMinutes = (position / HOUR_HEIGHT) * 60
    const hours = Math.floor(totalMinutes / 60) + 6 // 6:00 это начало
    const minutes = Math.round((totalMinutes % 60) / 15) * 15 // округляем до 15 минут
    
    if (hours > 23) return '23:45'
    if (hours < 6) return '06:00'
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }

  // Добавить новый слот
  const addTimeSlot = () => {
    if (!newEvent.title || !newEvent.startTime || !newEvent.endTime) return

    const startPos = timeToPosition(newEvent.startTime)
    const endPos = timeToPosition(newEvent.endTime)
    
    const newSlot: TimeSlot = {
      id: Date.now().toString(),
      startTime: newEvent.startTime,
      endTime: newEvent.endTime,
      task: newEvent.title,
      color: newEvent.color,
      date: selectedDate.toDateString(),
      top: startPos,
      height: endPos - startPos
    }

    setTimeSlots(prev => [...prev, newSlot])
    setNewEvent({
      title: '',
      startTime: '09:00',
      endTime: '10:00',
      color: '#3b82f6'
    })
    setShowEventForm(false)
  }

  // Удалить слот
  const removeTimeSlot = (slotId: string) => {
    setTimeSlots(prev => prev.filter(slot => slot.id !== slotId))
  }

  // Обработчики перетаскивания
  const handleMouseDown = (e: React.MouseEvent, item: TimeSlot) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setDraggedItem({
      id: item.id,
      type: 'slot',
      offset: {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      }
    })
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggedItem) return

    const timeGrid = document.getElementById('time-grid')
    if (!timeGrid) return

    const rect = timeGrid.getBoundingClientRect()
    const newY = e.clientY - rect.top - draggedItem.offset.y

    // Обновляем позицию элемента
    setTimeSlots(prev => prev.map(slot => {
      if (slot.id === draggedItem.id) {
        const newTop = Math.max(0, Math.min(newY, HOUR_HEIGHT * HOURS.length - slot.height))
        const newStartTime = positionToTime(newTop)
        const newEndTime = positionToTime(newTop + slot.height)
        
        return {
          ...slot,
          top: newTop,
          startTime: newStartTime,
          endTime: newEndTime
        }
      }
      return slot
    }))
  }, [draggedItem])

  const handleMouseUp = useCallback(() => {
    setDraggedItem(null)
  }, [])

  useEffect(() => {
    if (draggedItem) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      return () => {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [draggedItem, handleMouseMove, handleMouseUp])

  // Навигация по дням
  const navigateDay = (direction: 'prev' | 'next') => {
    const newDate = new Date(selectedDate)
    if (direction === 'prev') {
      newDate.setDate(newDate.getDate() - 1)
    } else {
      newDate.setDate(newDate.getDate() + 1)
    }
    setSelectedDate(newDate)
  }

  // Получить слоты для выбранной даты
  const getSlotsForSelectedDate = () => {
    return timeSlots.filter(slot => slot.date === selectedDate.toDateString())
  }

  const formatDate = (date: Date) => {
    const today = new Date()
    const isToday = date.toDateString() === today.toDateString()
    
    if (isToday) {
      return 'Сегодня'
    }
    
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const isTomorrow = date.toDateString() === tomorrow.toDateString()
    
    if (isTomorrow) {
      return 'Завтра'
    }
    
    return `${date.getDate()} ${MONTHS[date.getMonth()]}`
  }

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => navigateDay('prev')}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <h2 className="text-lg font-semibold min-w-[120px]">
              {formatDate(selectedDate)}
            </h2>
            
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => navigateDay('next')}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button
            onClick={() => setShowEventForm(true)}
            size="sm"
            className="h-8"
          >
            <Plus className="h-3 w-3 mr-1" />
            Добавить событие
          </Button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={() => setSelectedDate(new Date())}
          className="h-8"
        >
          Сегодня
        </Button>
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Календарь сетка слева */}
        <div className="col-span-3">
          <Card className="rounded-2xl border-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Мини календарь</CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="text-center text-sm text-muted-foreground">
                Выбранная дата: {selectedDate.toLocaleDateString('ru-RU')}
              </div>
            </CardContent>
          </Card>

          {/* Форма добавления события */}
          {showEventForm && (
            <Card className="rounded-2xl border-2 mt-4">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  Новое событие
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowEventForm(false)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs">Название</Label>
                  <Input
                    placeholder="Встреча..."
                    value={newEvent.title}
                    onChange={(e) => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-xs">С</Label>
                    <Input
                      type="time"
                      value={newEvent.startTime}
                      onChange={(e) => setNewEvent(prev => ({ ...prev, startTime: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">До</Label>
                    <Input
                      type="time"
                      value={newEvent.endTime}
                      onChange={(e) => setNewEvent(prev => ({ ...prev, endTime: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                </div>
                <Button 
                  onClick={addTimeSlot}
                  size="sm"
                  className="w-full h-8 text-xs"
                  disabled={!newEvent.title}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Добавить
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Временная сетка справа */}
        <div className="col-span-9">
          <Card className="rounded-2xl border-2 overflow-hidden">
            <CardContent className="p-0">
              <div 
                id="time-grid"
                className="relative bg-white dark:bg-gray-950 min-h-[600px]"
                style={{ height: HOUR_HEIGHT * HOURS.length }}
              >
                {/* Сетка времени */}
                {HOURS.map((hour, index) => (
                  <div
                    key={hour}
                    className="absolute w-full border-b border-gray-200 dark:border-gray-800 flex items-start"
                    style={{ 
                      top: index * HOUR_HEIGHT,
                      height: HOUR_HEIGHT
                    }}
                  >
                    <div className="w-16 text-xs text-muted-foreground p-2 border-r border-gray-200 dark:border-gray-800">
                      {hour}
                    </div>
                    <div className="flex-1 relative">
                      {/* Линии каждые 15 минут */}
                      {[15, 30, 45].map(minute => (
                        <div
                          key={minute}
                          className="absolute w-full border-b border-gray-100 dark:border-gray-900 opacity-50"
                          style={{ top: (minute / 60) * HOUR_HEIGHT }}
                        />
                      ))}
                    </div>
                  </div>
                ))}

                {/* Блоки событий */}
                {getSlotsForSelectedDate().map(slot => (
                  <div
                    key={slot.id}
                    className={cn(
                      "absolute left-16 right-4 rounded-lg border-2 shadow-sm cursor-move transition-all duration-200",
                      "hover:shadow-md hover:scale-[1.02] select-none",
                      draggedItem?.id === slot.id ? "shadow-lg scale-[1.02] z-10" : "z-0"
                    )}
                    style={{
                      top: slot.top,
                      height: Math.max(slot.height, 30),
                      backgroundColor: slot.color + '20',
                      borderColor: slot.color,
                    }}
                    onMouseDown={(e) => handleMouseDown(e, slot)}
                  >
                    <div className="p-2 h-full flex flex-col justify-between">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate" style={{ color: slot.color }}>
                            {slot.task}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {slot.startTime} - {slot.endTime}
                          </div>
                        </div>
                        <div className="flex items-center space-x-1 ml-2">
                          <GripVertical className="h-3 w-3 text-muted-foreground opacity-50" />
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              removeTimeSlot(slot.id)
                            }}
                            className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}

                {/* Текущее время линия */}
                {selectedDate.toDateString() === new Date().toDateString() && (
                  <div
                    className="absolute left-16 right-4 border-t-2 border-red-500 z-20"
                    style={{
                      top: timeToPosition(new Date().toTimeString().slice(0, 5))
                    }}
                  >
                    <div className="w-3 h-3 bg-red-500 rounded-full -mt-1.5 -ml-1.5"></div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
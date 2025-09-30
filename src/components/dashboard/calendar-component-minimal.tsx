"use client"

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { 
  ChevronLeft, 
  ChevronRight, 
  Plus, 
  Calendar as CalendarIcon,
  Clock
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface CalendarEvent {
  id: string
  title: string
  date: Date
  time?: string
  type: 'task' | 'meeting' | 'goal' | 'personal'
}

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function CalendarComponent() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [events] = useState<CalendarEvent[]>([
    {
      id: '1',
      title: 'Meeting',
      date: new Date(),
      time: '10:00',
      type: 'meeting'
    },
    {
      id: '2', 
      title: 'Task',
      date: new Date(Date.now() + 86400000),
      time: '14:00',
      type: 'task'
    }
  ])

  // Получить первый день месяца и количество дней
  const getMonthData = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    
    const firstDayOfMonth = new Date(year, month, 1)
    const lastDayOfMonth = new Date(year, month + 1, 0)
    const daysInMonth = lastDayOfMonth.getDate()
    
    // Получить день недели первого дня (0 = воскресенье, 1 = понедельник, ...)
    let startDayOfWeek = firstDayOfMonth.getDay()
    // Преобразовать в наш формат (понедельник = 0)
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1
    
    return { daysInMonth, startDayOfWeek, year, month }
  }

  const { daysInMonth, startDayOfWeek, year, month } = getMonthData(currentDate)

  // Получить события для конкретной даты
  const getEventsForDate = (date: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.date)
      return (
        eventDate.getDate() === date.getDate() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear()
      )
    })
  }

  // Создать массив дней для календаря
  const calendarDays = []
  
  // Добавить пустые ячейки для дней предыдущего месяца
  for (let i = 0; i < startDayOfWeek; i++) {
    calendarDays.push(null)
  }
  
  // Добавить дни текущего месяца
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day)
  }

  // Навигация по месяцам
  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate)
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1)
    } else {
      newDate.setMonth(newDate.getMonth() + 1)
    }
    setCurrentDate(newDate)
  }

  // Проверить, является ли день сегодняшним
  const isToday = (day: number) => {
    const today = new Date()
    return (
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear()
    )
  }

  // Проверить, выбран ли день
  const isSelected = (day: number) => {
    if (!selectedDate) return false
    return (
      day === selectedDate.getDate() &&
      month === selectedDate.getMonth() &&
      year === selectedDate.getFullYear()
    )
  }

  // Выбрать дату
  const selectDate = (day: number) => {
    const newDate = new Date(year, month, day)
    setSelectedDate(newDate)
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Простой заголовок */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => navigateMonth('prev')}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          
          <h2 className="text-xl font-medium">
            {MONTHS[month]} {year}
          </h2>
          
          <Button 
            variant="ghost" 
            size="icon"
            onClick={() => navigateMonth('next')}
          >
            <ChevronRight className="h-5 w-5" />
          </Button>
        </div>
        
        <Button size="sm" variant="outline">
          <Plus className="h-4 w-4 mr-2" />
          Добавить
        </Button>
      </div>

      {/* Минималистичная календарная сетка */}
      <Card>
        <CardContent className="p-6">
          {/* Заголовки дней недели */}
          <div className="grid grid-cols-7 gap-1 mb-4">
            {WEEKDAYS.map(day => (
              <div key={day} className="p-3 text-center text-sm font-medium text-muted-foreground">
                {day}
              </div>
            ))}
          </div>
          
          {/* Сетка календаря */}
          <div className="grid grid-cols-7 gap-1">
            {calendarDays.map((day, index) => (
              <div 
                key={index}
                className={cn(
                  "min-h-[60px] p-2 rounded-md hover:bg-muted/50 cursor-pointer transition-colors relative",
                  day && "hover:bg-muted",
                  !day && "cursor-default hover:bg-transparent"
                )}
                onClick={() => day && selectDate(day)}
              >
                {day && (
                  <>
                    <div className={cn(
                      "text-sm font-medium mb-1",
                      isToday(day) && "bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs",
                      isSelected(day) && !isToday(day) && "text-primary font-semibold"
                    )}>
                      {day}
                    </div>
                    
                    {/* Простые события */}
                    <div className="space-y-0.5">
                      {getEventsForDate(new Date(year, month, day)).slice(0, 2).map(event => (
                        <div 
                          key={event.id}
                          className="w-full h-1.5 bg-blue-200 rounded-full"
                          title={event.title}
                        />
                      ))}
                      
                      {/* Показать количество дополнительных событий */}
                      {getEventsForDate(new Date(year, month, day)).length > 2 && (
                        <div className="text-xs text-muted-foreground">
                          +{getEventsForDate(new Date(year, month, day)).length - 2}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Выбранный день (если есть) */}
      {selectedDate && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center space-x-2 text-lg">
              <CalendarIcon className="h-5 w-5" />
              <span>
                {selectedDate.getDate()} {MONTHS[selectedDate.getMonth()]}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {getEventsForDate(selectedDate).length > 0 ? (
              <div className="space-y-2">
                {getEventsForDate(selectedDate).map(event => (
                  <div 
                    key={event.id}
                    className="flex items-center justify-between p-3 rounded-lg border"
                  >
                    <div className="flex items-center space-x-3">
                      <div className="w-3 h-3 bg-blue-500 rounded-full" />
                      <div>
                        <div className="font-medium text-sm">{event.title}</div>
                        {event.time && (
                          <div className="text-xs text-muted-foreground flex items-center mt-1">
                            <Clock className="h-3 w-3 mr-1" />
                            {event.time}
                          </div>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {event.type}
                    </Badge>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-muted-foreground py-6">
                <CalendarIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm">Нет событий на эту дату</p>
                <Button variant="outline" size="sm" className="mt-3">
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить событие
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
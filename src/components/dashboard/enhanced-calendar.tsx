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
  Loader2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSession } from 'next-auth/react'

interface TimeSlot {
  id: string
  startTime: string
  endTime: string
  task: string
  color: string
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

export function EnhancedCalendarComponent() {
  const { data: session } = useSession()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [showTimeScheduler, setShowTimeScheduler] = useState(false)
  const [timeSlots, setTimeSlots] = useState<{ [date: string]: TimeSlot[] }>({})
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [newTask, setNewTask] = useState({ startTime: '', endTime: '', task: '' })

  // Fetch events
  const fetchEvents = useCallback(async () => {
    if (!session?.user?.id) return
    
    try {
      const response = await fetch('/api/events')
      if (response.ok) {
        const data = await response.json()
        setEvents(data.events || [])
      }
    } catch (error) {
      console.error('Error fetching events:', error)
    }
  }, [session?.user?.id])

  useEffect(() => {
    if (session) {
      fetchEvents()
    }
  }, [session, fetchEvents])

  // Get month data
  const getMonthData = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    
    const firstDayOfMonth = new Date(year, month, 1)
    const lastDayOfMonth = new Date(year, month + 1, 0)
    const daysInMonth = lastDayOfMonth.getDate()
    
    let startDayOfWeek = firstDayOfMonth.getDay()
    startDayOfWeek = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1
    
    return { daysInMonth, startDayOfWeek, year, month }
  }

  const { daysInMonth, startDayOfWeek, year, month } = getMonthData(currentDate)

  // Get events for date
  const getEventsForDate = (date: Date) => {
    return events.filter(event => {
      const eventDate = new Date(event.start)
      return (
        eventDate.getDate() === date.getDate() &&
        eventDate.getMonth() === date.getMonth() &&
        eventDate.getFullYear() === date.getFullYear()
      )
    })
  }

  // Create calendar days
  const calendarDays = []
  
  for (let i = 0; i < startDayOfWeek; i++) {
    calendarDays.push(null)
  }
  
  for (let day = 1; day <= daysInMonth; day++) {
    calendarDays.push(day)
  }

  // Navigate months
  const navigateMonth = (direction: 'prev' | 'next') => {
    const newDate = new Date(currentDate)
    if (direction === 'prev') {
      newDate.setMonth(newDate.getMonth() - 1)
    } else {
      newDate.setMonth(newDate.getMonth() + 1)
    }
    setCurrentDate(newDate)
  }

  // Check if today
  const isToday = (day: number) => {
    const today = new Date()
    return (
      day === today.getDate() &&
      month === today.getMonth() &&
      year === today.getFullYear()
    )
  }

  // Check if selected
  const isSelected = (day: number) => {
    if (!selectedDate) return false
    return (
      day === selectedDate.getDate() &&
      month === selectedDate.getMonth() &&
      year === selectedDate.getFullYear()
    )
  }

  // Select date
  const selectDate = (day: number) => {
    const newDate = new Date(year, month, day)
    setSelectedDate(newDate)
    setShowTimeScheduler(true)
  }

  // Time slot functions
  const addTimeSlot = () => {
    if (!selectedDate || !newTask.startTime || !newTask.endTime || !newTask.task) return
    
    const dateKey = selectedDate.toDateString()
    const newSlot: TimeSlot = {
      id: Date.now().toString(),
      startTime: newTask.startTime,
      endTime: newTask.endTime,
      task: newTask.task,
      color: `hsl(${Math.random() * 360}, 70%, 50%)`
    }

    setTimeSlots(prev => ({
      ...prev,
      [dateKey]: [...(prev[dateKey] || []), newSlot].sort((a, b) => 
        a.startTime.localeCompare(b.startTime)
      )
    }))

    setNewTask({ startTime: '', endTime: '', task: '' })
  }

  const removeTimeSlot = (slotId: string) => {
    if (!selectedDate) return
    const dateKey = selectedDate.toDateString()
    setTimeSlots(prev => ({
      ...prev,
      [dateKey]: (prev[dateKey] || []).filter(slot => slot.id !== slotId)
    }))
  }

  const getTimeSlotsForDate = (date: Date) => {
    const dateKey = date.toDateString()
    return timeSlots[dateKey] || []
  }

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => navigateMonth('prev')}
            className="h-8 w-8 p-0"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          
          <h2 className="text-lg font-semibold">
            {MONTHS[month]} {year}
          </h2>
          
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => navigateMonth('next')}
            className="h-8 w-8 p-0"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Calendar Grid */}
        <div className="lg:col-span-2">
          <Card className="rounded-2xl border-2">
            <CardContent className="p-4">
              {/* Weekday headers */}
              <div className="grid grid-cols-7 gap-1 mb-2">
                {WEEKDAYS.map(day => (
                  <div key={day} className="p-2 text-center text-xs font-medium text-muted-foreground">
                    {day}
                  </div>
                ))}
              </div>
              
              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {calendarDays.map((day, index) => {
                  const dayEvents = day ? getEventsForDate(new Date(year, month, day)) : []
                  const dayTimeSlots = day ? getTimeSlotsForDate(new Date(year, month, day)) : []
                  
                  return (
                    <div 
                      key={index}
                      className={cn(
                        "min-h-[48px] p-2 rounded-xl hover:bg-muted/50 cursor-pointer transition-all duration-200 relative border-2 border-transparent",
                        day && "hover:bg-muted hover:border-primary/20",
                        !day && "cursor-default hover:bg-transparent",
                        day && isSelected(day) && "border-primary bg-primary/5",
                        dayTimeSlots.length > 0 && "bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20"
                      )}
                      onClick={() => day && selectDate(day)}
                    >
                      {day && (
                        <>
                          <div className={cn(
                            "text-sm font-medium mb-1 flex items-center justify-center",
                            isToday(day) && "bg-primary text-primary-foreground rounded-full w-6 h-6 text-xs",
                            day && isSelected(day) && !isToday(day) && "text-primary font-bold"
                          )}>
                            {day}
                          </div>
                          
                          {/* Event indicators */}
                          <div className="space-y-0.5">
                            {dayEvents.slice(0, 1).map(event => (
                              <div 
                                key={event.id}
                                className="w-full h-1 bg-blue-400 rounded-full"
                                title={event.title}
                              />
                            ))}
                            
                            {dayTimeSlots.slice(0, 2).map(slot => (
                              <div 
                                key={slot.id}
                                className="w-full h-1 rounded-full"
                                style={{ backgroundColor: slot.color }}
                                title={`${slot.startTime}-${slot.endTime}: ${slot.task}`}
                              />
                            ))}
                            
                            {(dayEvents.length + dayTimeSlots.length) > 2 && (
                              <div className="text-[10px] text-muted-foreground text-center">
                                +{(dayEvents.length + dayTimeSlots.length) - 2}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Time Planning Panel */}
        <div className="space-y-4">
          {selectedDate && showTimeScheduler && (
            <Card className="rounded-2xl border-2">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <div className="flex items-center space-x-2">
                    <CalendarIcon className="h-4 w-4" />
                    <span>
                      {selectedDate.getDate()} {MONTHS[selectedDate.getMonth()]}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowTimeScheduler(false)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Add time slot form */}
                <div className="space-y-3 p-4 bg-muted/30 rounded-xl">
                  <Label className="text-sm font-medium">Новая задача</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor="start-time" className="text-xs">С</Label>
                      <Input
                        id="start-time"
                        type="time"
                        value={newTask.startTime}
                        onChange={(e) => setNewTask(prev => ({ ...prev, startTime: e.target.value }))}
                        className="h-8 text-xs"
                      />
                    </div>
                    <div>
                      <Label htmlFor="end-time" className="text-xs">До</Label>
                      <Input
                        id="end-time"
                        type="time"
                        value={newTask.endTime}
                        onChange={(e) => setNewTask(prev => ({ ...prev, endTime: e.target.value }))}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                  <div>
                    <Input
                      placeholder="Название задачи"
                      value={newTask.task}
                      onChange={(e) => setNewTask(prev => ({ ...prev, task: e.target.value }))}
                      className="h-8 text-xs"
                    />
                  </div>
                  <Button 
                    onClick={addTimeSlot}
                    size="sm"
                    className="w-full h-8 text-xs"
                    disabled={!newTask.startTime || !newTask.endTime || !newTask.task}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Добавить
                  </Button>
                </div>

                {/* Time slots list */}
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {getTimeSlotsForDate(selectedDate).map(slot => (
                    <div 
                      key={slot.id}
                      className="flex items-center justify-between p-3 rounded-xl border-2"
                      style={{ borderLeftColor: slot.color, borderLeftWidth: '4px' }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center space-x-2 mb-1">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-medium text-muted-foreground">
                            {slot.startTime} - {slot.endTime}
                          </span>
                        </div>
                        <div className="text-sm font-medium truncate">{slot.task}</div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeTimeSlot(slot.id)}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}

                  {getTimeSlotsForDate(selectedDate).length === 0 && (
                    <div className="text-center text-muted-foreground py-8">
                      <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Нет запланированных задач</p>
                    </div>
                  )}
                </div>

                {/* Events for selected date */}
                {getEventsForDate(selectedDate).length > 0 && (
                  <div className="pt-4 border-t">
                    <Label className="text-sm font-medium mb-3 block">События</Label>
                    <div className="space-y-2">
                      {getEventsForDate(selectedDate).map(event => (
                        <div 
                          key={event.id}
                          className="flex items-center justify-between p-3 rounded-xl bg-blue-50 dark:bg-blue-950/20 border"
                        >
                          <div className="flex items-center space-x-3">
                            <div className="w-3 h-3 bg-blue-500 rounded-full" />
                            <div>
                              <div className="font-medium text-sm">{event.title}</div>
                              <div className="text-xs text-muted-foreground flex items-center mt-1">
                                <Clock className="h-3 w-3 mr-1" />
                                {new Date(event.start).toLocaleTimeString('ru-RU', { 
                                  hour: '2-digit', 
                                  minute: '2-digit' 
                                })}
                              </div>
                            </div>
                          </div>
                          <Badge variant="secondary" className="text-xs">
                            {event.category}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

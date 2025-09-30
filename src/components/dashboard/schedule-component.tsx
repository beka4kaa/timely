"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

interface TimeSlot {
  id: string
  startTime: string
  endTime: string
  task: string
  color: string
  dayOfWeek: number
  top: number
  height: number
}

const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

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
const SLOT_HEIGHT = 15 // высота 15-минутного слота в пикселях
const SLOTS_PER_HOUR = 4 // количество 15-минутных слотов в часе

export function ScheduleComponent() {
  const { data: session } = useSession()
  const [selectedDay, setSelectedDay] = useState(0) // 0 = понедельник
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [draggedItem, setDraggedItem] = useState<{ id: string; offset: { x: number; y: number }; isDragging: boolean } | null>(null)
  const [showEventDialog, setShowEventDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [clickPosition, setClickPosition] = useState<{ y: number; time: string } | null>(null)
  const [editingEvent, setEditingEvent] = useState<TimeSlot | null>(null)
  const [newEvent, setNewEvent] = useState({
    title: '',
    duration: 60, // в минутах
    customDuration: '',
    color: '#3b82f6'
  })

  // Конвертируем время в позицию Y с привязкой к сетке
  const timeToPosition = (time: string): number => {
    const [hours, minutes] = time.split(':').map(Number)
    const totalMinutes = (hours - 6) * 60 + minutes // 6:00 это начало
    const slotIndex = totalMinutes / 15 // индекс 15-минутного слота
    return slotIndex * SLOT_HEIGHT
  }

  // Конвертируем позицию Y во время с привязкой к сетке
  const positionToTime = (position: number): string => {
    // Привязываем к сетке 15-минутных интервалов
    const slotIndex = Math.round(position / SLOT_HEIGHT)
    const totalMinutes = slotIndex * 15 + 6 * 60 // начинаем с 6:00
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    
    if (hours > 23) return '23:45'
    if (hours < 6) return '06:00'
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }

  // Вычислить время окончания
  const calculateEndTime = useCallback((startTime: string, durationMinutes: number): string => {
    const [hours, minutes] = startTime.split(':').map(Number)
    const totalMinutes = hours * 60 + minutes + durationMinutes
    const endHours = Math.floor(totalMinutes / 60)
    const endMinutes = totalMinutes % 60
    
    if (endHours > 23) return '23:59'
    
    return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`
  }, [])

  // Обработка клика по временной сетке
  const handleGridClick = (e: React.MouseEvent) => {
    // Проверяем что клик НЕ по событию (событие имеет onMouseDown который останавливает распространение)
    // Разрешаем клики по элементам сетки времени
    const target = e.target as HTMLElement
    const isEventElement = target.closest('[data-event-id]')
    
    if (isEventElement) {
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const clickTime = positionToTime(y)
    
    setClickPosition({ y, time: clickTime })
    setShowEventDialog(true)
  }

  // Создать новое событие
  const createEvent = () => {
    if (!newEvent.title || !clickPosition) return

    const duration = newEvent.customDuration ? 
      parseCustomDuration(newEvent.customDuration) : newEvent.duration
    
    // Привязываем время к сетке
    const gridTime = positionToTime(clickPosition.y)
    const endTime = calculateEndTime(gridTime, duration)
    
    // Проверяем на пересечения и находим свободное место
    const freeStartTime = findFreePosition(gridTime, duration)
    const actualEndTime = calculateEndTime(freeStartTime, duration)
    
    const startPos = timeToPosition(freeStartTime)
    const durationHeight = (duration / 60) * HOUR_HEIGHT
    
    const newSlot: TimeSlot = {
      id: Date.now().toString(),
      startTime: freeStartTime,
      endTime: actualEndTime,
      task: newEvent.title,
      color: newEvent.color,
      dayOfWeek: selectedDay,
      top: startPos,
      height: durationHeight
    }

    setTimeSlots(prev => [...prev, newSlot])
    setNewEvent({ title: '', duration: 60, customDuration: '', color: '#3b82f6' })
    setShowEventDialog(false)
    setClickPosition(null)
  }

  // Удалить событие
  const removeTimeSlot = (slotId: string) => {
    setTimeSlots(prev => prev.filter(slot => slot.id !== slotId))
  }



  // Обновить событие
  const updateEvent = () => {
    if (!editingEvent) return

    setTimeSlots(prev => prev.map(slot => {
      if (slot.id === editingEvent.id) {
        // Пересчитываем высоту если изменилась длительность
        const duration = newEvent.customDuration ? 
          parseCustomDuration(newEvent.customDuration) : newEvent.duration
        const durationHeight = (duration / 60) * HOUR_HEIGHT
        const endTime = calculateEndTime(slot.startTime, duration)
        
        return {
          ...slot,
          task: newEvent.title || slot.task,
          color: newEvent.color,
          height: durationHeight,
          endTime: endTime
        }
      }
      return slot
    }))
    
    setShowEditDialog(false)
    setEditingEvent(null)
    setNewEvent({ title: '', duration: 60, customDuration: '', color: '#3b82f6' })
  }

  // Проверка на пересечения событий
  const checkCollision = (startTime: string, endTime: string, excludeId?: string): boolean => {
    const newStart = timeToPosition(startTime)
    const newEnd = timeToPosition(endTime)
    
    return getSlotsForSelectedDay().some(slot => {
      if (excludeId && slot.id === excludeId) return false
      
      const slotStart = slot.top
      const slotEnd = slot.top + slot.height
      
      // Проверяем пересечение интервалов
      return !(newEnd <= slotStart || newStart >= slotEnd)
    })
  }

  // Найти ближайшее свободное место
  const findFreePosition = (startTime: string, duration: number): string => {
    const durationHeight = (duration / 60) * HOUR_HEIGHT
    let currentTime = startTime
    
    // Пробуем найти свободное место в течение дня
    for (let attempt = 0; attempt < 96; attempt++) { // 96 слотов по 15 минут = 24 часа
      const endTime = calculateEndTime(currentTime, duration)
      
      if (!checkCollision(currentTime, endTime)) {
        return currentTime
      }
      
      // Переходим к следующему 15-минутному слоту
      const [hours, minutes] = currentTime.split(':').map(Number)
      const totalMinutes = hours * 60 + minutes + 15
      const newHours = Math.floor(totalMinutes / 60)
      const newMinutes = totalMinutes % 60
      
      if (newHours >= 24) break // Не выходим за пределы дня
      
      currentTime = `${newHours.toString().padStart(2, '0')}:${newMinutes.toString().padStart(2, '0')}`
    }
    
    return startTime // Возвращаем исходное время если не нашли место
  }

  // Парсинг custom длительности
  const parseCustomDuration = useCallback((str: string): number => {
    str = str.toLowerCase().trim()
    
    // Формат: "2ч 30м" или "2h 30m"
    const hourMinuteMatch = str.match(/(\d+)\s*[чh]\s*(\d+)?\s*[мm]?/)
    if (hourMinuteMatch) {
      const hours = parseInt(hourMinuteMatch[1]) || 0
      const minutes = parseInt(hourMinuteMatch[2]) || 0
      return hours * 60 + minutes
    }
    
    // Формат: "120м" или "120m"
    const minuteMatch = str.match(/(\d+)\s*[мm]/)
    if (minuteMatch) {
      return parseInt(minuteMatch[1]) || 60
    }
    
    // Формат: "2ч" или "2h"
    const hourMatch = str.match(/(\d+)\s*[чh]/)
    if (hourMatch) {
      return parseInt(hourMatch[1]) * 60 || 60
    }
    
    // Просто число - считаем минutами
    const numberMatch = str.match(/^(\d+)$/)
    if (numberMatch) {
      return parseInt(numberMatch[1]) || 60
    }
    
    return 60 // возвращаем дефолтное значение если не смогли распарсить
  }, [])

  // Обработчики перетаскивания и клика
  const handleMouseDown = (e: React.MouseEvent, item: TimeSlot) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setDraggedItem({
      id: item.id,
      offset: {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      },
      isDragging: false
    })
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!draggedItem) return

    // Отмечаем что началось перетаскивание
    if (!draggedItem.isDragging) {
      setDraggedItem(prev => prev ? { ...prev, isDragging: true } : null)
    }

    const timeGrid = document.getElementById('schedule-time-grid')
    if (!timeGrid) return

    const rect = timeGrid.getBoundingClientRect()
    const rawY = e.clientY - rect.top - draggedItem.offset.y
    
    // Привязываем к сетке 15-минутных интервалов
    const slotIndex = Math.round(rawY / SLOT_HEIGHT)
    const snappedY = slotIndex * SLOT_HEIGHT
    
    // Ограничиваем в пределах сетки
    const maxY = SLOT_HEIGHT * (HOURS.length * SLOTS_PER_HOUR)
    const newY = Math.max(0, Math.min(snappedY, maxY))

    // Обновляем позицию элемента
    setTimeSlots(prev => prev.map(slot => {
      if (slot.id === draggedItem.id) {
        const newStartTime = positionToTime(newY)
        const duration = Math.round((slot.height / HOUR_HEIGHT) * 60)
        const newEndTime = calculateEndTime(newStartTime, duration)
        
        // Проверяем на пересечения с другими событиями
        const hasCollision = checkCollision(newStartTime, newEndTime, slot.id)
        
        if (hasCollision) {
          // Если есть пересечение, ищем ближайшее свободное место
          const freeStartTime = findFreePosition(newStartTime, duration)
          const freeY = timeToPosition(freeStartTime)
          const freeEndTime = calculateEndTime(freeStartTime, duration)
          
          return {
            ...slot,
            top: freeY,
            startTime: freeStartTime,
            endTime: freeEndTime
          }
        }
        
        return {
          ...slot,
          top: newY,
          startTime: newStartTime,
          endTime: newEndTime
        }
      }
      return slot
    }))
  }, [draggedItem])

  const handleMouseUp = useCallback(() => {
    if (draggedItem && !draggedItem.isDragging) {
      // Это был клик, а не перетаскивание - открываем меню редактирования
      const eventToEdit = timeSlots.find(slot => slot.id === draggedItem.id)
      if (eventToEdit) {
        setEditingEvent(eventToEdit)
        // Устанавливаем текущие значения в форму
        const currentDuration = Math.round((eventToEdit.height / HOUR_HEIGHT) * 60)
        setNewEvent({
          title: eventToEdit.task,
          duration: currentDuration,
          customDuration: '',
          color: eventToEdit.color
        })
        setShowEditDialog(true)
      }
    }
    setDraggedItem(null)
  }, [draggedItem, timeSlots])

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

  // Автосохранение при изменении свойств события
  useEffect(() => {
    if (editingEvent && showEditDialog && (newEvent.title || newEvent.color || newEvent.duration || newEvent.customDuration)) {
      const timeoutId = setTimeout(() => {
        // Автосохраняем изменения
        setTimeSlots(prev => prev.map(slot => {
          if (slot.id === editingEvent.id) {
            const duration = newEvent.customDuration ? 
              parseCustomDuration(newEvent.customDuration) : newEvent.duration
            const durationHeight = (duration / 60) * HOUR_HEIGHT
            const endTime = calculateEndTime(slot.startTime, duration)
            
            return {
              ...slot,
              task: newEvent.title || slot.task,
              color: newEvent.color,
              height: durationHeight,
              endTime: endTime
            }
          }
          return slot
        }))
      }, 500) // 500мс задержка для избежания слишком частых обновлений
      
      return () => clearTimeout(timeoutId)
    }
  }, [editingEvent?.id, showEditDialog, newEvent.title, newEvent.color, newEvent.duration, newEvent.customDuration, parseCustomDuration, calculateEndTime])

  // Получить слоты для выбранного дня
  const getSlotsForSelectedDay = () => {
    return timeSlots.filter(slot => slot.dayOfWeek === selectedDay)
  }

  return (
    <div className="max-w-7xl mx-auto">
      <Tabs value={selectedDay.toString()} onValueChange={(value) => setSelectedDay(parseInt(value))}>
        {/* Вкладки дней недели */}
        <div className="flex flex-col space-y-6">
          <div className="flex justify-center">
            <TabsList className="grid w-auto grid-cols-7 h-auto p-1">
              {WEEKDAYS.map((day, index) => (
                <TabsTrigger
                  key={day}
                  value={index.toString()}
                  className="data-[state=active]:bg-primary data-[state=active]:text-primary-foreground px-3 py-2 text-xs sm:text-sm"
                >
                  <span className="hidden sm:block">{day}</span>
                  <span className="block sm:hidden">{WEEKDAYS_SHORT[index]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          {/* Контент для каждого дня */}
          {WEEKDAYS.map((day, index) => (
            <TabsContent key={day} value={index.toString()} className="space-y-4 mt-0">
              {/* Временная сетка */}
              <Card className="rounded-2xl border-2 overflow-hidden">
                <CardContent className="p-0">
                  <div 
                    id="schedule-time-grid"
                    className="relative bg-white dark:bg-gray-950 min-h-[600px] cursor-pointer"
                    style={{ height: HOUR_HEIGHT * HOURS.length }}
                    onClick={handleGridClick}
                  >
                    {/* Сетка времени */}
                    {HOURS.map((hour, hourIndex) => (
                      <div
                        key={hour}
                        className="absolute w-full border-b border-gray-200 dark:border-gray-800 flex items-start hover:bg-gray-50 dark:hover:bg-gray-900/50"
                        style={{ 
                          top: hourIndex * HOUR_HEIGHT,
                          height: HOUR_HEIGHT
                        }}
                      >
                        <div className="w-16 text-xs text-muted-foreground p-2 border-r border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
                          {hour}
                        </div>
                        <div className="flex-1 relative">
                          {/* Линии каждые 15 минут */}
                          {[15, 30, 45].map(minute => (
                            <div
                              key={minute}
                              className="absolute w-full border-b border-gray-100 dark:border-gray-800 opacity-30"
                              style={{ 
                                top: (minute / 60) * HOUR_HEIGHT,
                                height: '1px'
                              }}
                            />
                          ))}
                          {/* Дополнительные визуальные индикаторы для привязки */}
                          <div className="absolute inset-0 opacity-0 hover:opacity-10 transition-opacity">
                            {Array.from({ length: SLOTS_PER_HOUR }, (_, i) => (
                              <div
                                key={i}
                                className="absolute w-full bg-blue-200 dark:bg-blue-900"
                                style={{ 
                                  top: i * SLOT_HEIGHT,
                                  height: SLOT_HEIGHT,
                                  pointerEvents: 'none'
                                }}
                              />
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Блоки событий */}
                    {getSlotsForSelectedDay().map(slot => (
                      <div
                        key={slot.id}
                        data-event-id={slot.id}
                        className={cn(
                          "absolute left-16 right-4 rounded-lg border-2 shadow-sm cursor-move transition-shadow duration-200 group",
                          "hover:shadow-md select-none",
                          draggedItem?.id === slot.id ? "shadow-lg z-10" : "z-0"
                        )}
                        style={{
                          top: slot.top,
                          height: Math.max(slot.height, 30),
                          backgroundColor: slot.color + '20',
                          borderColor: slot.color,
                        }}
                        onMouseDown={(e) => handleMouseDown(e, slot)}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="p-2 h-full flex flex-col justify-between overflow-hidden">
                          <div className="flex items-start justify-between min-h-0">
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="font-medium text-sm truncate leading-tight" style={{ color: slot.color }}>
                                {slot.task}
                              </div>
                              <div className="text-xs text-muted-foreground truncate mt-0.5">
                                {slot.startTime} - {slot.endTime}
                              </div>
                            </div>
                            <div className="flex items-center flex-shrink-0">
                              <GripVertical className="h-3 w-3 text-muted-foreground opacity-50" />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </div>
      </Tabs>

      {/* Диалог создания события */}
      <Dialog open={showEventDialog} onOpenChange={setShowEventDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Создать событие</DialogTitle>
            <DialogDescription>
              Время: {clickPosition?.time} в {WEEKDAYS[selectedDay].toLowerCase()}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="title">Название события</Label>
              <Input
                id="title"
                placeholder="Встреча, задача..."
                value={newEvent.title}
                onChange={(e) => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="duration">Продолжительность</Label>
              <div className="grid gap-3">
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {[15, 30, 45, 60, 90, 120, 180, 240, 360, 480].map(duration => (
                    <Button
                      key={duration}
                      variant={newEvent.duration === duration && !newEvent.customDuration ? "default" : "outline"}
                      size="sm"
                      className="text-xs px-2 py-1 h-8 whitespace-nowrap"
                      onClick={() => setNewEvent(prev => ({ ...prev, duration, customDuration: '' }))}
                    >
                      {duration >= 60 ? `${Math.floor(duration/60)}ч${duration%60 > 0 ? ` ${duration%60}м` : ''}` : `${duration}м`}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <Label className="text-sm">Или укажите:</Label>
                  <Input
                    placeholder="120м или 2ч 30м"
                    value={newEvent.customDuration}
                    onChange={(e) => {
                      const value = e.target.value
                      setNewEvent(prev => ({ ...prev, customDuration: value }))
                      

                      if (value) {
                        const parsedDuration = parseCustomDuration(value)
                        setNewEvent(prev => ({ ...prev, duration: parsedDuration }))
                      }
                    }}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="color">Цвет</Label>
              <div className="flex space-x-2">
                {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'].map(color => (
                  <button
                    key={color}
                    className={cn(
                      "w-8 h-8 rounded-full border-2 border-gray-300",
                      newEvent.color === color && "border-gray-700 scale-110"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewEvent(prev => ({ ...prev, color }))}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEventDialog(false)}>
              Отмена
            </Button>
            <Button onClick={createEvent} disabled={!newEvent.title}>
              <Plus className="h-4 w-4 mr-1" />
              Создать событие
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог редактирования события */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Редактировать событие</DialogTitle>
            {editingEvent && (
              <DialogDescription>
                Время: {editingEvent.startTime} - {editingEvent.endTime} в {WEEKDAYS[selectedDay].toLowerCase()}
                <br />
                <span className="text-xs text-green-600">✓ Изменения сохраняются автоматически</span>
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="edit-title">Название события</Label>
              <Input
                id="edit-title"
                placeholder="Встреча, задача..."
                value={newEvent.title}
                onChange={(e) => setNewEvent(prev => ({ ...prev, title: e.target.value }))}
              />
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="edit-duration">Продолжительность</Label>
              <div className="grid gap-3">
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                  {[15, 30, 45, 60, 90, 120, 180, 240, 360, 480].map(duration => (
                    <Button
                      key={duration}
                      variant={newEvent.duration === duration && !newEvent.customDuration ? "default" : "outline"}
                      size="sm"
                      className="text-xs px-2 py-1 h-8 whitespace-nowrap"
                      onClick={() => setNewEvent(prev => ({ ...prev, duration, customDuration: '' }))}
                    >
                      {duration >= 60 ? `${Math.floor(duration/60)}ч${duration%60 > 0 ? ` ${duration%60}м` : ''}` : `${duration}м`}
                    </Button>
                  ))}
                </div>
                <div className="flex gap-2 items-center">
                  <Label className="text-sm">Или укажите:</Label>
                  <Input
                    placeholder="120м или 2ч 30м"
                    value={newEvent.customDuration}
                    onChange={(e) => {
                      const value = e.target.value
                      setNewEvent(prev => ({ ...prev, customDuration: value }))
                      
                      if (value) {
                        const parsedDuration = parseCustomDuration(value)
                        setNewEvent(prev => ({ ...prev, duration: parsedDuration }))
                      }
                    }}
                    className="flex-1"
                  />
                </div>
              </div>
            </div>
            
            <div className="grid gap-2">
              <Label htmlFor="edit-color">Цвет</Label>
              <div className="flex space-x-2">
                {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'].map(color => (
                  <button
                    key={color}
                    className={cn(
                      "w-8 h-8 rounded-full border-2 border-gray-300",
                      newEvent.color === color && "border-gray-700 scale-110"
                    )}
                    style={{ backgroundColor: color }}
                    onClick={() => setNewEvent(prev => ({ ...prev, color }))}
                  />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setShowEditDialog(false)
              setEditingEvent(null)
            }}>
              Закрыть
            </Button>
            <Button 
              variant="destructive" 
              onClick={() => {
                if (editingEvent) {
                  removeTimeSlot(editingEvent.id)
                  setShowEditDialog(false)
                  setEditingEvent(null)
                }
              }}
            >
              <X className="h-4 w-4 mr-1" />
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
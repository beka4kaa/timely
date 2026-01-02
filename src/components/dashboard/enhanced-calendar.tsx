"use client"

import React, { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  X,
  Play,
  Check,
  SkipForward
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ScheduleBlock {
  id: string
  dayOfWeek: number
  startTime: string
  endTime: string
  task: string
  color: string
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'
  subjectEmoji?: string
  subjectName?: string
}

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
]

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export function EnhancedCalendarComponent() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([])

  // Load schedule blocks from DB
  useEffect(() => {
    const loadBlocks = async () => {
      try {
        const res = await fetch('/api/schedule')
        if (res.ok) {
          const blocks = await res.json()
          setScheduleBlocks(blocks)
        }
      } catch (e) { console.error(e) }
    }
    loadBlocks()
  }, [])

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

  // Get schedule blocks for a specific day of week
  const getBlocksForDayOfWeek = (dayOfWeek: number) => {
    return scheduleBlocks.filter(block => block.dayOfWeek === dayOfWeek)
  }

  // Get day of week for a calendar date (0 = Monday)
  const getDayOfWeek = (day: number): number => {
    const date = new Date(year, month, day)
    const dayOfWeek = date.getDay()
    return dayOfWeek === 0 ? 6 : dayOfWeek - 1
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

  // Get status color
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'bg-emerald-500'
      case 'IN_PROGRESS': return 'bg-blue-500'
      case 'SKIPPED': return 'bg-gray-400'
      default: return 'bg-orange-400'
    }
  }

  // Select date
  const selectDate = (day: number) => {
    const newDate = new Date(year, month, day)
    setSelectedDate(newDate)
  }

  // Get blocks for selected date
  const getSelectedDayBlocks = () => {
    if (!selectedDate) return []
    const dayOfWeek = selectedDate.getDay()
    const normalizedDay = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    return scheduleBlocks.filter(b => b.dayOfWeek === normalizedDay)
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

        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-orange-400" />
            <span>Pending</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span>In Progress</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>Completed</span>
          </div>
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
                  const dayOfWeek = day ? getDayOfWeek(day) : -1
                  const dayBlocks = day ? getBlocksForDayOfWeek(dayOfWeek) : []
                  const hasBlocks = dayBlocks.length > 0

                  return (
                    <div
                      key={index}
                      className={cn(
                        "min-h-[80px] p-2 rounded-xl hover:bg-muted/50 cursor-pointer transition-all duration-200 relative border-2 border-transparent",
                        day && "hover:bg-muted hover:border-primary/20",
                        !day && "cursor-default hover:bg-transparent",
                        day && isSelected(day) && "border-primary bg-primary/5",
                        hasBlocks && "bg-gradient-to-br from-blue-50/50 to-purple-50/50 dark:from-blue-950/20 dark:to-purple-950/20"
                      )}
                      onClick={() => day && selectDate(day)}
                    >
                      {day && (
                        <>
                          <div className={cn(
                            "text-sm font-medium mb-1 flex items-center justify-center",
                            isToday(day) && "bg-primary text-primary-foreground rounded-full w-6 h-6 text-xs",
                            isSelected(day) && !isToday(day) && "text-primary font-bold"
                          )}>
                            {day}
                          </div>

                          {/* Block indicators */}
                          <div className="space-y-1">
                            {dayBlocks.slice(0, 3).map(block => (
                              <div
                                key={block.id}
                                className="flex items-center gap-1 px-1"
                              >
                                <div className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", getStatusColor(block.status))} />
                                <span className="text-[10px] truncate text-muted-foreground">
                                  {block.startTime.slice(0, 5)}
                                </span>
                              </div>
                            ))}

                            {dayBlocks.length > 3 && (
                              <div className="text-[10px] text-muted-foreground text-center">
                                +{dayBlocks.length - 3} more
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

        {/* Day Details Panel */}
        <div className="space-y-4">
          {selectedDate ? (
            <Card className="rounded-2xl border-2">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center justify-between text-base">
                  <div className="flex items-center space-x-2">
                    <CalendarIcon className="h-4 w-4" />
                    <span>
                      {selectedDate.getDate()} {MONTHS[selectedDate.getMonth()]}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      {WEEKDAYS[selectedDate.getDay() === 0 ? 6 : selectedDate.getDay() - 1]}
                    </Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedDate(null)}
                    className="h-6 w-6 p-0"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {getSelectedDayBlocks().length > 0 ? (
                  getSelectedDayBlocks()
                    .sort((a, b) => a.startTime.localeCompare(b.startTime))
                    .map(block => (
                      <div
                        key={block.id}
                        className="p-3 rounded-xl border-2 transition-all"
                        style={{
                          borderLeftWidth: '4px',
                          borderLeftColor: block.color,
                          backgroundColor: block.color + '10'
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <div className={cn("w-2 h-2 rounded-full", getStatusColor(block.status))} />
                              <span className="text-xs text-muted-foreground">
                                {block.startTime} - {block.endTime}
                              </span>
                            </div>
                            <div className="font-medium text-sm truncate">{block.task}</div>
                            {block.subjectName && (
                              <div className="text-xs text-muted-foreground mt-1">
                                {block.subjectEmoji} {block.subjectName}
                              </div>
                            )}
                          </div>
                          <Badge
                            variant="secondary"
                            className={cn(
                              "text-xs capitalize",
                              block.status === 'COMPLETED' && "bg-emerald-100 text-emerald-700",
                              block.status === 'IN_PROGRESS' && "bg-blue-100 text-blue-700",
                              block.status === 'SKIPPED' && "bg-gray-100 text-gray-600"
                            )}
                          >
                            {block.status === 'IN_PROGRESS' ? 'Active' :
                              block.status === 'COMPLETED' ? 'Done' :
                                block.status === 'SKIPPED' ? 'Skipped' : 'Pending'}
                          </Badge>
                        </div>
                      </div>
                    ))
                ) : (
                  <div className="text-center text-muted-foreground py-8">
                    <Clock className="h-8 w-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">No blocks scheduled for this day</p>
                    <p className="text-xs mt-1">Go to Study Planner to add blocks</p>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-2xl border-2 border-dashed">
              <CardContent className="py-12 text-center">
                <CalendarIcon className="h-8 w-8 mx-auto mb-3 text-muted-foreground opacity-50" />
                <p className="text-sm text-muted-foreground">Select a day to view schedule</p>
              </CardContent>
            </Card>
          )}

          {/* Weekly summary */}
          <Card className="rounded-2xl border-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Weekly Template</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-1">
                {WEEKDAYS.map((day, i) => {
                  const blocks = getBlocksForDayOfWeek(i)
                  const completed = blocks.filter(b => b.status === 'COMPLETED').length
                  const total = blocks.length

                  return (
                    <div key={day} className="text-center">
                      <div className="text-xs text-muted-foreground mb-1">{day}</div>
                      <div className={cn(
                        "text-lg font-semibold",
                        total === 0 && "text-muted-foreground",
                        completed === total && total > 0 && "text-emerald-600"
                      )}>
                        {total > 0 ? `${completed}/${total}` : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

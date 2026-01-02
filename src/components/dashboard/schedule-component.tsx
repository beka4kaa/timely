"use client"

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Plus,
  Loader2,
  GripVertical,
  Play,
  Check,
  SkipForward,
  Trash2,
  Sparkles,
  RefreshCw,
  ArrowRight
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type BlockStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'SKIPPED'

interface TimeSlot {
  id: string
  startTime: string
  endTime: string
  task: string
  color: string
  dayOfWeek: number
  top: number
  height: number
  status: BlockStatus
  subjectEmoji?: string
  subjectName?: string
}

interface AISuggestion {
  id: string
  task: string
  subjectName: string
  subjectEmoji: string
  duration: number
  color: string
  priority: 'high' | 'medium' | 'low'
}

interface DragState {
  type: 'suggestion' | 'slot' | 'resize'
  id: string
  startY: number
  currentY: number
  offsetY: number
  suggestion?: AISuggestion
  slot?: TimeSlot
  resizeDirection?: 'top' | 'bottom'
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
const HOURS = Array.from({ length: 18 }, (_, i) => `${(i + 6).toString().padStart(2, '0')}:00`)
const HOUR_HEIGHT = 60
const SLOT_HEIGHT = 15
const MIN_BLOCK_HEIGHT = 30

export function ScheduleComponent() {
  const [selectedDay, setSelectedDay] = useState(() => {
    const today = new Date().getDay()
    return today === 0 ? 6 : today - 1
  })
  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([])
  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion[]>([])
  const [loadingAI, setLoadingAI] = useState(false)
  const [loadingSchedule, setLoadingSchedule] = useState(true)
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [showEventDialog, setShowEventDialog] = useState(false)
  const [clickPosition, setClickPosition] = useState<{ y: number; time: string } | null>(null)
  const [newEvent, setNewEvent] = useState({ title: '', duration: 60, color: '#3b82f6' })

  const gridRef = useRef<HTMLDivElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const [ghostPosition, setGhostPosition] = useState<{ x: number; y: number } | null>(null)

  // Load schedule from DB on mount
  useEffect(() => {
    loadSchedule()
    loadAISuggestions()
  }, [])

  const loadSchedule = async () => {
    try {
      const res = await fetch('/api/schedule')
      if (res.ok) {
        const blocks = await res.json()
        const slots: TimeSlot[] = blocks.map((b: { id: string; dayOfWeek: number; startTime: string; endTime: string; task: string; color: string; status: string; subjectEmoji?: string; subjectName?: string }) => ({
          ...b,
          top: timeToPosition(b.startTime),
          height: (timeToMinutes(b.endTime) - timeToMinutes(b.startTime)) / 60 * HOUR_HEIGHT,
          status: b.status as BlockStatus
        }))
        setTimeSlots(slots)
      }
    } catch (e) { console.error(e) }
    setLoadingSchedule(false)
  }

  const loadAISuggestions = async () => {
    try {
      const res = await fetch('/api/ai/daily-tasks')
      if (res.ok) {
        const data = await res.json()
        if (data.tasks?.length > 0) {
          setAiSuggestions(data.tasks.map((t: { subjectEmoji: string; subjectName: string; topicName: string; hours: number; priority: 'high' | 'medium' | 'low' }, i: number) => ({
            id: `sug-${i}`,
            task: t.topicName,
            subjectName: t.subjectName,
            subjectEmoji: t.subjectEmoji,
            duration: t.hours * 60,
            color: t.priority === 'high' ? '#ef4444' : t.priority === 'medium' ? '#f59e0b' : '#3b82f6',
            priority: t.priority
          })))
        }
      }
    } catch (e) { console.error(e) }
  }

  const generateNewSuggestions = async () => {
    setLoadingAI(true)
    try {
      const res = await fetch('/api/ai/daily-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh: true })
      })
      if (res.ok) {
        const data = await res.json()
        if (data.tasks?.length > 0) {
          setAiSuggestions(data.tasks.map((t: { subjectEmoji: string; subjectName: string; topicName: string; hours: number; priority: 'high' | 'medium' | 'low' }, i: number) => ({
            id: `sug-${Date.now()}-${i}`,
            task: t.topicName,
            subjectName: t.subjectName,
            subjectEmoji: t.subjectEmoji,
            duration: t.hours * 60,
            color: t.priority === 'high' ? '#ef4444' : t.priority === 'medium' ? '#f59e0b' : '#3b82f6',
            priority: t.priority
          })))
        }
      }
    } catch (e) { console.error(e) }
    setLoadingAI(false)
  }

  const timeToMinutes = (time: string): number => {
    const [h, m] = time.split(':').map(Number)
    return h * 60 + m
  }

  const timeToPosition = (time: string): number => {
    const [h, m] = time.split(':').map(Number)
    return ((h - 6) * 60 + m) / 15 * SLOT_HEIGHT
  }

  const positionToTime = (pos: number): string => {
    const slot = Math.round(pos / SLOT_HEIGHT)
    const mins = slot * 15 + 6 * 60
    const h = Math.floor(mins / 60)
    const m = mins % 60
    if (h > 23) return '23:45'
    if (h < 6) return '06:00'
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
  }

  const calcEndTime = (start: string, dur: number): string => {
    const [h, m] = start.split(':').map(Number)
    const total = h * 60 + m + dur
    const eh = Math.floor(total / 60)
    const em = total % 60
    if (eh > 23) return '23:59'
    return `${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}`
  }

  const getSlotsForDay = useCallback(() =>
    timeSlots.filter(s => s.dayOfWeek === selectedDay), [timeSlots, selectedDay])

  // Save block to DB
  const saveBlock = async (block: Omit<TimeSlot, 'top' | 'height'>) => {
    try {
      const res = await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dayOfWeek: block.dayOfWeek,
          startTime: block.startTime,
          endTime: block.endTime,
          task: block.task,
          color: block.color,
          status: block.status,
          subjectEmoji: block.subjectEmoji,
          subjectName: block.subjectName
        })
      })
      if (res.ok) {
        const saved = await res.json()
        return saved.id
      }
    } catch (e) { console.error(e) }
    return null
  }

  // Update block in DB
  const updateBlockInDB = async (id: string, data: Partial<TimeSlot>) => {
    try {
      await fetch(`/api/schedule/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
    } catch (e) { console.error(e) }
  }

  // Delete block from DB
  const deleteBlockFromDB = async (id: string) => {
    try {
      await fetch(`/api/schedule/${id}`, { method: 'DELETE' })
    } catch (e) { console.error(e) }
  }

  const handleGridClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-event-id]')) return
    if (dragState) return

    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    setClickPosition({ y, time: positionToTime(y) })
    setShowEventDialog(true)
  }

  const createEvent = async () => {
    if (!newEvent.title || !clickPosition) return

    const startTime = positionToTime(clickPosition.y)
    const endTime = calcEndTime(startTime, newEvent.duration)
    const top = timeToPosition(startTime)
    const height = (newEvent.duration / 60) * HOUR_HEIGHT

    const tempId = `temp-${Date.now()}`
    const newSlot: TimeSlot = {
      id: tempId,
      startTime,
      endTime,
      task: newEvent.title,
      color: newEvent.color,
      dayOfWeek: selectedDay,
      top,
      height,
      status: 'PENDING'
    }

    setTimeSlots(prev => [...prev, newSlot])
    setShowEventDialog(false)
    setClickPosition(null)
    setNewEvent({ title: '', duration: 60, color: '#3b82f6' })

    // Save to DB
    const savedId = await saveBlock(newSlot)
    if (savedId) {
      setTimeSlots(prev => prev.map(s => s.id === tempId ? { ...s, id: savedId } : s))
    }
  }

  const removeSlot = async (id: string) => {
    setTimeSlots(prev => prev.filter(s => s.id !== id))
    await deleteBlockFromDB(id)
  }

  const updateSlotStatus = async (id: string, status: BlockStatus) => {
    setTimeSlots(prev => prev.map(s => s.id === id ? { ...s, status } : s))
    await updateBlockInDB(id, { status })
  }

  // Drag handlers
  const handleSuggestionMouseDown = (e: React.MouseEvent, sug: AISuggestion) => {
    e.preventDefault()
    setDragState({
      type: 'suggestion',
      id: sug.id,
      startY: e.clientY,
      currentY: e.clientY,
      offsetY: 0,
      suggestion: sug
    })
    setGhostPosition({ x: e.clientX, y: e.clientY })
  }

  const handleSlotMouseDown = (e: React.MouseEvent, slot: TimeSlot) => {
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    setDragState({
      type: 'slot',
      id: slot.id,
      startY: e.clientY,
      currentY: e.clientY,
      offsetY: e.clientY - rect.top,
      slot
    })
  }

  const handleResizeMouseDown = (e: React.MouseEvent, slot: TimeSlot, dir: 'top' | 'bottom') => {
    e.stopPropagation()
    e.preventDefault()
    setDragState({
      type: 'resize',
      id: slot.id,
      startY: e.clientY,
      currentY: e.clientY,
      offsetY: 0,
      slot,
      resizeDirection: dir
    })
  }

  useEffect(() => {
    if (!dragState) return

    const handleMouseMove = (e: MouseEvent) => {
      setDragState(prev => prev ? { ...prev, currentY: e.clientY } : null)

      if (dragState.type === 'suggestion') {
        setGhostPosition({ x: e.clientX, y: e.clientY })
      }

      if (dragState.type === 'resize' && gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect()
        const mouseY = e.clientY - rect.top
        const snappedY = Math.round(mouseY / SLOT_HEIGHT) * SLOT_HEIGHT

        setTimeSlots(prev => prev.map(s => {
          if (s.id !== dragState.id) return s

          if (dragState.resizeDirection === 'top') {
            const newTop = Math.max(0, Math.min(snappedY, s.top + s.height - MIN_BLOCK_HEIGHT))
            const newHeight = s.top + s.height - newTop
            return { ...s, top: newTop, height: newHeight, startTime: positionToTime(newTop) }
          } else {
            const newHeight = Math.max(MIN_BLOCK_HEIGHT, snappedY - s.top)
            const dur = Math.round((newHeight / HOUR_HEIGHT) * 60)
            return { ...s, height: newHeight, endTime: calcEndTime(s.startTime, dur) }
          }
        }))
      }

      if (dragState.type === 'slot' && gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect()
        const rawY = e.clientY - rect.top - dragState.offsetY
        const snappedY = Math.max(0, Math.round(rawY / SLOT_HEIGHT) * SLOT_HEIGHT)

        setTimeSlots(prev => prev.map(s => {
          if (s.id !== dragState.id) return s
          const duration = Math.round((s.height / HOUR_HEIGHT) * 60)
          const newStart = positionToTime(snappedY)
          return { ...s, top: snappedY, startTime: newStart, endTime: calcEndTime(newStart, duration) }
        }))
      }
    }

    const handleMouseUp = async (e: MouseEvent) => {
      if (!dragState) return

      // Drop suggestion onto grid
      if (dragState.type === 'suggestion' && dragState.suggestion && gridRef.current) {
        const rect = gridRef.current.getBoundingClientRect()
        const mouseX = e.clientX
        const mouseY = e.clientY - rect.top

        if (mouseX >= rect.left && mouseX <= rect.right && mouseY >= 0 && mouseY <= HOURS.length * HOUR_HEIGHT) {
          const snappedY = Math.round(mouseY / SLOT_HEIGHT) * SLOT_HEIGHT
          const sug = dragState.suggestion
          const startTime = positionToTime(snappedY)
          const endTime = calcEndTime(startTime, sug.duration)
          const height = (sug.duration / 60) * HOUR_HEIGHT

          const tempId = `temp-${Date.now()}`
          const newSlot: TimeSlot = {
            id: tempId,
            startTime,
            endTime,
            task: `${sug.subjectEmoji} ${sug.task}`,
            color: sug.color,
            dayOfWeek: selectedDay,
            top: snappedY,
            height,
            status: 'PENDING',
            subjectEmoji: sug.subjectEmoji,
            subjectName: sug.subjectName
          }

          setTimeSlots(prev => [...prev, newSlot])
          setAiSuggestions(prev => prev.filter(s => s.id !== sug.id))

          // Save to DB
          const savedId = await saveBlock(newSlot)
          if (savedId) {
            setTimeSlots(prev => prev.map(s => s.id === tempId ? { ...s, id: savedId } : s))
          }
        }
      }

      // Drag slot back to suggestions
      if (dragState.type === 'slot' && dragState.slot && suggestionsRef.current) {
        const rect = suggestionsRef.current.getBoundingClientRect()
        if (e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
          const slot = timeSlots.find(s => s.id === dragState.slot?.id)
          if (slot) {
            const duration = Math.round((slot.height / HOUR_HEIGHT) * 60)

            setAiSuggestions(prev => [...prev, {
              id: `returned-${Date.now()}`,
              task: slot.task.replace(/^[^\s]+\s/, ''),
              subjectName: slot.subjectName || 'Task',
              subjectEmoji: slot.subjectEmoji || '📚',
              duration,
              color: slot.color,
              priority: 'medium'
            }])

            setTimeSlots(prev => prev.filter(s => s.id !== slot.id))
            await deleteBlockFromDB(slot.id)
          }
        } else {
          // Save updated position to DB
          const slot = timeSlots.find(s => s.id === dragState.id)
          if (slot) {
            await updateBlockInDB(slot.id, { startTime: slot.startTime, endTime: slot.endTime })
          }
        }
      }

      // Save resize to DB
      if (dragState.type === 'resize') {
        const slot = timeSlots.find(s => s.id === dragState.id)
        if (slot) {
          await updateBlockInDB(slot.id, { startTime: slot.startTime, endTime: slot.endTime })
        }
      }

      setDragState(null)
      setGhostPosition(null)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState, selectedDay, timeSlots])

  const getStatusStyles = (status: BlockStatus, color: string) => {
    switch (status) {
      case 'IN_PROGRESS': return { bg: color + '40', border: color, ring: true }
      case 'COMPLETED': return { bg: '#10b98140', border: '#10b981', opacity: 0.8 }
      case 'SKIPPED': return { bg: '#6b728040', border: '#6b7280', opacity: 0.5, strike: true }
      default: return { bg: color + '25', border: color }
    }
  }

  if (loadingSchedule) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex gap-4">
      {/* Ghost element */}
      {ghostPosition && dragState?.type === 'suggestion' && dragState.suggestion && (
        <div
          className="fixed pointer-events-none z-50 opacity-90 transform -translate-x-1/2 -translate-y-1/2"
          style={{ left: ghostPosition.x, top: ghostPosition.y }}
        >
          <div
            className="p-3 rounded-lg border-2 shadow-2xl min-w-[180px] backdrop-blur-sm"
            style={{ backgroundColor: dragState.suggestion.color + '40', borderColor: dragState.suggestion.color }}
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">{dragState.suggestion.subjectEmoji}</span>
              <div>
                <p className="font-medium text-sm">{dragState.suggestion.task}</p>
                <p className="text-xs text-muted-foreground">{dragState.suggestion.subjectName}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SCHEDULE GRID - NOW ON LEFT */}
      <div className="flex-1">
        <div className="flex items-center justify-center mb-4">
          <div className="flex bg-muted rounded-lg p-1">
            {WEEKDAYS.map((day, i) => (
              <button
                key={day}
                onClick={() => setSelectedDay(i)}
                className={cn(
                  "px-4 py-1.5 rounded-md text-sm font-medium transition-colors",
                  selectedDay === i ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {day}
              </button>
            ))}
          </div>
        </div>

        <Card className="rounded-xl border-2 overflow-hidden">
          <CardContent className="p-0">
            <div
              ref={gridRef}
              id="schedule-time-grid"
              className="relative bg-card min-h-[600px]"
              style={{ height: HOUR_HEIGHT * HOURS.length }}
              onClick={handleGridClick}
            >
              {HOURS.map((hour, i) => (
                <div
                  key={hour}
                  className="absolute w-full border-b border-border flex items-start hover:bg-accent/20 cursor-pointer"
                  style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                >
                  <div className="w-14 text-xs text-muted-foreground p-2 border-r border-border bg-muted/30">{hour}</div>
                  <div className="flex-1 relative">
                    {[15, 30, 45].map(m => (
                      <div key={m} className="absolute w-full border-b border-border/20" style={{ top: (m / 60) * HOUR_HEIGHT }} />
                    ))}
                  </div>
                </div>
              ))}

              {getSlotsForDay().map(slot => {
                const styles = getStatusStyles(slot.status, slot.color)
                return (
                  <div
                    key={slot.id}
                    data-event-id={slot.id}
                    className={cn(
                      "absolute left-14 right-2 rounded-lg border-2 shadow-sm transition-all duration-150 group select-none",
                      dragState?.id === slot.id && dragState.type === 'slot' && "opacity-50 shadow-xl z-20",
                      styles.ring && "ring-2 ring-offset-2 ring-offset-background"
                    )}
                    style={{
                      top: slot.top,
                      height: Math.max(slot.height, MIN_BLOCK_HEIGHT),
                      backgroundColor: styles.bg,
                      borderColor: styles.border,
                      opacity: styles.opacity,
                      ...(styles.ring && { '--tw-ring-color': slot.color } as React.CSSProperties)
                    }}
                    onMouseDown={(e) => handleSlotMouseDown(e, slot)}
                  >
                    <div className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white/20" onMouseDown={(e) => handleResizeMouseDown(e, slot, 'top')} />
                    <div className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-white/20" onMouseDown={(e) => handleResizeMouseDown(e, slot, 'bottom')} />

                    <div className="p-2 h-full flex flex-col justify-between overflow-hidden cursor-move">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0 pr-2">
                          <div className={cn("font-medium text-sm truncate", styles.strike && "line-through")} style={{ color: styles.border }}>{slot.task}</div>
                          <div className="text-xs text-muted-foreground truncate">{slot.startTime} - {slot.endTime}</div>
                        </div>
                        <GripVertical className="h-3 w-3 text-muted-foreground opacity-50 flex-shrink-0" />
                      </div>

                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button size="icon" variant={slot.status === 'IN_PROGRESS' ? 'default' : 'ghost'} className="h-6 w-6 rounded" onClick={(e) => { e.stopPropagation(); updateSlotStatus(slot.id, 'IN_PROGRESS') }}><Play className="h-3 w-3" /></Button>
                        <Button size="icon" variant={slot.status === 'COMPLETED' ? 'default' : 'ghost'} className={cn("h-6 w-6 rounded", slot.status === 'COMPLETED' && "bg-emerald-600")} onClick={(e) => { e.stopPropagation(); updateSlotStatus(slot.id, 'COMPLETED') }}><Check className="h-3 w-3" /></Button>
                        <Button size="icon" variant={slot.status === 'SKIPPED' ? 'default' : 'ghost'} className={cn("h-6 w-6 rounded", slot.status === 'SKIPPED' && "bg-gray-600")} onClick={(e) => { e.stopPropagation(); updateSlotStatus(slot.id, 'SKIPPED') }}><SkipForward className="h-3 w-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 rounded text-red-500 hover:bg-red-500/10" onClick={(e) => { e.stopPropagation(); removeSlot(slot.id) }}><Trash2 className="h-3 w-3" /></Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* AI SUGGESTIONS - NOW ON RIGHT */}
      <div className="w-64 flex-shrink-0" ref={suggestionsRef}>
        <Card className="sticky top-4 border-dashed border-2 transition-colors" style={{ borderColor: dragState?.type === 'slot' ? '#3b82f6' : undefined }}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-purple-500" />
                <CardTitle className="text-sm">AI Tasks</CardTitle>
              </div>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={generateNewSuggestions} disabled={loadingAI}>
                {loadingAI ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {dragState?.type === 'slot' ? (
                <span className="text-blue-500">← Drop here to return</span>
              ) : (
                <span className="flex items-center gap-1">← Drag to schedule</span>
              )}
            </p>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[500px] overflow-y-auto">
            {loadingAI && aiSuggestions.length === 0 && (
              <div className="flex items-center justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            )}

            {!loadingAI && aiSuggestions.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">Click refresh to generate</p>
            )}

            {aiSuggestions.map(sug => (
              <div
                key={sug.id}
                className={cn(
                  "p-2.5 rounded-lg border-2 cursor-grab active:cursor-grabbing transition-all hover:shadow-md hover:scale-[1.02]",
                  dragState?.id === sug.id && "opacity-30 scale-95"
                )}
                style={{ backgroundColor: sug.color + '15', borderColor: sug.color + '50' }}
                onMouseDown={(e) => handleSuggestionMouseDown(e, sug)}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">{sug.subjectEmoji}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{sug.task}</p>
                    <p className="text-xs text-muted-foreground">{sug.subjectName}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between mt-1.5">
                  <Badge variant="secondary" className="text-xs" style={{ backgroundColor: sug.color + '20', color: sug.color }}>
                    {sug.duration >= 60 ? `${Math.floor(sug.duration / 60)}h${sug.duration % 60 > 0 ? ` ${sug.duration % 60}m` : ''}` : `${sug.duration}m`}
                  </Badge>
                  <GripVertical className="h-3 w-3 text-muted-foreground" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Create Dialog */}
      <Dialog open={showEventDialog} onOpenChange={setShowEventDialog}>
        <DialogContent className="sm:max-w-[380px]">
          <DialogHeader>
            <DialogTitle>New Block</DialogTitle>
            <DialogDescription>Time: {clickPosition?.time} • {WEEKDAYS[selectedDay]}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>Title</Label>
              <Input placeholder="Task name..." value={newEvent.title} onChange={(e) => setNewEvent(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label>Duration</Label>
              <div className="grid grid-cols-5 gap-2">
                {[30, 60, 90, 120, 180].map(d => (
                  <Button key={d} variant={newEvent.duration === d ? "default" : "outline"} size="sm" onClick={() => setNewEvent(p => ({ ...p, duration: d }))}>
                    {d >= 60 ? `${d / 60}h` : `${d}m`}
                  </Button>
                ))}
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'].map(c => (
                  <button key={c} className={cn("w-7 h-7 rounded-full border-2", newEvent.color === c ? "border-foreground scale-110" : "border-transparent")} style={{ backgroundColor: c }} onClick={() => setNewEvent(p => ({ ...p, color: c }))} />
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEventDialog(false)}>Cancel</Button>
            <Button onClick={createEvent} disabled={!newEvent.title}><Plus className="h-4 w-4 mr-1" />Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
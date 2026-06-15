"use client"

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { motion, AnimatePresence, useMotionValue, useDragControls, animate as fmAnimate } from 'framer-motion'
import { X, CheckCircle2, Circle, Plus, Trash2, Ban, GitBranch, Calendar, Link2, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCENT_GRADIENT } from '@/components/habits/lib'
import type { GoalNode, GoalPriority } from '@/types/goals'
import { useGoalsStore } from '@/stores/goals-store'
import { STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, formatMoney } from '../utils/goalColors'
import { GoalDatePicker } from './GoalDatePicker'
import { calculateGoalProgress, getActiveBlockers } from '../utils/calculateProgress'

export function GoalMiniInspector() {
  const selectedGoalId = useGoalsStore(s => s.selectedGoalId)
  const goals = useGoalsStore(s => s.goals)
  const links = useGoalsStore(s => s.links)
  const selectGoal = useGoalsStore(s => s.selectGoal)
  const updateGoal = useGoalsStore(s => s.updateGoal)
  const deleteGoal = useGoalsStore(s => s.deleteGoal)
  const createGoal = useGoalsStore(s => s.createGoal)
  const toggleTaskDone = useGoalsStore(s => s.toggleTaskDone)
  const createLink = useGoalsStore(s => s.createLink)

  const goal = selectedGoalId ? goals.find(g => g.id === selectedGoalId) ?? null : null
  const [title, setTitle] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [desc, setDesc] = useState('')
  const [linkSearch, setLinkSearch] = useState('')
  const [showLinkSearch, setShowLinkSearch] = useState(false)
  const linkInputRef = useRef<HTMLInputElement>(null)
  const descRef = useRef<HTMLTextAreaElement>(null)
  const sheetY = useMotionValue(0)
  const dragControls = useDragControls()

  useEffect(() => setTitle(goal?.title ?? ''), [goal?.id, goal?.title])
  useEffect(() => setDesc(goal?.description ?? ''), [goal?.id, goal?.description])
  // Leave edit mode whenever a different goal is selected.
  useEffect(() => setEditingTitle(false), [goal?.id])
  // Reset sheet position when a new goal is opened.
  useEffect(() => { sheetY.set(0) }, [goal?.id, sheetY])

  // Grow the description box to fit its content (Notion-like, no inner scrollbar).
  const autoGrow = useCallback(() => {
    const el = descRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 460)}px`
  }, [])
  useEffect(() => { autoGrow() }, [desc, goal?.id, autoGrow])

  const handleSheetDragEnd = (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
    if (typeof window !== 'undefined' && window.innerWidth >= 640) return
    if (info.offset.y > 80 || info.velocity.y > 400) {
      selectGoal(null)
    } else {
      fmAnimate(sheetY, 0, { type: 'spring', stiffness: 400, damping: 40 })
    }
  }

  const commitTitle = () => {
    if (!goal) return
    const next = title.trim()
    if (next && next !== goal.title) updateGoal(goal.id, { title: next })
    else setTitle(goal.title)   // revert empty/unchanged
    setEditingTitle(false)
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') selectGoal(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectGoal])

  const children = useMemo(
    () => goal ? goals.filter(g => g.parentId === goal.id) : [],
    [goal, goals],
  )
  const progress = useMemo(() => goal ? calculateGoalProgress(goal.id, goals) : 0, [goal, goals])
  const blockedBy = useMemo(() => goal ? getActiveBlockers(goal.id, goals, links) : [], [goal, goals, links])
  const goalsById = useMemo(() => new Map(goals.map(g => [g.id, g])), [goals])
  const dependsOn = useMemo(
    () => goal
      ? links
          .filter(l => l.source === goal.id && l.type === 'depends_on')
          .map(l => goalsById.get(l.target))
          .filter((g): g is GoalNode => !!g)
      : [],
    [goal, links, goalsById],
  )

  const linkedIds = useMemo(
    () => new Set(goal ? [goal.id, ...blockedBy.map(g => g.id), ...dependsOn.map(g => g.id)] : []),
    [goal, blockedBy, dependsOn],
  )
  const linkCandidates = useMemo(
    () => goals.filter(
      g => !linkedIds.has(g.id) && g.status !== 'archived' &&
        (linkSearch.trim() === '' || g.title.toLowerCase().includes(linkSearch.toLowerCase()))
    ),
    [goals, linkedIds, linkSearch],
  )

  return (
    <AnimatePresence>
      {goal && (
        <motion.div
          key="goal-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 max-sm:p-0 max-sm:items-end"
        >
          {/* Dim backdrop — click to close */}
          <button
            aria-label="Закрыть"
            onClick={() => selectGoal(null)}
            className="absolute inset-0 bg-slate-900/30 dark:bg-black/55 backdrop-blur-[3px] max-sm:backdrop-blur-none"
          />

          {/* Notion-style page card */}
          <motion.div
            key={goal.id}
            initial={{ opacity: 0, y: 24, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.985 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            style={{ y: sheetY }}
            drag="y"
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0 }}
            dragElastic={{ top: 0, bottom: 0.15 }}
            dragMomentum={false}
            onDragEnd={handleSheetDragEnd}
            className={cn(
              'relative z-10 flex flex-col w-full max-w-xl max-h-[86vh] will-change-transform',
              'max-sm:max-w-none max-sm:max-h-[90vh] max-sm:rounded-b-none',
              'rounded-3xl overflow-hidden',
              'bg-white/95 dark:bg-[#0e0e14]/95 backdrop-blur-2xl max-sm:backdrop-blur-none',
              'border border-black/[0.06] dark:border-white/[0.10]',
              'shadow-[0_24px_80px_-16px_rgba(15,23,42,0.40)] dark:shadow-[0_20px_70px_rgba(0,0,0,0.6)]',
            )}
          >
            {/* Mobile drag handle — only this area initiates swipe-to-close */}
            <div
              className="sm:hidden flex justify-center pt-2.5 pb-1 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
              onPointerDown={e => dragControls.start(e)}
            >
              <span className="h-1 w-9 rounded-full bg-foreground/20" />
            </div>

            {/* Header */}
            <div className="shrink-0 flex items-start gap-3 px-5 max-sm:px-4 pt-4 max-sm:pt-3 pb-3">
              <div className="flex-1 min-w-0">
                {editingTitle ? (
                  <input
                    autoFocus
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    onFocus={e => e.currentTarget.select()}
                    onBlur={commitTitle}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); commitTitle() }
                      if (e.key === 'Escape') { e.preventDefault(); setTitle(goal.title); setEditingTitle(false) }
                    }}
                    placeholder="Название цели…"
                    className="w-full bg-foreground/[0.04] border border-foreground/10 rounded-xl px-3 py-2 text-xl max-sm:text-lg font-bold tracking-tight text-foreground outline-none focus:border-pink-400/50 focus:bg-foreground/[0.06] transition-colors placeholder:text-muted-foreground/40 placeholder:font-normal"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingTitle(true)}
                    title="Нажми, чтобы изменить название"
                    className="group/title w-full text-left rounded-xl px-3 -mx-3 py-2 -my-1 text-xl max-sm:text-lg font-bold tracking-tight text-foreground hover:bg-foreground/[0.04] transition-colors"
                  >
                    <span className="decoration-pink-400/40 decoration-dotted underline-offset-[5px] group-hover/title:underline">
                      {goal.title || 'Без названия'}
                    </span>
                  </button>
                )}
                <div className="flex items-center gap-2 mt-2 px-0.5 flex-wrap">
                  <span className="text-[10px] font-medium text-muted-foreground bg-foreground/[0.05] px-1.5 py-0.5 rounded-md">
                    {goal.type === 'task' ? 'Задача' : 'Цель'}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[goal.status] }} />
                    {STATUS_LABEL[goal.status]}
                  </span>
                  {goal.type !== 'task' && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">· {progress}%</span>
                  )}
                </div>
              </div>
              <button
                onClick={() => selectGoal(null)}
                className="w-8 h-8 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto px-5 max-sm:px-4 pb-2 flex flex-col gap-4 min-h-0">
              {/* Progress */}
              {goal.type !== 'task' && (
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 h-1.5 rounded-full bg-foreground/[0.08] overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: ACCENT_GRADIENT }} />
                  </div>
                  <span className="text-[11px] font-semibold text-muted-foreground tabular-nums w-8 text-right">{progress}%</span>
                </div>
              )}

              {/* Financial */}
              {goal.type === 'financial_goal' && (
                <div className="rounded-xl bg-foreground/[0.03] border border-foreground/[0.07] px-3.5 py-3 flex items-center justify-between gap-3">
                  <span className="text-base font-semibold text-foreground">{formatMoney(goal.currentAmount ?? 0, goal.currency)}</span>
                  <span className="text-[11px] text-muted-foreground">из {formatMoney(goal.targetAmount ?? 0, goal.currency)}</span>
                </div>
              )}

              {/* Properties — deadline + priority, Notion-like */}
              <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-pink-500/80 dark:text-pink-300/70 mb-1.5 inline-flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Дедлайн
                  </p>
                  <GoalDatePicker
                    value={goal.dueDate}
                    onChange={iso => updateGoal(goal.id, { dueDate: iso })}
                    placeholder="Выбрать дату"
                    accent
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/55 mb-1.5">Приоритет</p>
                  <div className="grid grid-cols-4 gap-1">
                    {(['low', 'medium', 'high', 'critical'] as GoalPriority[]).map(p => (
                      <button
                        key={p}
                        onClick={() => updateGoal(goal.id, { priority: p })}
                        title={PRIORITY_LABEL[p]}
                        className={cn(
                          'py-1.5 rounded-lg text-[10px] font-medium border transition-colors',
                          goal.priority === p
                            ? 'border-foreground/25 bg-foreground/[0.08] text-foreground'
                            : 'border-foreground/[0.08] text-muted-foreground/70 hover:bg-foreground/[0.04]',
                        )}
                      >
                        {PRIORITY_LABEL[p].slice(0, 4)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Description — spacious, the heart of the page */}
              <div>
                <p className="text-[10px] uppercase tracking-wide text-muted-foreground/55 mb-1.5 inline-flex items-center gap-1">
                  <FileText className="w-3 h-3" /> Описание
                </p>
                <textarea
                  ref={descRef}
                  value={desc}
                  onChange={e => { setDesc(e.target.value); autoGrow() }}
                  onBlur={() => desc !== (goal.description ?? '') && updateGoal(goal.id, { description: desc })}
                  placeholder="Опиши цель: зачем она, шаги, заметки, ссылки…"
                  rows={4}
                  className="w-full resize-none rounded-xl bg-foreground/[0.03] border border-foreground/[0.07] px-3.5 py-3 text-[13px] text-foreground/85 outline-none focus:border-pink-400/35 focus:bg-foreground/[0.05] leading-relaxed placeholder:text-muted-foreground/40 min-h-[120px] transition-colors"
                />
              </div>

              {/* Children / subtasks */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/55">Подзадачи</p>
                  <button
                    onClick={() => {
                      const id = createGoal({
                        title: 'Новая подзадача',
                        type: 'task',
                        parentId: goal.id,
                        month: goal.month,
                        dueDate: goal.dueDate,
                        status: 'not_started',
                      })
                      selectGoal(id)
                    }}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors"
                  >
                    <Plus className="w-3 h-3" /> Добавить
                  </button>
                </div>
                {children.length > 0 ? (
                  <div className="flex flex-col gap-0.5">
                    {children.map(child => (
                      <div key={child.id} className="flex items-center gap-2 py-1.5 rounded-lg hover:bg-foreground/[0.03] px-1.5 group">
                        <button onClick={() => toggleTaskDone(child.id)} className="shrink-0 flex">
                          {child.status === 'done'
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-500/80 dark:text-emerald-400/80" />
                            : <Circle className="w-4 h-4 text-foreground/25" />}
                        </button>
                        <button
                          onClick={() => selectGoal(child.id)}
                          className={cn(
                            'flex-1 text-left text-[13px] truncate transition-colors',
                            child.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground/85 hover:text-foreground',
                          )}
                        >
                          {child.title}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12px] text-muted-foreground/35 px-1.5">Пока нет подзадач</p>
                )}
              </div>

              {/* Dependencies */}
              <div className="relative">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground/55">Связи</p>
                  <button
                    onClick={() => {
                      setShowLinkSearch(s => !s)
                      setLinkSearch('')
                      setTimeout(() => linkInputRef.current?.focus(), 60)
                    }}
                    className={cn(
                      'inline-flex items-center gap-1 text-[10px] transition-colors',
                      showLinkSearch ? 'text-foreground' : 'text-muted-foreground/60 hover:text-muted-foreground',
                    )}
                  >
                    <Link2 className="w-3 h-3" />
                    Связать
                  </button>
                </div>

                <AnimatePresence initial={false}>
                  {showLinkSearch && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18, ease: 'easeInOut' }}
                      className="overflow-hidden"
                    >
                      <div className="mb-2 rounded-xl bg-foreground/[0.03] border border-foreground/[0.08] p-1.5">
                        <input
                          ref={linkInputRef}
                          value={linkSearch}
                          onChange={e => setLinkSearch(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Escape') { setShowLinkSearch(false); setLinkSearch('') }
                            if (e.key === 'Enter' && linkCandidates[0]) {
                              createLink(goal.id, linkCandidates[0].id, 'depends_on')
                              setShowLinkSearch(false); setLinkSearch('')
                            }
                          }}
                          placeholder="Поиск или выбор цели…"
                          className="w-full rounded-lg bg-foreground/[0.04] border border-foreground/[0.08] px-2.5 py-1.5 text-[12px] text-foreground outline-none focus:border-pink-400/35 placeholder:text-muted-foreground/40"
                        />
                        <div className="mt-1 max-h-[180px] overflow-y-auto flex flex-col gap-0.5">
                          {linkCandidates.length === 0 ? (
                            <p className="px-2 py-2 text-[12px] text-muted-foreground/40 text-center">Ничего не найдено</p>
                          ) : (
                            linkCandidates.map(g => (
                              <button
                                key={g.id}
                                onClick={() => {
                                  createLink(goal.id, g.id, 'depends_on')
                                  setShowLinkSearch(false)
                                  setLinkSearch('')
                                }}
                                className="flex items-center gap-2 text-left px-2 py-1.5 rounded-lg text-[12px] text-foreground/75 hover:bg-foreground/[0.06] hover:text-foreground transition-colors"
                              >
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[g.status] }} />
                                <span className="truncate">{g.title}</span>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {(blockedBy.length > 0 || dependsOn.length > 0) && (
                  <div className="flex flex-wrap gap-1.5">
                    {blockedBy.map(g => (
                      <button
                        key={g.id}
                        onClick={() => selectGoal(g.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-rose-600 dark:text-rose-300/90 bg-rose-500/[0.08] dark:bg-rose-400/[0.08] border border-rose-500/15 dark:border-rose-400/15 hover:bg-rose-500/[0.14] transition-colors"
                      >
                        <Ban className="w-3 h-3" /> {g.title.length > 20 ? g.title.slice(0, 18) + '…' : g.title}
                      </button>
                    ))}
                    {dependsOn.map(g => (
                      <button
                        key={g.id}
                        onClick={() => selectGoal(g.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-muted-foreground bg-foreground/[0.04] border border-foreground/[0.07] hover:bg-foreground/[0.07] transition-colors"
                      >
                        <GitBranch className="w-3 h-3" /> {g.title.length > 20 ? g.title.slice(0, 18) + '…' : g.title}
                      </button>
                    ))}
                  </div>
                )}

                {blockedBy.length === 0 && dependsOn.length === 0 && !showLinkSearch && (
                  <p className="text-[12px] text-muted-foreground/35">Нет связей</p>
                )}
              </div>
            </div>

            {/* Footer actions */}
            <div className="shrink-0 px-5 max-sm:px-4 py-3 border-t border-foreground/[0.07] flex items-center gap-1">
              <button
                onClick={() => {
                  const id = createGoal({
                    title: 'Новая подцель',
                    type: 'goal',
                    parentId: goal.id,
                    month: goal.month,
                    dueDate: goal.dueDate,
                    status: 'not_started',
                  })
                  selectGoal(id)
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Подцель
              </button>
              <button
                onClick={() => {
                  if (confirm(`Удалить «${goal.title}»?`)) { deleteGoal(goal.id) }
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[12px] text-muted-foreground hover:text-rose-500 dark:hover:text-rose-300 hover:bg-rose-500/[0.08] transition-colors ml-auto"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Удалить
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

"use client"

import React, { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, Circle, Plus, Trash2, Ban, GitBranch, Calendar, Link2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCENT_GRADIENT } from '@/components/habits/lib'
import type { GoalNode, GoalPriority } from '@/types/goals'
import { useGoalsStore } from '@/stores/goals-store'
import { TYPE_LABEL, STATUS_LABEL, STATUS_COLOR, PRIORITY_LABEL, formatMoney } from '../utils/goalColors'
import { parseISO, MONTHS_RU_SHORT } from '../utils/dateRange'

function fmt(iso?: string) {
  if (!iso) return ''
  const d = parseISO(iso)
  return `${d.getDate()} ${MONTHS_RU_SHORT[d.getMonth()]} ${d.getFullYear()}`
}

export function GoalMiniInspector() {
  const selectedGoalId = useGoalsStore(s => s.selectedGoalId)
  const goals = useGoalsStore(s => s.goals)
  const links = useGoalsStore(s => s.links)
  const selectGoal = useGoalsStore(s => s.selectGoal)
  const updateGoal = useGoalsStore(s => s.updateGoal)
  const deleteGoal = useGoalsStore(s => s.deleteGoal)
  const createGoal = useGoalsStore(s => s.createGoal)
  const toggleTaskDone = useGoalsStore(s => s.toggleTaskDone)
  const getProgress = useGoalsStore(s => s.getProgress)
  const getBlockedBy = useGoalsStore(s => s.getBlockedBy)
  const createLink = useGoalsStore(s => s.createLink)

  const goal = selectedGoalId ? goals.find(g => g.id === selectedGoalId) ?? null : null
  const panelRef = useRef<HTMLDivElement>(null)
  const [desc, setDesc] = useState('')
  const [linkSearch, setLinkSearch] = useState('')
  const [showLinkSearch, setShowLinkSearch] = useState(false)
  const linkInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setDesc(goal?.description ?? ''), [goal?.id, goal?.description])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') selectGoal(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectGoal])

  if (!goal) return null

  const children = goals.filter(g => g.parentId === goal.id)
  const progress = getProgress(goal.id)
  const blockedBy = getBlockedBy(goal.id)
  const dependsOn = links
    .filter(l => l.source === goal.id && l.type === 'depends_on')
    .map(l => goals.find(g => g.id === l.target))
    .filter((g): g is GoalNode => !!g)

  const linkedIds = new Set([
    goal.id,
    ...blockedBy.map(g => g.id),
    ...dependsOn.map(g => g.id),
  ])
  const linkCandidates = goals.filter(
    g => !linkedIds.has(g.id) && g.status !== 'archived' &&
      (linkSearch.trim() === '' || g.title.toLowerCase().includes(linkSearch.toLowerCase()))
  )

  return (
    <AnimatePresence>
      <motion.div
        ref={panelRef}
        key={goal.id}
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.97 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="fixed bottom-6 right-6 z-50 w-[380px] max-h-[72vh] flex flex-col rounded-[22px] bg-[#0d0d12]/96 border border-white/[0.11] backdrop-blur-2xl shadow-[0_8px_40px_rgba(0,0,0,0.55)] overflow-hidden"
      >
        {/* Header */}
        <div className="shrink-0 flex items-start gap-3 px-4 pt-4 pb-3 border-b border-white/[0.07]">
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground leading-snug line-clamp-2 pr-1">{goal.title}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[10px] text-muted-foreground bg-white/[0.05] px-1.5 py-0.5 rounded-md">{goal.type === 'task' ? 'Задача' : 'Цель'}</span>
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: STATUS_COLOR[goal.status] }} />
                {STATUS_LABEL[goal.status]}
              </span>
            </div>
          </div>
          <button
            onClick={() => selectGoal(null)}
            className="w-6 h-6 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/[0.07] transition-colors shrink-0 mt-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3 min-h-0">
          {/* Progress */}
          {goal.type !== 'task' && (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: ACCENT_GRADIENT }} />
              </div>
              <span className="text-[11px] font-semibold text-muted-foreground tabular-nums w-8 text-right">{progress}%</span>
            </div>
          )}

          {/* Financial */}
          {goal.type === 'financial_goal' && (
            <div className="rounded-xl bg-white/[0.04] border border-white/[0.07] px-3 py-2.5 flex items-center justify-between gap-3">
              <span className="text-sm font-semibold text-foreground">{formatMoney(goal.currentAmount ?? 0, goal.currency)}</span>
              <span className="text-[11px] text-muted-foreground">из {formatMoney(goal.targetAmount ?? 0, goal.currency)}</span>
            </div>
          )}

          {/* Dates */}
          {(goal.startDate || goal.endDate || goal.dueDate) && (
            <div className="flex items-center gap-1 flex-wrap">
              <Calendar className="w-3 h-3 text-muted-foreground/60 shrink-0" />
              {goal.startDate && <span className="text-[11px] text-muted-foreground">{fmt(goal.startDate)}</span>}
              {(goal.startDate && (goal.endDate || goal.dueDate)) && <span className="text-[11px] text-muted-foreground/40">—</span>}
              {goal.endDate
                ? <span className="text-[11px] text-muted-foreground">{fmt(goal.endDate)}</span>
                : goal.dueDate && !goal.startDate
                ? <span className="text-[11px] text-muted-foreground">дедлайн {fmt(goal.dueDate)}</span>
                : null}
            </div>
          )}

          {/* Description */}
          <textarea
            value={desc}
            onChange={e => setDesc(e.target.value)}
            onBlur={() => desc !== (goal.description ?? '') && updateGoal(goal.id, { description: desc })}
            placeholder="Описание…"
            rows={2}
            className="w-full resize-none rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-[12px] text-foreground/80 outline-none focus:border-white/15 leading-relaxed placeholder:text-muted-foreground/40"
          />

          {/* Priority row */}
          <div className="flex items-center gap-1.5">
            {(['low', 'medium', 'high', 'critical'] as GoalPriority[]).map(p => (
              <button
                key={p}
                onClick={() => updateGoal(goal.id, { priority: p })}
                className={cn(
                  'px-2 py-0.5 rounded-lg text-[10px] border transition-colors',
                  goal.priority === p
                    ? 'border-foreground/25 bg-foreground/[0.08] text-foreground'
                    : 'border-foreground/[0.07] text-muted-foreground/70 hover:bg-foreground/[0.04]',
                )}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>

          {/* Children / subtasks */}
          {children.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/50 mb-1.5">Подзадачи</p>
              <div className="flex flex-col gap-0.5">
                {children.map(child => (
                  <div key={child.id} className="flex items-center gap-2 py-1 rounded-lg hover:bg-white/[0.03] px-1 group">
                    <button
                      onClick={() => toggleTaskDone(child.id)}
                      className="shrink-0 flex"
                    >
                      {child.status === 'done'
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/80" />
                        : <Circle className="w-3.5 h-3.5 text-foreground/25" />}
                    </button>
                    <button
                      onClick={() => selectGoal(child.id)}
                      className={cn(
                        'flex-1 text-left text-[12px] truncate transition-colors',
                        child.status === 'done' ? 'text-muted-foreground line-through' : 'text-foreground/80 hover:text-foreground',
                      )}
                    >
                      {child.title}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Dependencies */}
          <div className="relative">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/50">Связи</p>
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

            {/* Inline dropdown — in flow (pushes content down), never overlaps */}
            <AnimatePresence initial={false}>
              {showLinkSearch && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: 'easeInOut' }}
                  className="overflow-hidden"
                >
                  <div className="mb-2 rounded-xl bg-white/[0.04] border border-white/[0.08] p-1.5">
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
                      className="w-full rounded-lg bg-white/[0.05] border border-white/[0.08] px-2.5 py-1.5 text-[11px] text-foreground outline-none focus:border-white/20 placeholder:text-muted-foreground/40"
                    />
                    <div className="mt-1 max-h-[180px] overflow-y-auto flex flex-col gap-0.5">
                      {linkCandidates.length === 0 ? (
                        <p className="px-2 py-2 text-[11px] text-muted-foreground/40 text-center">Ничего не найдено</p>
                      ) : (
                        linkCandidates.map(g => (
                          <button
                            key={g.id}
                            onClick={() => {
                              createLink(goal.id, g.id, 'depends_on')
                              setShowLinkSearch(false)
                              setLinkSearch('')
                            }}
                            className="flex items-center gap-2 text-left px-2 py-1.5 rounded-lg text-[11px] text-foreground/75 hover:bg-white/[0.07] hover:text-foreground transition-colors"
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
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-rose-300/90 bg-rose-400/[0.08] border border-rose-400/15 hover:bg-rose-400/[0.14] transition-colors"
                  >
                    <Ban className="w-3 h-3" /> {g.title.length > 20 ? g.title.slice(0, 18) + '…' : g.title}
                  </button>
                ))}
                {dependsOn.map(g => (
                  <button
                    key={g.id}
                    onClick={() => selectGoal(g.id)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] text-muted-foreground bg-white/[0.04] border border-white/[0.07] hover:bg-white/[0.07] transition-colors"
                  >
                    <GitBranch className="w-3 h-3" /> {g.title.length > 20 ? g.title.slice(0, 18) + '…' : g.title}
                  </button>
                ))}
              </div>
            )}

            {blockedBy.length === 0 && dependsOn.length === 0 && !showLinkSearch && (
              <p className="text-[11px] text-muted-foreground/35">Нет связей</p>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="shrink-0 px-4 py-3 border-t border-white/[0.07] flex items-center gap-1">
          <button
            onClick={() => {
              const id = createGoal({
                title: 'Новая подцель',
                type: 'goal',
                parentId: goal.id,
                month: goal.month,
                startDate: goal.startDate,
                status: 'not_started',
              })
              selectGoal(id)
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Подцель
          </button>
          <button
            onClick={() => {
              if (confirm(`Удалить «${goal.title}»?`)) { deleteGoal(goal.id) }
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-muted-foreground hover:text-rose-300 hover:bg-rose-400/[0.08] transition-colors ml-auto"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Удалить
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}

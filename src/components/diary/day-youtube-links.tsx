"use client"

import { useState } from "react"
import { YoutubeIcon, PlusIcon, Trash2Icon, LinkIcon, ClockIcon, ExternalLinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type { YoutubeLink } from "@/types/diary"

interface DayYoutubeLinksProps {
  weekId: string
  dayId: string
  links: YoutubeLink[]
  onLinksChange: (links: YoutubeLink[]) => void
}

function extractYoutubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('?')[0]
    return u.searchParams.get('v')
  } catch { return null }
}

function isYoutubeUrl(url: string) {
  try {
    const u = new URL(url)
    return u.hostname.includes('youtube.com') || u.hostname === 'youtu.be'
  } catch { return false }
}

export function DayYoutubeLinks({ weekId, dayId, links, onLinksChange }: DayYoutubeLinksProps) {
  const [open, setOpen] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newDuration, setNewDuration] = useState('')
  const [saving, setSaving] = useState(false)

  async function save(updated: YoutubeLink[]) {
    setSaving(true)
    try {
      await fetch('/api/diary/day-links', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekId, dayId, links: updated }),
      })
      onLinksChange(updated)
    } finally {
      setSaving(false)
    }
  }

  function addLink() {
    const url = newUrl.trim()
    if (!url) return
    const now = new Date().toISOString()
    const link: YoutubeLink = {
      id: crypto.randomUUID(),
      url,
      label: newLabel.trim() || undefined,
      durationMin: newDuration ? parseInt(newDuration) || undefined : undefined,
      createdAt: now,
    }
    const updated = [...links, link]
    save(updated)
    setNewUrl('')
    setNewLabel('')
    setNewDuration('')
  }

  function removeLink(id: string) {
    save(links.filter(l => l.id !== id))
  }

  const totalMin = links.reduce((s, l) => s + (l.durationMin ?? 0), 0)

  return (
    <div className="border-t border-dashed border-muted-foreground/20 px-3 py-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <YoutubeIcon className="h-3.5 w-3.5 text-red-500 shrink-0" />
        <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground transition-colors">
          Видео / трансляции
          {links.length > 0 && (
            <span className="ml-1.5 inline-flex items-center gap-1">
              <span className="text-foreground">({links.length})</span>
              {totalMin > 0 && (
                <span className="flex items-center gap-0.5 text-muted-foreground">
                  <ClockIcon className="h-2.5 w-2.5" />
                  {totalMin} мин
                </span>
              )}
            </span>
          )}
        </span>
        <span className="ml-auto text-[10px] text-muted-foreground">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {/* Existing links */}
          {links.map(link => {
            const ytId = extractYoutubeId(link.url)
            return (
              <div key={link.id} className="flex items-start gap-2 rounded-lg bg-muted/30 p-2 text-xs">
                {ytId ? (
                  <img
                    src={`https://i.ytimg.com/vi/${ytId}/default.jpg`}
                    alt=""
                    className="h-9 w-16 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="h-9 w-16 rounded bg-muted flex items-center justify-center shrink-0">
                    <LinkIcon className="h-4 w-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-medium leading-tight truncate">
                    {link.label || (isYoutubeUrl(link.url) ? 'YouTube' : 'Ссылка')}
                  </p>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-primary flex items-center gap-0.5 truncate"
                  >
                    <ExternalLinkIcon className="h-2.5 w-2.5 shrink-0" />
                    <span className="truncate">{link.url}</span>
                  </a>
                  {link.durationMin && (
                    <span className="text-muted-foreground flex items-center gap-0.5 mt-0.5">
                      <ClockIcon className="h-2.5 w-2.5" />
                      {link.durationMin} мин
                    </span>
                  )}
                </div>
                <button
                  onClick={() => removeLink(link.id)}
                  className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                  title="Удалить"
                >
                  <Trash2Icon className="h-3 w-3" />
                </button>
              </div>
            )
          })}

          {/* Add form */}
          <div className="flex flex-col gap-1.5 rounded-lg border border-dashed border-muted-foreground/30 p-2">
            <Input
              placeholder="Ссылка на YouTube (https://youtube.com/...)"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              className="h-7 text-xs"
              onKeyDown={e => e.key === 'Enter' && addLink()}
            />
            <div className="flex gap-1.5">
              <Input
                placeholder="Название (необязательно)"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
                className="h-7 text-xs flex-1"
              />
              <Input
                placeholder="мин"
                type="number"
                min={1}
                max={600}
                value={newDuration}
                onChange={e => setNewDuration(e.target.value)}
                className="h-7 text-xs w-16"
                title="Длительность в минутах"
              />
              <Button
                size="sm"
                className="h-7 px-2 text-xs gap-1"
                onClick={addLink}
                disabled={!newUrl.trim() || saving}
              >
                <PlusIcon className="h-3 w-3" />
                Добавить
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

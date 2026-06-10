"use client"

import React, { useEffect, useState } from 'react'
import { ImageIcon } from 'lucide-react'
import { api, GalleryItem } from './lib'

function formatDate(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function Gallery({ email }: { email: string }) {
  const [items, setItems] = useState<GalleryItem[] | null>(null)

  useEffect(() => {
    let active = true
    api('/gallery/', email)
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!active) return
        setItems(data.map((r: any) => ({
          id: r.id, habitId: r.habit_id, habitName: r.habit_name,
          emoji: r.emoji, color: r.color, date: r.date,
          photo: r.photo, note: r.note, minutes: r.minutes,
        })))
      })
    return () => { active = false }
  }, [email])

  if (items === null) {
    return (
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[1, 2, 3].map((i) => <div key={i} className="rounded-2xl border bg-card aspect-square animate-pulse" />)}
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <ImageIcon className="w-12 h-12 text-muted-foreground/40 mb-4" />
        <h3 className="text-lg font-semibold mb-1">Галерея пуста</h3>
        <p className="text-muted-foreground text-sm max-w-xs">
          Прикрепляй фото результата в деталях привычки (долгое нажатие на карточку) — и здесь соберётся твой визуальный прогресс
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <div key={item.id} className="rounded-2xl overflow-hidden border bg-card group">
          <div className="relative aspect-square overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.photo} alt={item.habitName} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
            <div className="absolute top-2 left-2 px-2 py-1 rounded-lg bg-black/50 backdrop-blur text-white text-xs flex items-center gap-1">
              <span>{item.emoji}</span>{formatDate(item.date)}
            </div>
          </div>
          {(item.note || item.minutes > 0) && (
            <div className="p-3">
              {item.note && <p className="text-sm line-clamp-2">{item.note}</p>}
              {item.minutes > 0 && <p className="text-xs text-muted-foreground mt-1">⏱ {item.minutes} мин в потоке</p>}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

"use client"

import { useState } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { Grade } from "@/types/diary"
import { GRADE_TYPE_LABELS } from "@/types/diary"

const GRADES: Grade[] = [5, 4, 3, 2, 1]

const GRADE_COLORS: Record<number, string> = {
  5: "bg-emerald-500 text-white border-emerald-600",
  4: "bg-blue-500 text-white border-blue-600",
  3: "bg-amber-400 text-white border-amber-500",
  2: "bg-red-500 text-white border-red-600",
  1: "bg-red-700 text-white border-red-800",
}

const GRADE_HOVER: Record<number, string> = {
  5: "hover:bg-emerald-500 hover:text-white",
  4: "hover:bg-blue-500 hover:text-white",
  3: "hover:bg-amber-400 hover:text-white",
  2: "hover:bg-red-500 hover:text-white",
  1: "hover:bg-red-700 hover:text-white",
}

interface GradeCellProps {
  type: keyof typeof GRADE_TYPE_LABELS
  value: Grade
  disabled?: boolean
  onSave: (value: Grade) => Promise<void>
}

export function GradeCell({ type, value, disabled, onSave }: GradeCellProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const label = GRADE_TYPE_LABELS[type]

  async function handleSelect(grade: Grade) {
    setSaving(true)
    setOpen(false)
    await onSave(grade)
    setSaving(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          disabled={disabled || saving}
          title={label}
          className={cn(
            "flex flex-col items-center justify-center rounded-md border w-10 h-10 text-xs font-semibold transition-all select-none",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer hover:scale-105 active:scale-95",
            value !== null
              ? GRADE_COLORS[value]
              : "bg-muted/60 text-muted-foreground border-muted-foreground/20 hover:border-primary/40",
            saving && "opacity-50"
          )}
        >
          <span className="leading-none text-[11px] font-bold">
            {value ?? "—"}
          </span>
          <span className="leading-none text-[8px] mt-0.5 opacity-80 max-w-[34px] truncate">
            {label.slice(0, 3)}
          </span>
        </button>
      </PopoverTrigger>

      <PopoverContent className="p-2 w-auto" align="center" side="top">
        <p className="text-xs text-muted-foreground mb-2 font-medium px-1">{label}</p>
        <div className="flex gap-1.5">
          {GRADES.map(g => (
            <button
              key={g}
              onClick={() => handleSelect(g)}
              className={cn(
                "w-8 h-8 rounded-md border text-sm font-semibold transition-all",
                value === g
                  ? GRADE_COLORS[g!]
                  : cn("bg-muted/40 border-muted-foreground/20", GRADE_HOVER[g!])
              )}
            >
              {g}
            </button>
          ))}
          {value !== null && (
            <button
              onClick={() => handleSelect(null)}
              className="w-8 h-8 rounded-md border border-muted-foreground/20 bg-muted/40 text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-all"
              title="Убрать оценку"
            >
              ✕
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

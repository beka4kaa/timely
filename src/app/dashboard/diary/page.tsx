"use client"

import { NotebookPenIcon } from "lucide-react"

export default function DiaryPage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex items-center gap-3">
        <NotebookPenIcon className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Дневник</h1>
          <p className="text-muted-foreground text-sm">Школьный дневник — ваши записи и заметки</p>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-muted-foreground/30 bg-muted/20 min-h-[400px]">
        <div className="flex flex-col items-center gap-4 text-center px-8">
          <NotebookPenIcon className="h-16 w-16 text-muted-foreground/40" />
          <h2 className="text-xl font-semibold text-muted-foreground">Дневник пока пуст</h2>
          <p className="text-sm text-muted-foreground/70 max-w-sm">
            Здесь будут появляться ваши записи, заметки и события школьного дневника.
          </p>
        </div>
      </div>
    </div>
  )
}

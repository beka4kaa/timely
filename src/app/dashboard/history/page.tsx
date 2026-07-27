"use client"

import { DaysList } from '@/components/study-planner'
import { History } from 'lucide-react'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

export default function HistoryPage() {
    return (
        <CoffeePageShell
            eyebrow="Архив занятий"
            title="История"
            description="Возвращайтесь к прошлым учебным дням и отслеживайте последовательность работы."
            icon={<History className="h-5 w-5" />}
            contentClassName="max-w-5xl"
        >
            <DaysList
                onSelectDate={(date) => {
                    console.log('Selected date:', date)
                }}
            />
        </CoffeePageShell>
    )
}

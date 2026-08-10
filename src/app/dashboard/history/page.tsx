"use client"

import { DaysList } from '@/components/study-planner'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

export default function HistoryPage() {
    return (
        <CoffeePageShell
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

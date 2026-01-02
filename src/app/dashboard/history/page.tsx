"use client"

import { DaysList } from '@/components/study-planner'
import { useRouter } from 'next/navigation'

export default function HistoryPage() {
    const router = useRouter()

    return (
        <div className="container max-w-5xl mx-auto py-6 px-4">
            <DaysList
                onSelectDate={(date) => {
                    // Could navigate to a specific date page
                    // For now just show in console
                    console.log('Selected date:', date)
                }}
            />
        </div>
    )
}

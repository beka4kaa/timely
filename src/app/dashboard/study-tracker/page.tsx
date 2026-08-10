"use client"

import { useState } from 'react'
import { StudyTimer, SessionsList } from '@/components/mind'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

export default function StudyTrackerPage() {
    const [refreshTrigger, setRefreshTrigger] = useState(0)

    return (
        <CoffeePageShell
            contentClassName="max-w-5xl"
        >
            <div className="space-y-8">
                <StudyTimer
                    onSessionEnd={() => setRefreshTrigger(prev => prev + 1)}
                />

                <div>
                    <h2 className="text-xl font-semibold mb-4">История сессий</h2>
                    <SessionsList refreshTrigger={refreshTrigger} />
                </div>
            </div>
        </CoffeePageShell>
    )
}

"use client"

import { useState } from 'react'
import { StudyTimer, SessionsList } from '@/components/mind'

export default function StudyTrackerPage() {
    const [refreshTrigger, setRefreshTrigger] = useState(0)

    return (
        <div className="container max-w-5xl mx-auto py-6 px-4">
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Трекер учёбы</h1>
                <p className="text-muted-foreground">
                    Отслеживайте время, которое вы тратите на обучение
                </p>
            </div>

            <div className="space-y-8">
                <StudyTimer
                    onSessionEnd={() => setRefreshTrigger(prev => prev + 1)}
                />

                <div>
                    <h2 className="text-xl font-semibold mb-4">История сессий</h2>
                    <SessionsList refreshTrigger={refreshTrigger} />
                </div>
            </div>
        </div>
    )
}

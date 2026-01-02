"use client"

import { AIAnalysis } from '@/components/mind'

export default function AIPage() {
    return (
        <div className="container max-w-3xl mx-auto py-6 px-4">
            <div className="mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    🤖 AI Ассистент
                </h1>
                <p className="text-muted-foreground">
                    Анализ вашего прогресса и рекомендации
                </p>
            </div>

            <AIAnalysis />
        </div>
    )
}

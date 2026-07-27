"use client"

import { AIAnalysis } from '@/components/mind'
import { Sparkles } from 'lucide-react'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

export default function AIPage() {
    return (
        <CoffeePageShell
            eyebrow="Персональный анализ"
            title="AI Ассистент"
            description="Анализ вашего прогресса и спокойные, конкретные рекомендации."
            icon={<Sparkles className="h-5 w-5" />}
            contentClassName="max-w-4xl"
        >
            <AIAnalysis />
        </CoffeePageShell>
    )
}

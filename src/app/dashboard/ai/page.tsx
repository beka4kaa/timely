"use client"

import { AIAnalysis } from '@/components/mind'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

export default function AIPage() {
    return (
        <CoffeePageShell
            contentClassName="max-w-4xl"
        >
            <AIAnalysis />
        </CoffeePageShell>
    )
}

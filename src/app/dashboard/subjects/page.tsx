"use client"

import { SubjectsList } from '@/components/mind'
import { FullAccessGate } from '@/components/full-access-gate'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

export default function SubjectsPage() {
    return (
        <FullAccessGate>
            <CoffeePageShell>
                <SubjectsList />
            </CoffeePageShell>
        </FullAccessGate>
    )
}

"use client"

import { SubjectsList } from '@/components/mind'
import { FullAccessGate } from '@/components/full-access-gate'
import { GraduationCap } from 'lucide-react'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

export default function SubjectsPage() {
    return (
        <FullAccessGate>
            <CoffeePageShell
                eyebrow="Учебная база"
                title="Предметы"
                description="Управляйте предметами и темами для изучения."
                icon={<GraduationCap className="h-5 w-5" />}
            >
                <SubjectsList />
            </CoffeePageShell>
        </FullAccessGate>
    )
}

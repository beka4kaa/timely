"use client"

import { SubjectsList } from '@/components/mind'

export default function SubjectsPage() {
    return (
        <div className="container max-w-6xl mx-auto py-6 px-4">
            <div className="mb-6">
                <h1 className="text-2xl font-bold">Предметы</h1>
                <p className="text-muted-foreground">
                    Управляйте предметами и темами для изучения
                </p>
            </div>

            <SubjectsList />
        </div>
    )
}

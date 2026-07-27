"use client"

import { ScheduleComponent } from '@/components/dashboard/schedule-component'
import { DaysList } from '@/components/study-planner'
import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Calendar, Clock } from 'lucide-react'
import { CoffeePageShell } from '@/components/dashboard/coffee-page-shell'

export default function StudyPlannerPage() {
    const [activeTab, setActiveTab] = useState('schedule')

    return (
        <CoffeePageShell
            eyebrow="Планирование"
            title="Учебный план"
            description="Расписание занятий и история учебных дней в одном спокойном пространстве."
            icon={<Calendar className="h-5 w-5" />}
        >
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-6 grid w-full grid-cols-2 rounded-full border border-[#ded8cf] bg-[#f0ece5] p-1">
                    <TabsTrigger value="schedule" className="gap-2">
                        <Clock className="h-4 w-4" />
                        Schedule
                    </TabsTrigger>
                    <TabsTrigger value="history" className="gap-2">
                        <Calendar className="h-4 w-4" />
                        History
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="schedule">
                    <ScheduleComponent />
                </TabsContent>

                <TabsContent value="history">
                    <DaysList
                        onSelectDate={(date) => {
                            setActiveTab('schedule')
                        }}
                    />
                </TabsContent>
            </Tabs>
        </CoffeePageShell>
    )
}

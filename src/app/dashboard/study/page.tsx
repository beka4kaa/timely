"use client"

import { ScheduleComponent } from '@/components/dashboard/schedule-component'
import { DaysList } from '@/components/study-planner'
import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Calendar, Clock } from 'lucide-react'

export default function StudyPlannerPage() {
    const [activeTab, setActiveTab] = useState('schedule')

    return (
        <div className="container max-w-7xl mx-auto py-6 px-4">
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="grid w-full grid-cols-2 mb-6">
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
        </div>
    )
}

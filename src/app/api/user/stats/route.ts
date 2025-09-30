import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Get user statistics
    const [
      totalGoals,
      completedGoals,
      totalTasks,
      completedTasks,
      totalAchievements,
      totalEvents
    ] = await Promise.all([
      prisma.goal.count({ where: { userId: session.user.id } }),
      prisma.goal.count({ 
        where: { 
          userId: session.user.id,
          status: 'COMPLETED'
        }
      }),
      prisma.task.count({ where: { userId: session.user.id } }),
      prisma.task.count({ 
        where: { 
          userId: session.user.id,
          status: 'COMPLETED'
        }
      }),
      prisma.achievement.count({ where: { userId: session.user.id } }),
      prisma.event.count({ where: { userId: session.user.id } })
    ])

    // Calculate completion rates
    const goalCompletionRate = totalGoals > 0 ? (completedGoals / totalGoals) * 100 : 0
    const taskCompletionRate = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const recentActivity = {
      goalsCreated: await prisma.goal.count({
        where: {
          userId: session.user.id,
          createdAt: { gte: sevenDaysAgo }
        }
      }),
      tasksCompleted: await prisma.task.count({
        where: {
          userId: session.user.id,
          status: 'COMPLETED',
          updatedAt: { gte: sevenDaysAgo }
        }
      }),
      achievementsEarned: await prisma.achievement.count({
        where: {
          userId: session.user.id,
          createdAt: { gte: sevenDaysAgo }
        }
      })
    }

    const stats = {
      overview: {
        totalGoals,
        completedGoals,
        totalTasks,
        completedTasks,
        totalAchievements,
        totalEvents
      },
      completionRates: {
        goals: Math.round(goalCompletionRate),
        tasks: Math.round(taskCompletionRate)
      },
      recentActivity
    }

    return NextResponse.json({ stats })
    
  } catch (error) {
    console.error('Stats fetch error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
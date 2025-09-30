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
      achievements,
      events
    ] = await Promise.all([
      prisma.goal.count({ where: { userId: session.user.id } }),
      prisma.goal.count({ 
        where: { 
          userId: session.user.id,
          status: 'completed'
        }
      }),
      prisma.task.count({ where: { userId: session.user.id } }),
      prisma.task.count({ 
        where: { 
          userId: session.user.id,
          completed: true
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

    const [recentGoals, recentTasks, recentEvents] = await Promise.all([
      prisma.goal.count({
        where: {
          userId: session.user.id,
          createdAt: { gte: sevenDaysAgo }
        }
      }),
      prisma.task.count({
        where: {
          userId: session.user.id,
          createdAt: { gte: sevenDaysAgo }
        }
      }),
      prisma.event.count({
        where: {
          userId: session.user.id,
          createdAt: { gte: sevenDaysAgo }
        }
      })
    ])

    // Get productivity streak (consecutive days with completed tasks)
    const productivityStreak = await calculateProductivityStreak(session.user.id)

    const stats = {
      overview: {
        totalGoals,
        completedGoals,
        totalTasks,
        completedTasks,
        achievements,
        events
      },
      completion: {
        goalCompletionRate: Math.round(goalCompletionRate),
        taskCompletionRate: Math.round(taskCompletionRate)
      },
      recent: {
        goalsCreated: recentGoals,
        tasksCreated: recentTasks,
        eventsCreated: recentEvents
      },
      productivity: {
        streak: productivityStreak,
        totalPoints: achievements * 10 + completedGoals * 25 + completedTasks * 5
      }
    }

    return NextResponse.json({ stats })

  } catch (error) {
    console.error('Error fetching user stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch statistics' },
      { status: 500 }
    )
  }
}

async function calculateProductivityStreak(userId: string): Promise<number> {
  const today = new Date()
  let streak = 0
  
  for (let i = 0; i < 30; i++) { // Check last 30 days
    const checkDate = new Date(today)
    checkDate.setDate(checkDate.getDate() - i)
    
    const startOfDay = new Date(checkDate)
    startOfDay.setHours(0, 0, 0, 0)
    
    const endOfDay = new Date(checkDate)
    endOfDay.setHours(23, 59, 59, 999)
    
    const tasksCompleted = await prisma.task.count({
      where: {
        userId,
        completed: true,
        updatedAt: {
          gte: startOfDay,
          lte: endOfDay
        }
      }
    })
    
    if (tasksCompleted > 0) {
      streak++
    } else {
      break
    }
  }
  
  return streak
}
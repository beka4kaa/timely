import type { GoalNode, GoalLink } from '@/types/goals'

const now = '2026-06-13T00:00:00.000Z'

/** Helper to cut boilerplate on timestamps. */
const g = (n: Omit<GoalNode, 'createdAt' | 'updatedAt'>): GoalNode => ({
  ...n,
  createdAt: now,
  updatedAt: now,
})

export const MOCK_GOALS: GoalNode[] = [
  // ───────────────────────── GLOBAL GOAL: MIT ─────────────────────────
  g({ id: 'mit', title: 'Поступить в MIT на Computer Science', type: 'global_goal',
      status: 'active', description: 'Получить лучшее техническое образование в мире.',
      month: '2026-09', year: 2026, priority: 'critical', planningScale: 'year',
      startDate: '2026-06-01', endDate: '2026-12-01', dueDate: '2026-12-01' }),

  g({ id: 'sat', title: 'Сдать SAT на 1500+', type: 'subgoal', parentId: 'mit',
      status: 'at_risk', description: 'Системная подготовка по всем разделам теста.',
      month: '2026-07', priority: 'high',
      startDate: '2026-06-15', endDate: '2026-08-15', dueDate: '2026-08-15' }),
  g({ id: 'sat-math', title: 'Решить 50 задач по математике SAT', type: 'task',
      parentId: 'sat', status: 'done', month: '2026-07', priority: 'high',
      startDate: '2026-06-18', dueDate: '2026-06-18' }),
  g({ id: 'sat-read', title: 'Пройти 10 reading-секций', type: 'task',
      parentId: 'sat', status: 'active', progress: 40, month: '2026-07',
      startDate: '2026-06-22', dueDate: '2026-06-22' }),
  g({ id: 'sat-essay', title: 'Написать 5 пробных эссе', type: 'task',
      parentId: 'sat', status: 'not_started', month: '2026-08', priority: 'medium',
      startDate: '2026-08-05', dueDate: '2026-08-05' }),

  g({ id: 'portfolio', title: 'Собрать портфолио на GitHub', type: 'subgoal', parentId: 'mit',
      status: 'active', description: 'Минимум 5 сильных проектов с документацией.',
      month: '2026-07', priority: 'high',
      startDate: '2026-06-10', endDate: '2026-08-30' }),
  g({ id: 'pf-p1', title: 'Проект: ML-классификатор', type: 'milestone',
      parentId: 'portfolio', status: 'done', month: '2026-06',
      startDate: '2026-06-12', dueDate: '2026-06-12' }),
  g({ id: 'pf-p2', title: 'Проект: веб-приложение на Next.js', type: 'milestone',
      parentId: 'portfolio', status: 'active', progress: 55, month: '2026-07',
      startDate: '2026-07-01', endDate: '2026-07-20', dueDate: '2026-07-20' }),
  g({ id: 'pf-readme', title: 'Написать README для всех репозиториев', type: 'task',
      parentId: 'portfolio', status: 'not_started', month: '2026-08',
      startDate: '2026-08-10', dueDate: '2026-08-10' }),

  g({ id: 'essay', title: 'Написать мотивационное эссе', type: 'subgoal', parentId: 'mit',
      status: 'blocked', description: 'Personal statement для приёмной комиссии.',
      month: '2026-08', priority: 'high',
      startDate: '2026-08-20', endDate: '2026-10-01', dueDate: '2026-10-01' }),
  g({ id: 'essay-draft', title: 'Черновик эссе (650 слов)', type: 'task',
      parentId: 'essay', status: 'not_started', month: '2026-08',
      startDate: '2026-08-22', dueDate: '2026-08-22' }),
  g({ id: 'essay-review', title: 'Ревью эссе у ментора', type: 'task',
      parentId: 'essay', status: 'not_started', month: '2026-09',
      startDate: '2026-09-10', dueDate: '2026-09-10' }),

  // ───────────────────────── GLOBAL GOAL: Health ─────────────────────────
  g({ id: 'fit', title: 'Привести себя в форму', type: 'global_goal',
      status: 'on_track', description: 'Стабильный режим тренировок и питания.',
      month: '2026-06', year: 2026, priority: 'medium', planningScale: 'year',
      startDate: '2026-06-01', endDate: '2026-08-31' }),
  g({ id: 'fit-gym', title: 'Тренировки 4× в неделю', type: 'habit', parentId: 'fit',
      status: 'on_track', progress: 70, month: '2026-06',
      startDate: '2026-06-01', endDate: '2026-06-30' }),
  g({ id: 'fit-diet', title: 'Дефицит калорий 30 дней', type: 'subgoal', parentId: 'fit',
      status: 'active', progress: 60, month: '2026-06',
      startDate: '2026-06-05', endDate: '2026-07-05' }),
  g({ id: 'fit-track', title: 'Трекать БЖУ каждый день', type: 'task', parentId: 'fit-diet',
      status: 'active', progress: 80, month: '2026-06',
      startDate: '2026-06-13', dueDate: '2026-06-13' }),

  // ───────────────────────── FINANCIAL GOALS ─────────────────────────
  g({ id: 'fin-laptop', title: 'Накопить на новый MacBook', type: 'financial_goal',
      status: 'active', month: '2026-07', priority: 'medium',
      targetAmount: 3000, currentAmount: 1850, currency: 'USD',
      startDate: '2026-06-01', endDate: '2026-07-31', dueDate: '2026-07-31' }),
  g({ id: 'fin-course', title: 'Оплатить курс подготовки к SAT', type: 'financial_goal',
      status: 'at_risk', month: '2026-06', priority: 'high',
      targetAmount: 800, currentAmount: 250, currency: 'USD',
      startDate: '2026-06-01', endDate: '2026-06-30', dueDate: '2026-06-30' }),
  g({ id: 'fin-fund', title: 'Подушка безопасности', type: 'financial_goal',
      status: 'on_track', month: '2026-08', priority: 'low',
      targetAmount: 5000, currentAmount: 3200, currency: 'USD',
      startDate: '2026-06-01', endDate: '2026-08-31', dueDate: '2026-08-31' }),
]

export const MOCK_LINKS: GoalLink[] = [
  { id: 'l1', source: 'essay', target: 'sat', type: 'depends_on', strength: 2 },
  { id: 'l2', source: 'fin-course', target: 'sat', type: 'blocks', strength: 3 },
  { id: 'l3', source: 'portfolio', target: 'mit', type: 'supports', strength: 2 },
  { id: 'l4', source: 'fit', target: 'mit', type: 'related_to', strength: 1 },
  { id: 'l5', source: 'fin-laptop', target: 'portfolio', type: 'supports', strength: 1 },
  { id: 'l6', source: 'essay-review', target: 'essay-draft', type: 'depends_on', strength: 2 },
]

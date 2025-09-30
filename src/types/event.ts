export interface Event {
  id: string
  title: string
  description?: string | null
  start: Date
  end: Date
  category: string
  priority: string
  color: string
  recurring?: string | null
  userId: string
  createdAt: Date
  updatedAt: Date
}

export interface FormattedEvent {
  id: string
  title: string
  description?: string
  date: string
  startTime: string
  endTime: string
  type: string
  priority: string
  color: string
  recurring: string
  userId: string
}
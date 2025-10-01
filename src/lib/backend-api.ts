// API client for FastAPI backend
const API_BASE_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

export class BackendApiClient {
  private baseUrl: string

  constructor() {
    this.baseUrl = API_BASE_URL
  }

  async get(endpoint: string, options?: RequestInit) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    })

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  async post(endpoint: string, data?: any, options?: RequestInit) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    })

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  async put(endpoint: string, data?: any, options?: RequestInit) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      body: data ? JSON.stringify(data) : undefined,
      ...options,
    })

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  async delete(endpoint: string, options?: RequestInit) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
      ...options,
    })

    if (!response.ok) {
      throw new Error(`API Error: ${response.status} ${response.statusText}`)
    }

    return response.json()
  }

  // Health check
  async healthCheck() {
    return this.get('/health')
  }

  // Auth endpoints
  async getCurrentUser() {
    return this.get('/api/auth/me')
  }

  // User endpoints
  async getUserProfile() {
    return this.get('/api/users/me')
  }

  async updateUserProfile(data: any) {
    return this.put('/api/users/me', data)
  }

  // Tasks endpoints
  async getTasks() {
    return this.get('/api/tasks/')
  }

  async createTask(data: any) {
    return this.post('/api/tasks/', data)
  }

  // Goals endpoints
  async getGoals() {
    return this.get('/api/goals/')
  }

  async createGoal(data: any) {
    return this.post('/api/goals/', data)
  }

  // Events endpoints
  async getEvents() {
    return this.get('/api/events/')
  }

  async createEvent(data: any) {
    return this.post('/api/events/', data)
  }
}

export const backendApi = new BackendApiClient()
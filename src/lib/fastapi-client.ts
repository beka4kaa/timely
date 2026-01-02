// FastAPI Backend Client
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export class FastAPIClient {
  private baseURL: string;

  constructor() {
    this.baseURL = API_BASE_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseURL}${endpoint}`;

    console.log(`🌐 FastAPI Request: ${options.method || 'GET'} ${url}`);
    console.log('🌐 Request options:', options);

    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    console.log(`🌐 FastAPI Response: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`🌐 FastAPI Error Response: ${errorText}`);
      throw new Error(`API Error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log('🌐 FastAPI Response Data:', data);
    return data;
  }

  // Health Check
  async healthCheck() {
    return this.request('/health');
  }

  // Auth endpoints
  async authHealthCheck() {
    return this.request('/api/auth/health');
  }

  async googleLogin() {
    return this.request('/api/auth/google/login');
  }

  async getCurrentUser() {
    return this.request('/api/auth/me');
  }

  // Users endpoints
  async getUserProfile() {
    return this.request('/api/users/me');
  }

  async updateUserProfile(data: any) {
    return this.request('/api/users/me', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Tasks endpoints
  async getTasks() {
    return this.request('/api/tasks/');
  }

  async createTask(task: any) {
    return this.request('/api/tasks/', {
      method: 'POST',
      body: JSON.stringify(task),
    });
  }

  async updateTask(id: string, task: any) {
    return this.request(`/api/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(task),
    });
  }

  async deleteTask(id: string) {
    return this.request(`/api/tasks/${id}`, {
      method: 'DELETE',
    });
  }

  // Goals endpoints
  async getGoals() {
    return this.request('/api/goals/');
  }

  async createGoal(goal: any) {
    return this.request('/api/goals/', {
      method: 'POST',
      body: JSON.stringify(goal),
    });
  }

  async updateGoal(id: string, goal: any) {
    return this.request(`/api/goals/${id}`, {
      method: 'PUT',
      body: JSON.stringify(goal),
    });
  }

  async deleteGoal(id: string) {
    return this.request(`/api/goals/${id}`, {
      method: 'DELETE',
    });
  }

  // Events endpoints
  async getEvents() {
    return this.request('/api/events/');
  }

  async createEvent(event: any) {
    return this.request('/api/events/', {
      method: 'POST',
      body: JSON.stringify(event),
    });
  }

  async updateEvent(id: string, event: any) {
    return this.request(`/api/events/${id}`, {
      method: 'PUT',
      body: JSON.stringify(event),
    });
  }

  async deleteEvent(id: string) {
    return this.request(`/api/events/${id}`, {
      method: 'DELETE',
    });
  }
}

// Export singleton instance
export const fastApiClient = new FastAPIClient();

// Export for easier imports
export default fastApiClient;
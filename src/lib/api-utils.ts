// Transform camelCase to snake_case for backend
export function toSnakeCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(toSnakeCase)
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase()
      acc[snakeKey] = toSnakeCase(obj[key])
      return acc
    }, {} as any)
  }
  return obj
}

// Transform snake_case to camelCase for frontend
export function toCamelCase(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(toCamelCase)
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.keys(obj).reduce((acc, key) => {
      const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())
      acc[camelKey] = toCamelCase(obj[key])
      return acc
    }, {} as any)
  }
  return obj
}

// Backend URL - use BACKEND_URL or NEXT_PUBLIC_API_URL
// On production (Vercel), use Railway backend. On localhost, use local backend.
export const BACKEND_URL = process.env.BACKEND_URL || process.env.NEXT_PUBLIC_API_URL || (
  process.env.VERCEL ? 'https://timely-production-4f5a.up.railway.app' : 'http://localhost:8000'
)

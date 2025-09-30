import "next-auth"
import "next-auth/jwt"

declare module "next-auth" {
  interface User {
    id: string
    role?: string
    provider?: string
  }

  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
      role?: string
      provider?: string
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: string
    provider?: string
  }
}
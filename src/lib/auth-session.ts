import { getServerSession as nextAuthGetServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"

export async function getServerSession(options?: any) {
  const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true" || process.env.NODE_ENV === "development"
  
  if (DEV_BYPASS_AUTH) {
    return {
      user: {
        id: "dev-user-id",
        email: "dev@example.com",
        name: "Developer Bypass",
        role: "admin"
      },
      accessToken: "mock-token-for-dev"
    }
  }

  return await nextAuthGetServerSession(options || authOptions)
}

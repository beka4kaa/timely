import { getServerSession as nextAuthGetServerSession } from "next-auth"
import type { Session } from "next-auth"
import { authOptions } from "@/lib/auth"

export type AppSession = Session & { accessToken?: string }

export async function getServerSession(
  options: typeof authOptions = authOptions
): Promise<AppSession | null> {
  const DEV_BYPASS_AUTH = process.env.NEXT_PUBLIC_DEV_BYPASS_AUTH === "true"

  if (DEV_BYPASS_AUTH) {
    return {
      user: {
        id: "dev-user-id",
        email: "dev@example.com",
        name: "Developer Bypass",
        role: "admin"
      },
      accessToken: "mock-token-for-dev",
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }
  }

  return (await nextAuthGetServerSession(options)) as AppSession | null
}

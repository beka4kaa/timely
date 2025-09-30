import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { prisma } from "./prisma"
import bcrypt from "bcryptjs"

// Проверяем переменные окружения при загрузке
console.log('🔍 ENVIRONMENT CHECK:', {
  hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
  hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
  hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
  hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
  googleClientIdLength: process.env.GOOGLE_CLIENT_ID?.length,
  googleClientIdStart: process.env.GOOGLE_CLIENT_ID?.substring(0, 10)
})

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  console.error('❌ MISSING GOOGLE OAUTH CREDENTIALS!')
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
      authorization: {
        params: {
          scope: 'openid email profile',
          prompt: 'consent',
          access_type: 'offline',
          response_type: 'code'
        }
      },
      profile(profile) {
        console.log('🎭 GOOGLE PROFILE RECEIVED:', profile)
        return {
          id: profile.sub,
          name: profile.name,
          email: profile.email,
          image: profile.picture,
          role: 'user'
        }
      }
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        // Ищем пользователя в базе данных
        const user = await prisma.user.findUnique({
          where: { email: credentials.email }
        })

        if (!user) {
          return null
        }

        // Проверяем пароль (если он есть - для пользователей, зарегистрированных через форму)
        if (user.password) {
          const passwordMatch = await bcrypt.compare(credentials.password, user.password)
          if (!passwordMatch) {
            return null
          }
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
          role: user.role,
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      console.log('🔑 JWT CALLBACK:', {
        hasUser: !!user,
        provider: account?.provider,
        tokenEmail: token.email,
        tokenId: token.id
      })
      
      // При первом входе (когда есть user)
      if (user) {
        console.log('👤 First login, setting user data in token:', user.email)
        token.role = user.role || "user"
        token.id = user.id
        token.provider = account?.provider
      }
      
      // Для Google OAuth - получаем данные из базы
      if (account?.provider === "google" && token.email) {
        try {
          console.log('🔍 Fetching user from DB for Google OAuth:', token.email)
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email }
          })
          
          if (dbUser) {
            console.log('📋 Setting token data from DB user:', { id: dbUser.id, role: dbUser.role })
            token.role = dbUser.role
            token.id = dbUser.id
            token.name = dbUser.name
            token.picture = dbUser.image
          } else {
            console.log('⚠️ No DB user found for:', token.email)
          }
        } catch (error) {
          console.error('❌ JWT callback error:', error)
        }
      }
      
      console.log('🔑 JWT token final state:', { id: token.id, email: token.email, role: token.role })
      return token
    },
    async session({ session, token }) {
      console.log('📋 SESSION CALLBACK:', {
        tokenId: token.id,
        tokenEmail: token.email,
        sessionEmail: session.user?.email
      })
      
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string || "user"
        session.user.provider = token.provider as string
        // Обновляем данные из токена
        if (token.name) session.user.name = token.name as string
        if (token.picture) session.user.image = token.picture as string
        
        console.log('✅ Final session data:', {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name,
          role: session.user.role
        })
      }
      return session
    },
    async redirect({ url, baseUrl }) {
      console.log('🔀 REDIRECT CALLBACK:', { url, baseUrl })
      
      // После успешного логина через Google редиректим на дашборд
      if (url === baseUrl || url.includes('/auth/') || url === '/') {
        console.log('✅ Redirecting to dashboard')
        return `${baseUrl}/dashboard`
      }
      
      // Если url уже содержит dashboard, оставляем как есть
      if (url.includes('/dashboard')) {
        console.log('✅ Already dashboard URL:', url)
        return url
      }
      
      console.log('🔀 Default redirect to dashboard')
      return `${baseUrl}/dashboard`
    },
    async signIn({ user, account, profile }) {
      console.log('🔥 SIGNIN CALLBACK START:', {
        user: user ? { email: user.email, name: user.name, image: user.image, id: user.id } : 'USER IS UNDEFINED',
        account: account ? { provider: account.provider, type: account.type, access_token: !!account.access_token } : 'ACCOUNT IS UNDEFINED',
        profile: profile ? { email: (profile as any).email, name: (profile as any).name, sub: (profile as any).sub } : 'PROFILE IS UNDEFINED'
      })
      
      // Проверяем, что все данные есть
      if (!user) {
        console.error('❌ USER IS UNDEFINED - Google OAuth failed')
        return false
      }
      
      if (!account) {
        console.error('❌ ACCOUNT IS UNDEFINED - OAuth account missing')
        return false
      }
      
      if (!user.email) {
        console.error('❌ USER EMAIL IS MISSING')
        return false
      }
      
      try {
        if (account?.provider === "google") {
          console.log('🚀 Google OAuth process started for:', user.email)
          
          // При входе через Google создаем или обновляем пользователя
          const existingUser = await prisma.user.findUnique({
            where: { email: user.email! }
          })

          if (!existingUser) {
            console.log('👤 Creating new Google user:', user.email)
            const newUser = await prisma.user.create({
              data: {
                email: user.email!,
                name: user.name || "Google User",
                image: user.image,
                role: "user",
                emailVerified: new Date(),
              }
            })
            console.log('✅ New user created successfully:', { id: newUser.id, email: newUser.email })
          } else {
            console.log('🔄 Updating existing Google user:', user.email)
            const updatedUser = await prisma.user.update({
              where: { email: user.email! },
              data: {
                name: user.name || existingUser.name,
                image: user.image || existingUser.image,
                emailVerified: new Date()
              }
            })
            console.log('✅ User updated successfully:', { id: updatedUser.id, email: updatedUser.email })
          }
          
          console.log('🎉 Google OAuth signin successful, redirecting to dashboard...')
        }
        return true
      } catch (error) {
        console.error('❌ SignIn callback error:', error)
        return false
      }
    }
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/signin',
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 дней
  },
  secret: process.env.NEXTAUTH_SECRET,
  debug: process.env.NODE_ENV === "development",
}
import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { prisma } from "./prisma"
import bcrypt from "bcryptjs"

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      allowDangerousEmailAccountLinking: true,
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
      // При первом входе (когда есть user)
      if (user) {
        token.role = user.role || "user"
        token.id = user.id
        token.provider = account?.provider
      }
      
      // Для Google OAuth - получаем данные из базы
      if (account?.provider === "google" && token.email) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { email: token.email }
          })
          
          if (dbUser) {
            token.role = dbUser.role
            token.id = dbUser.id
            token.name = dbUser.name
            token.picture = dbUser.image
          }
        } catch (error) {
          console.error('JWT callback error:', error)
        }
      }
      
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string || "user"
        session.user.provider = token.provider as string
        // Обновляем данные из токена
        if (token.name) session.user.name = token.name as string
        if (token.picture) session.user.image = token.picture as string
      }
      return session
    },
    async signIn({ user, account, profile }) {
      try {
        if (account?.provider === "google") {
          console.log('Google sign in attempt:', { 
            email: user.email, 
            name: user.name,
            image: user.image,
            provider: account.provider 
          })
          
          // При входе через Google создаем или обновляем пользователя
          const existingUser = await prisma.user.findUnique({
            where: { email: user.email! }
          })

          if (!existingUser) {
            console.log('Creating new Google user:', user.email)
            const newUser = await prisma.user.create({
              data: {
                email: user.email!,
                name: user.name || "Пользователь Google",
                image: user.image,
                role: "user",
                emailVerified: new Date(), // Google email уже верифицирован
              }
            })
            console.log('New user created:', newUser.id)
          } else {
            // Обновляем данные существующего пользователя
            console.log('Updating existing Google user:', user.email)
            await prisma.user.update({
              where: { email: user.email! },
              data: {
                name: user.name || existingUser.name,
                image: user.image || existingUser.image,
                emailVerified: new Date()
              }
            })
          }
        }
        return true
      } catch (error) {
        console.error('SignIn callback error:', error)
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
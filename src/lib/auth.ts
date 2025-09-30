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
      if (user) {
        token.role = user.role || "user"
        token.id = user.id
      }
      
      if (account?.provider === "google") {
        // При входе через Google обновляем роль пользователя в базе
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email! }
        })
        
        if (dbUser) {
          token.role = dbUser.role
          token.id = dbUser.id
        }
      }
      
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.role = token.role as string
      }
      return session
    },
    async signIn({ user, account, profile }) {
      try {
        if (account?.provider === "google") {
          console.log('Google sign in attempt:', { user: user.email, account: account.provider })
          
          // При входе через Google создаем пользователя, если его нет
          const existingUser = await prisma.user.findUnique({
            where: { email: user.email! }
          })

          if (!existingUser) {
            console.log('Creating new Google user:', user.email)
            await prisma.user.create({
              data: {
                email: user.email!,
                name: user.name || "Пользователь Google",
                image: user.image,
                role: "user",
                emailVerified: new Date(), // Google email уже верифицирован
              }
            })
          } else {
            console.log('Existing Google user found:', user.email)
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
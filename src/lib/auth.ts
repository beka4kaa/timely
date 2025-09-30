import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { PrismaAdapter } from "@next-auth/prisma-adapter"
import { prisma } from "./prisma"

// Временное хранилище пользователей (в продакшене заменить на базу данных)
const users = [
  {
    id: 'user-1',
    email: 'admin@example.com',
    password: 'admin123',
    name: 'Администратор',
    role: 'admin',
    image: null
  },
  {
    id: 'user-2', 
    email: 'user@example.com',
    password: 'user123',
    name: 'Пользователь',
    role: 'user',
    image: null
  }
]

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
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

        const user = users.find(
          user => user.email === credentials.email && user.password === credentials.password
        )

        if (user) {
          return {
            id: user.id,
            email: user.email,
            name: user.name,
            image: user.image,
            role: user.role
          }
        }

        return null
      }
    })
  ],
  callbacks: {
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && user) {
        // При входе через Google создаем или обновляем пользователя
        token.role = "user" // По умолчанию роль пользователя для Google auth
        token.provider = "google"
      }
      
      if (user) {
        token.role = user.role || "user"
      }
      
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!
        session.user.role = token.role as string
        session.user.provider = token.provider as string
      }
      return session
    },
    async signIn({ user, account, profile }) {
      // Разрешаем вход для всех провайдеров
      return true
    }
  },
  pages: {
    signIn: '/login',
    signOut: '/login',
    error: '/login',
  },
  session: {
    strategy: "jwt"
  },
  secret: process.env.NEXTAUTH_SECRET,
}
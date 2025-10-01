import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import { fastApiClient } from "./fastapi-client"

console.log('🔍 ENVIRONMENT CHECK:', {
  hasGoogleClientId: !!process.env.GOOGLE_CLIENT_ID,
  hasGoogleClientSecret: !!process.env.GOOGLE_CLIENT_SECRET,
  hasNextAuthSecret: !!process.env.NEXTAUTH_SECRET,
  hasNextAuthUrl: !!process.env.NEXTAUTH_URL,
  nextAuthUrl: process.env.NEXTAUTH_URL,
  nodeEnv: process.env.NODE_ENV,
  googleClientIdLength: process.env.GOOGLE_CLIENT_ID?.length || 0,
  googleClientIdStart: process.env.GOOGLE_CLIENT_ID?.substring(0, 10) || 'none'
});

export const authOptions: NextAuthOptions = {
  debug: process.env.NODE_ENV === 'development',
  
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    })
  ],

  callbacks: {
    async jwt({ token, user, account }) {
      if (user) {
        token.id = user.id || 'temp-id';
        token.email = user.email;
        token.role = 'user';
      }
      return token;
    },

    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.email = token.email as string;
        session.user.name = session.user.name || 'User';
        session.user.role = token.role as string;
      }
      return session;
    },

    async redirect({ url, baseUrl }) {
      if (url.includes('/dashboard')) return url;
      if (url.startsWith('/')) return new URL(url, baseUrl).toString();
      if (url === baseUrl || url === `${baseUrl}/`) return `${baseUrl}/dashboard`;
      if (url.startsWith(baseUrl)) return url;
      return `${baseUrl}/dashboard`;
    },

    async signIn({ user, account, profile }) {
      if (account?.provider === 'google') {
        // TODO: Integrate with FastAPI backend for user creation/update
        console.log('✅ User authenticated via Google:', user.email);
        return true;
      }
      return true;
    }
  },

  pages: {
    signIn: '/auth/signin',
    error: '/auth/error',
  },

  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60,
  },

  secret: process.env.NEXTAUTH_SECRET,
}

import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { fastApiClient } from "./fastapi-client"
import { SESSION_COOKIE_NAME, USE_SECURE_COOKIES } from "./auth-cookies"

export const authOptions: NextAuthOptions = {
  debug: process.env.NODE_ENV === 'development',

  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          throw new Error('Email and password are required');
        }

        try {
          const { verifyUser } = await import('./local-users');
          const user = await verifyUser(credentials.email, credentials.password);

          if (!user) {
            throw new Error('Неверный email или пароль');
          }

          return {
            id: user.id,
            email: user.email,
            name: user.name,
          };
        } catch (error: any) {
          console.error('Login error:', error);
          throw new Error(error.message || 'Authentication failed');
        }
      }
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
      const ALLOWED_HOSTS = new Set(['app.timelyplan.me', 'timelyplan.me', 'localhost:3000']);
      if (url.startsWith('/')) return new URL(url, baseUrl).toString();
      try {
        const target = new URL(url);
        if (ALLOWED_HOSTS.has(target.host)) return target.toString();
      } catch {
        // ignore invalid URLs, fall through to default
      }
      return `${baseUrl}/dashboard/diary`;
    },

    async signIn({ user, account }) {
      // Google OAuth users are auto-accepted
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

  // The cookie name comes from ./auth-cookies so that the Edge middleware
  // reads back exactly what this (Node) runtime writes — see that file.
  // No `domain`: the app and the whole auth flow live only on
  // app.timelyplan.me. The apex is a static landing page that never reads
  // the session, so a host-only cookie is both sufficient and safer.
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: USE_SECURE_COOKIES,
      },
    },
  },
  useSecureCookies: USE_SECURE_COOKIES,

  secret: process.env.NEXTAUTH_SECRET,
}

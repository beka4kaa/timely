import { NextAuthOptions } from "next-auth"
import GoogleProvider from "next-auth/providers/google"
import CredentialsProvider from "next-auth/providers/credentials"
import { fastApiClient } from "./fastapi-client"

const isProd = process.env.NODE_ENV === 'production'

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

  // Share the session cookie between the apex (timelyplan.me) and the
  // app subdomain (app.timelyplan.me) so a redirect between them keeps
  // the user logged in. Only session-token gets a shared domain — csrf
  // and callback-url cookies stay host-only since the auth forms always
  // live on app.timelyplan.me.
  cookies: {
    sessionToken: {
      name: isProd ? '__Secure-next-auth.session-token' : 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: isProd,
        domain: isProd ? '.timelyplan.me' : undefined,
      },
    },
  },
  useSecureCookies: isProd,

  secret: process.env.NEXTAUTH_SECRET,
}

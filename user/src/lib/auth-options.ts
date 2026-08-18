import { IUser } from '@interfaces/user';
import { getResponseError } from '@lib/utils';
import axios from 'axios';
import { cookies } from 'next/headers';
import { DefaultSession, NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import * as requestIp from 'request-ip';

declare module 'next-auth' {
  interface User extends IUser {
    token?: string
  }

  interface Session extends DefaultSession {
    accessToken: string;
    user: IUser;
  }
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      // The name to display on the sign in form (e.g. "Sign in with...")
      name: 'Credentials',
      type: 'credentials',
      // `credentials` is used to generate a form on the sign in page.
      // You can specify which fields should be submitted, by adding keys to the `credentials` object.
      // e.g. domain, username, password, 2FA token, etc.
      // You can pass any HTML attribute to the <input> tag through the object.
      credentials: {
        username: { label: 'Username', type: 'text', placeholder: 'Username' },
        password: {
          label: 'Password',
          type: 'password',
          placeholder: 'Password'
        }
      },
      async authorize(credentials, req): Promise<any> {
        try {
          // Get the real IP using request-ip library which handles all proxy headers
          const getRealIP = (): string => {
            // Try to use request-ip library if request object is available
            if (req) {
              const detectedIp = requestIp.getClientIp(req as any);
              if (detectedIp) return detectedIp;
            }

            // Fallback to manual header checking if request-ip doesn't work
            if (req?.headers) {
              const xRealIP = req.headers['x-real-ip'];
              const xForwardedFor = req.headers['x-forwarded-for'];
              const cfConnectingIP = req.headers['cf-connecting-ip'];

              if (xRealIP) return xRealIP;
              if (xForwardedFor) return xForwardedFor.split(',')[0].trim();
              if (cfConnectingIP) return cfConnectingIP;
            }

            return 'unknown';
          };

          const realIP = getRealIP();

          // Prepare headers to forward the real IP to the API
          const headers: any = {
            'Content-Type': 'application/json'
          };

          // Forward the real IP to the API server
          if (realIP !== 'unknown') {
            headers['X-Real-IP'] = realIP;
            headers['X-Forwarded-For'] = realIP;
            headers['X-Client-IP'] = realIP;
          }

          const baseUrl = process.env.API_SERVER_ENDPOINT || process.env.API_ENDPOINT || 'http://localhost:8080';
          const resp = await axios.post(`${baseUrl}/auth/login`, credentials, {
            headers
          });
          const { token, profile } = resp.data.data;

          // Any object returned will be saved in `user` property of the JWT
          return {
            email: profile.email,
            username: profile.username,
            avatar: profile.avatar,
            _id: profile._id,
            token: token
          };
        } catch (e: any) {
          const { response } = e;
          const data = response?.data;
          if (data?.message) throw new Error(getResponseError(data.message));
          throw new Error('An error occurred, please try again later!');
        }
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  useSecureCookies: process.env.NODE_ENV === 'production',
  session: { strategy: 'jwt', maxAge: 60 * 60 * 24 * 7 },
  cookies: {
    sessionToken: {
      name: 'next-auth.session-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production'
      }
    },
    callbackUrl: {
      name: 'next-auth.callback-url',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production'
      }
    },
    csrfToken: {
      name: 'next-auth.csrf-token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production'
      }
    }
  },
  callbacks: {
    // https://next-auth.js.org/configuration/callbacks
    signIn: ({ user }) => {
      if (user) return true;

      return false;
    },

    jwt({ token, user }) {
      // log sign token
      // Persist the access_token and or the user id to the token right after signin
      if (user) {
        token.accessToken = user.token;
        token.user = user;
      };
      return token;
    },
    async session({ session, token }) {
      // retrieve from jwt
      session.accessToken = token.accessToken as string;
      session.user = token.user as any;
      return session;
    }
  },
  events: {
    async signOut({ token }) {
      // NextAuth automatically handles clearing its own cookies
      // we will handle for our custom cookies
      try {
        const baseUrl = process.env.API_SERVER_ENDPOINT || process.env.API_ENDPOINT || 'http://localhost:8080';
        await axios.post(`${baseUrl}/auth/logout`, {}, {
          headers: {
            Authorization: `${token.accessToken}`
          }
        });
        const cookieStore = await cookies();
        cookieStore.delete('token');
      } catch {
        // Ignore logout errors
      }
    }
  },
  // Add custom error handling for JWT-related errors
  logger: {
    error(code, metadata) {
      // Suppress JWT decryption errors during signout as they're expected when JWT secret changes
      if (code === 'JWT_SESSION_ERROR' || code === 'SIGNOUT_ERROR') {
        if (typeof metadata?.message === 'string' && metadata.message.includes('decryption operation failed')) {
          // console.warn('JWT decryption failed during signout - this is expected when JWT secret changes');
          return;
        }
      }
      // Log other errors normally
      // console.error(`[next-auth][error][${code}]`, metadata);
    }
  }
};

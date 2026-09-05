import { getResponseError } from '@lib/utils';
import axios from 'axios';
import { cookies } from 'next/headers';
import { DefaultSession, NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import * as requestIp from 'request-ip';
import { IUser } from 'src/interfaces';

declare module 'next-auth' {
  interface User extends IUser {
    token?: string
  }

  interface Session extends DefaultSession {
    accessToken: string;
    user: IUser;
  }
}

/**
 * TEMPORARY — presence-only diagnostics for the production session failure.
 *
 * `/api/auth/session` answers `{}` immediately after a sign-in that returned no
 * credential error, so the fault is inside next-auth rather than in the
 * middleware that acts on its result. These lines say which callbacks ran and
 * which fields were populated, and nothing else.
 *
 * Booleans only. Never a token, an id, an email or a secret: this runs in a
 * container whose stdout the Docker logging driver writes to disk, so anything
 * printed here outlives the request.
 *
 * Off unless ADMIN_AUTH_DIAGNOSTICS=1, so it can be enabled with a restart and
 * disabled the same way. Remove once the root cause is fixed.
 */
const authDiagnostic = (stage: string, fields: Record<string, boolean | string>): void => {
  if (process.env.ADMIN_AUTH_DIAGNOSTICS !== '1') return;
  // console.warn, not console.info: next.config.js strips info/log in
  // production builds (removeConsole, exclude error+warn).
  const summary = Object.entries(fields).map(([key, value]) => `${key}=${value}`).join(' ');
  // eslint-disable-next-line no-console
  console.warn(`[auth-diag] ${stage}: ${summary}`);
};

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      type: 'credentials',
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
          const baseUrl = process.env.API_ENDPOINT || process.env.API_SERVER_ENDPOINT || 'http://localhost:8080';
          const resp = await axios.post(`${baseUrl}/auth/login`, credentials, {
            headers
          });
          const { token, profile } = resp.data.data;

          // Verify the user is an admin
          if (!profile.isAdmin) {
            throw new Error('Access denied. Admin role required.');
          }

          authDiagnostic('authorize', {
            user: true,
            id: Boolean(profile._id),
            isAdmin: profile.isAdmin === true,
            accessToken: Boolean(token)
          });

          // Any object returned will be saved in `user` property of the JWT
          return {
            email: profile.email,
            username: profile.username,
            avatar: profile.avatar,
            isAdmin: profile.isAdmin,
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
  pages: {
    signIn: '/auth/login',
    signOut: '/auth/logout'
  },
  secret: process.env.NEXTAUTH_SECRET,
  useSecureCookies: process.env.NODE_ENV === 'production',
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 24 * 7 // 7 days
  },
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production'
      }
    },
    callbackUrl: {
      name: `next-auth.callback-url`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production'
      }
    },
    csrfToken: {
      name: `next-auth.csrf-token`,
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production'
      }
    }
  },
  callbacks: {
    signIn: ({ user }) => {
      if (user) return true;
      return false;
    },
    jwt({ token, user, trigger }) {
      if (user) {
        token.accessToken = user.token;
        token.user = user;
      }
      authDiagnostic('jwt', {
        trigger: trigger || 'none',
        user: Boolean(user),
        tokenUser: Boolean(token.user),
        tokenId: Boolean((token.user as any)?._id),
        admin: (token.user as any)?.isAdmin === true,
        accessToken: Boolean(token.accessToken),
        sub: Boolean(token.sub)
      });
      return token;
    },
    async session({ session, token }) {
      session.accessToken = token.accessToken as string;
      session.user = token.user as any;
      authDiagnostic('session', {
        tokenUser: Boolean(token.user),
        tokenId: Boolean((token.user as any)?._id),
        admin: (token.user as any)?.isAdmin === true,
        accessToken: Boolean(token.accessToken),
        sessionUser: Boolean(session.user)
      });
      return session;
    }
  },
  events: {
    async signOut({ token }) {
      try {
        // remove our token cookie
        const cookieStore = await cookies()
        cookieStore.delete('token');

        // call logout endpoint to invalidate token server side
        const baseUrl = process.env.API_ENDPOINT || process.env.API_SERVER_ENDPOINT || 'http://localhost:8080';
        await axios.post(`${baseUrl}/auth/logout`, {}, {
          headers: {
            Authorization: token.accessToken as string
          }
        });
      } catch { }
    }
  },
  logger: {
    /*
      Forward every error except the one this override exists to silence.

      As originally written this method suppressed EVERYTHING: it returned early
      for the decryption case and then fell off the end for every other code,
      logging nothing at all. next-auth's default logger was replaced by a black
      hole, so a production session failure — `/api/auth/session` answering `{}`
      right after a successful sign-in — produced not one line in the container
      log, and the absence of warnings looked like evidence that nothing was
      wrong.

      The intended suppression is kept and narrowed: a stale session cookie
      encrypted with a previous NEXTAUTH_SECRET is expected noise after a secret
      rotation, and there is nothing an operator can do about it. Everything
      else is a real fault and must be visible.

      Only the code and the message are logged. next-auth's metadata can carry
      the token, so it is never spread into the output.
    */
    error(code, metadata) {
      const message = typeof (metadata as any)?.message === 'string' ? (metadata as any).message : '';

      if ((code === 'JWT_SESSION_ERROR' || code === 'SIGNOUT_ERROR')
        && message.includes('decryption operation failed')) {
        // A cookie signed with an older secret. The browser is told to drop it
        // on the next sign-in; nothing to act on.
        return;
      }

      // eslint-disable-next-line no-console
      console.error(`[next-auth] ${code}${message ? `: ${message}` : ''}`);
    },
    warn(code) {
      // eslint-disable-next-line no-console
      console.warn(`[next-auth] ${code}`);
    }
  }
};

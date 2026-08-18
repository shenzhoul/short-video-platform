import { authOptions } from '@lib/auth-options';
import NextAuth from 'next-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Create the NextAuth handler
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };

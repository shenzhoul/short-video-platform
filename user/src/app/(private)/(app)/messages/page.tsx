import MessagesPageClient from '@components/message/messages-page-client';
import { getSession } from '@lib/server-auth';
import { Metadata } from 'next';
import { redirect } from 'next/navigation';

/**
 * Private by definition, so it is explicitly kept out of the index. It still
 * carries a real title, because a browser tab and a bookmark need one whether or
 * not a crawler is ever going to see the page.
 */
export const metadata: Metadata = {
  title: 'Messages',
  robots: { index: false, follow: false }
};

/**
 * Dedicated messages page.
 *
 * Client-rendered below this point: everything on it is private, interactive and
 * realtime, so there is nothing for server rendering to contribute and no SEO
 * cost to paying. The session check stays on the server so an unauthenticated
 * visitor is redirected before any of it is sent.
 */
export default async function MessagesPage() {
  const session = await getSession();
  if (!session) redirect('/auth/login');

  return <MessagesPageClient />;
}

import AuthRequiredGate from '@components/auth/auth-required-gate';
import FollowingFeed from '@components/following/following-feed';
import { getClientIpHeadersFromNextHeaders } from '@lib/ip';
import { getServerAuth } from '@lib/server-auth';
import { getFollowingPosts } from '@services/post.service';
import { getFollowingUsers } from '@services/user.service';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

/**
 * The feed of posts from creators this visitor follows.
 *
 * Private by definition — "who *you* follow" has no meaning without a you — so
 * it is kept out of the index and carries neutral metadata that never touches
 * the private data below.
 */
export const metadata: Metadata = {
  title: 'Following',
  robots: { index: false, follow: false }
};

/**
 * Session first, data second.
 *
 * This page used to check for a token, skip the two fetches when there was
 * none, and then render the feed anyway — so a signed-out visitor got HTTP 200
 * and an empty feed that looked like "you follow nobody" rather than "you are
 * not signed in". The two states are different and only one of them is fixable
 * by the visitor.
 *
 * It now renders `AuthRequiredGate`, which opens the shared login dialog over
 * `/following` itself. The URL is preserved, so signing in refreshes this route
 * and the real feed appears — no redirect to a login page, and no private
 * request issued before there is a session to issue it for.
 */
export default async function FollowingPage() {
  const { session, token } = await getServerAuth();

  // Nothing below this line runs for a signed-out visitor: no follow lookup, no
  // post lookup, and nothing private in the payload sent to the browser.
  if (!session || !token) return <AuthRequiredGate />;

  const ipHeaders = await getClientIpHeadersFromNextHeaders();
  const headers = { ...ipHeaders, Authorization: token };

  let initialData = null;
  let initialCreators = [];

  const [postsResult, creatorsResult] = await Promise.allSettled([
    getFollowingPosts({ limit: 10, sortBy: 'createdAt', sort: 'desc' }, headers),
    getFollowingUsers({ limit: 50, sort: 'desc' }, headers)
  ]);
  if (postsResult.status === 'fulfilled') initialData = postsResult.value.data;
  if (creatorsResult.status === 'fulfilled') initialCreators = creatorsResult.value.data?.data || [];

  return (
    <div className="flex h-full min-h-0 w-full text-(--text-strong)">
      <FollowingFeed initialData={initialData} initialCreators={initialCreators} />
    </div>
  );
}

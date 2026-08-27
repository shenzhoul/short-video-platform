import AuthRequiredGate from '@components/auth/auth-required-gate';
import FollowingFeed from '@components/following/following-feed';
import { getClientIpHeadersFromNextHeaders } from '@lib/ip';
import { getServerAuth } from '@lib/server-auth';
import { getFriendPosts } from '@services/post.service';
import { getFriendUsers } from '@services/user.service';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

/**
 * Private by definition — "your friends" has no meaning without a you — so it is
 * kept out of the index and its metadata is static and neutral, touching none of
 * the data below.
 */
export const metadata: Metadata = {
  title: 'Friends',
  robots: { index: false, follow: false }
};

/**
 * Posts from the viewer's friends.
 *
 * "Friend" is **mutual follow**: creators the viewer follows who follow back.
 * That is the definition this product already uses for a peer relationship — it
 * is what `MessagePermissionService` accepts as consent to message without a
 * request — so Friends reuses it rather than introducing a second idea of who is
 * connected to whom.
 *
 * The page is `FollowingFeed` with `source="friends"`: same layout, same rail,
 * same loading, empty and error behaviour, same interaction handling. Only the
 * creator set differs, and the server does the narrowing.
 *
 * The `/friend` path is what the left navigation has always linked to; before
 * this it resolved to nothing and returned a hard 404 for signed-in and
 * signed-out visitors alike.
 */
export default async function FriendPage() {
  const { session, token } = await getServerAuth();

  // Nothing below this line runs for a signed-out visitor: no mutual-follow
  // lookup, no post lookup, and nothing private in the payload sent to the
  // browser. The gate opens the shared login dialog over `/friend` itself, so
  // the URL survives and signing in lands back here.
  if (!session || !token) return <AuthRequiredGate />;

  const ipHeaders = await getClientIpHeadersFromNextHeaders();
  const headers = { ...ipHeaders, Authorization: token };

  let initialData = null;
  let initialCreators = [];

  const [postsResult, friendsResult] = await Promise.allSettled([
    getFriendPosts({ limit: 10, sortBy: 'createdAt', sort: 'desc' }, headers),
    getFriendUsers({ limit: 50, sort: 'desc' }, headers)
  ]);
  if (postsResult.status === 'fulfilled') initialData = postsResult.value.data;
  if (friendsResult.status === 'fulfilled') initialCreators = friendsResult.value.data?.data || [];

  return (
    <div className="flex h-full min-h-0 w-full text-(--text-strong)">
      <FollowingFeed
        initialData={initialData}
        initialCreators={initialCreators}
        source="friends"
        railTitle="My friends"
      />
    </div>
  );
}

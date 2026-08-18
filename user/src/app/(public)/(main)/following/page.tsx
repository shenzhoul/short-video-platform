import FollowingFeed from '@components/following/following-feed';
import { getClientIpHeadersFromNextHeaders } from '@lib/ip';
import { getFollowingPosts } from '@services/post.service';
import { getFollowingUsers } from '@services/user.service';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function FollowingPage() {
  const token = (await cookies()).get('token')?.value;
  const ipHeaders = await getClientIpHeadersFromNextHeaders();
  const headers = { ...ipHeaders, ...(token ? { Authorization: token } : {}) };
  let initialData = null;
  let initialCreators = [];

  if (token) {
    const [postsResult, creatorsResult] = await Promise.allSettled([
      getFollowingPosts({ limit: 10, sortBy: 'createdAt', sort: 'desc' }, headers),
      getFollowingUsers({ limit: 50, sort: 'desc' }, headers)
    ]);
    if (postsResult.status === 'fulfilled') initialData = postsResult.value.data;
    if (creatorsResult.status === 'fulfilled') initialCreators = creatorsResult.value.data?.data || [];
  }

  return (
    <div className="flex h-full min-h-0 w-full text-(--text-strong)">
      <FollowingFeed initialData={initialData} initialCreators={initialCreators} />
    </div>
  );
}

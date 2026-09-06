import ForYouFeed from '@components/content/post/for-you-feed';
import { getClientIpHeadersFromNextHeaders } from '@lib/ip';
import { getRecommendationAnonymousIdFromCookies } from '@lib/recommendation-anonymous-id.server';
import { getRecommendedPosts } from '@services/post.service';
import { randomUUID } from 'crypto';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

export default async function ForYouPage() {
  const token = (await cookies()).get('token')?.value;
  const ipHeaders = await getClientIpHeadersFromNextHeaders();
  const headers = {
    'Content-Type': 'application/json',
    ...ipHeaders,
    ...(token && { Authorization: token })
  };

  let initialData = null;
  try {
    // The guest's own subject id, so the session this render creates is one the
    // client can continue paging instead of abandoning on its first load-more.
    const anonymousId = token ? undefined : await getRecommendationAnonymousIdFromCookies();
    // Minted here so this render's session joins the browse the client will
    // continue; a reload mints a new one and starts a fresh browse.
    const response = await getRecommendedPosts({
      limit: 10, chainId: randomUUID(), ...(anonymousId ? { anonymousId } : {})
    }, headers);
    initialData = response.data;
  } catch {
    // The client can retry when the API becomes available.
  }

  return <ForYouFeed initialData={initialData} />;
}

import ForYouFeed from '@components/content/post/for-you-feed';
import { getClientIpHeadersFromNextHeaders } from '@lib/ip';
import { getRecommendedPosts } from '@services/post.service';
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
    const response = await getRecommendedPosts({ limit: 10 }, headers);
    initialData = response.data;
  } catch {
    // The client can retry when the API becomes available.
  }

  return <ForYouFeed initialData={initialData} />;
}

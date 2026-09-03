import HomeFeed from '@components/content/post/home-feed';
import { POST_PAGE_LIMIT } from '@constants/pagination';
import { hasApiErrorStatus } from '@lib/api-error';
import { authOptions } from '@lib/auth-options';
import { getClientIpHeadersFromNextHeaders } from '@lib/ip';
import { getRecommendationAnonymousIdFromCookies } from '@lib/recommendation-anonymous-id.server';
import { getPersonalizedHomePosts } from '@services/post.service';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';

export default async function HomeLandingWrapper({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await getServerSession(authOptions);
  // Retained for the promise contract (Next.js requires `searchParams` to be
  // awaited even when unused) — the Home recommendation session is always a
  // fresh first page on SSR, never resumed from a URL cursor: a session id in
  // the URL would be stale within its TTL and would not reproduce the same
  // feed anyway, since it is personalized and jittered per session.
  await searchParams;

  try {
    const ipHeaders = await getClientIpHeadersFromNextHeaders();
    const token = session?.accessToken;
    const requestHeaders: Record<string, string> = {
      ...ipHeaders,
      ...(token && { Authorization: token })
    };

    let iniPosts = null;
    try {
      // The guest's own subject id, so the session this render creates is one
      // the client can continue paging instead of abandoning on its first
      // load-more.
      const anonymousId = token ? undefined : await getRecommendationAnonymousIdFromCookies();
      const postResponse = await getPersonalizedHomePosts({
        limit: POST_PAGE_LIMIT, ...(anonymousId ? { anonymousId } : {})
      }, requestHeaders);
      if (postResponse?.data) {
        iniPosts = postResponse.data;
      }
    } catch {
      // silent fail
    }

    return (
      <div className="flex min-h-full max-lg:flex-col text-(--text-strong) xl:h-full xl:min-h-0">
        <div className="min-h-full w-full bg-(--page-bg) xl:h-full xl:min-h-0">
          <div className="h-full min-h-0 w-full">
            <HomeFeed initialData={iniPosts} />
          </div>
        </div>
      </div>
    );
  } catch (error) {
    // The home feed is public and this page needs no session, so a rejected
    // credential here means a stale token — not a missing page. Rethrown for the
    // error boundary, which ends the dead session, rather than being flattened
    // into a 404 that tells the visitor the home page does not exist.
    if (hasApiErrorStatus(error, 401)) {
      throw error;
    }
    notFound();
  }
}

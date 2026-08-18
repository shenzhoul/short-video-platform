import HomeFeed from '@components/content/post/home-feed';
import { POST_PAGE_LIMIT } from '@constants/pagination';
import { authOptions } from '@lib/auth-options';
import { getClientIpHeadersFromNextHeaders } from '@lib/ip';
import { getPersonalizedHomePosts } from '@services/post.service';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';

export default async function HomeLandingWrapper({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await getServerSession(authOptions);
  const searchParamsData = await searchParams;

  const {
    cursor = '',
    lastCreatedAt = '',
    sortValue = ''
  } = searchParamsData;

  try {
    const ipHeaders = await getClientIpHeadersFromNextHeaders();
    const token = session?.accessToken;
    const requestHeaders: Record<string, string> = {
      ...ipHeaders,
      ...(token && { Authorization: token })
    };

    let iniPosts = null;
    try {
      const cursorParams = cursor && cursor !== 'undefined' ? { cursor: cursor as string } : {};
      const lastCreatedAtParams = lastCreatedAt && lastCreatedAt !== 'undefined' ? { lastCreatedAt: lastCreatedAt as string } : {};
      const sortValueParams = sortValue && sortValue !== 'undefined' ? { sortValue: sortValue as string } : {};
      const postResponse = await getPersonalizedHomePosts({
        limit: POST_PAGE_LIMIT,
        offset: 0,
        sortBy: 'createdAt',
        sort: 'desc',
        ...cursorParams,
        ...lastCreatedAtParams,
        ...sortValueParams
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
  } catch {
    notFound();
  }
}

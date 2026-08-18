import AccountUnavailablePage from '@components/creator/account-unavailable-page';
import CreatorProfilePage from '@components/creator/creator-profile-page';
import { AccessForbiddenContent } from '@components/error/access-forbidden-content';
import { POST_PAGE_LIMIT } from '@constants/pagination';
import { getAccessRestrictionReason, hasApiErrorStatus } from '@lib/api-error';
import { getClientIpHeadersFromNextHeaders } from '@lib/ip';
import { DEFAULT_META, getCanonicalUrl } from '@lib/meta-utils';
import { getServerAuth } from '@lib/server-auth';
import { getCachedCreatorLookup } from '@lib/server-cache';
import { findCreatorByUsername } from '@services/creator.service';
import { getPersonalizedHomePosts } from '@services/post.service';
import { generateCreatorMeta } from '@utils/meta-utils';
import { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

interface CreatorPageProps {
  params: Promise<{ creator: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function CreatorPage({ params, searchParams }: CreatorPageProps) {
  const { user } = await getServerAuth();
  const { creator: creatorParam } = await params;
  const creatorUsername = decodeURIComponent(creatorParam);
  const token = (await cookies()).get('token')?.value;
  const ipHeaders = await getClientIpHeadersFromNextHeaders();
  const requestHeaders = {
    'Content-Type': 'application/json',
    ...ipHeaders,
    ...(token && { Authorization: token })
  };

  let creatorLookup: Awaited<ReturnType<typeof getCachedCreatorLookup>>;
  try {
    creatorLookup = await getCachedCreatorLookup(creatorUsername, requestHeaders);
  } catch (error) {
    if (hasApiErrorStatus(error, 403)) {
      return <AccessForbiddenContent reason={getAccessRestrictionReason(error)} />;
    }
    throw error;
  }

  if (creatorLookup.status === 'gone') {
    return <AccountUnavailablePage />;
  }

  if (creatorLookup.status !== 'found') {
    notFound();
  }

  try {
    // it will be fetch from real data, cache is use for metadata only
    let response: Awaited<ReturnType<typeof findCreatorByUsername>>;
    try {
      response = await findCreatorByUsername(creatorUsername, requestHeaders);
    } catch (err: any) {
      // 410 Gone = account permanently deleted
      // api-request.ts throws response?.data so check statusCode (NestJS body)
      // as well as err?.response?.status (raw axios error, if it ever propagates)
      if (err?.statusCode === 410 || err?.response?.status === 410) {
        return <AccountUnavailablePage />;
      }
      if (hasApiErrorStatus(err, 403)) {
        return <AccessForbiddenContent reason={getAccessRestrictionReason(err)} />;
      }
      notFound();
    }
    const creator = response?.data;

    if (!creator) {
      notFound();
    }

    let initialPostData = null;
    try {
      const {
        cursor = '',
        lastCreatedAt = ''
      } = await searchParams;
      const cursorParams = cursor && cursor !== 'undefined' ? { cursor: cursor as string } : {};
      const lastCreatedAtParams = lastCreatedAt && lastCreatedAt !== 'undefined' ? { lastCreatedAt: lastCreatedAt as string } : {};
      const postResponse = await getPersonalizedHomePosts({
        userId: creator._id,
        limit: POST_PAGE_LIMIT,
        offset: 0,
        sortBy: 'createdAt',
        sort: 'desc',
        ...cursorParams,
        ...lastCreatedAtParams
      }, requestHeaders);

      if (postResponse?.data) {
        initialPostData = postResponse.data;
      }
    } catch {
      initialPostData = null;
    }

    return (
      <CreatorProfilePage
        creator={creator}
        currentUser={user}
        initialPostData={initialPostData}
      />
    );
  } catch (error) {
    if (hasApiErrorStatus(error, 403)) {
      return <AccessForbiddenContent reason={getAccessRestrictionReason(error)} />;
    }
    notFound();
  }
}

export async function generateMetadata({ params }: CreatorPageProps): Promise<Metadata> {
  const { creator: creatorParam } = await params;
  const creatorUsername = decodeURIComponent(creatorParam);

  let creatorLookup: Awaited<ReturnType<typeof getCachedCreatorLookup>> | null = null;
  try {
    // Pass IP headers so the throttle guard on the API uses the real client IP
    // rather than the Next.js server IP (shared across all users).
    const ipHeaders = await getClientIpHeadersFromNextHeaders();
    creatorLookup = await getCachedCreatorLookup(creatorUsername, ipHeaders);
  } catch {
    // Silently fall through to default metadata.
    // An unhandled throw here would trigger the error.tsx boundary instead
    // of gracefully showing default metadata.
  }

  // Call notFound() outside the try-catch so it is not silently swallowed.
  // This must happen before headers are flushed so Next.js sets HTTP 404.
  if (creatorLookup?.status === 'not-found') {
    notFound();
  }

  if (creatorLookup?.status === 'gone') {
    return {
      title: 'Account Unavailable',
      description: 'This creator account is no longer available.',
      keywords: DEFAULT_META.defaultKeywords
    };
  }

  if (creatorLookup?.status === 'found') {
    const creator = creatorLookup.creator;
    if (creator) {
      return {
        ...generateCreatorMeta({
          name: creator.name,
          username: creator.username,
          bio: creator.bio,
          avatar: creator.avatar
        }),
        alternates: {
          canonical: getCanonicalUrl(`/${creator.username}`)
        }
      };
    }
  }

  return {
    title: 'Creator Profile',
    description: DEFAULT_META.defaultDescription,
    keywords: DEFAULT_META.defaultKeywords
  };
}

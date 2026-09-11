/**
 * The liked collection behind the profile "I like it" tab and the account menu
 * preview.
 *
 * Every fixture here gives posts a `createdAt` that runs the **opposite** way to
 * the time they were liked. A sort on the wrong field then produces the wrong
 * order instead of passing by coincidence.
 */
// `src/payloads` reaches `isomorphic-dompurify` — an ESM package Jest cannot parse under this
// project's CommonJS transform. The sanitizer is irrelevant to these tests.
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value: string) => value }));

// eslint-disable-next-line import/first
import { ObjectId } from 'mongodb';

import { ContentService } from './content.service';

type FakeReaction = { _id: string; objectId: string; createdAt: Date };
type FakePost = {
  _id: ObjectId;
  text: string;
  status: string;
  userId: ObjectId;
  createdAt: Date;
  isCreatorDeleted?: boolean;
};

const viewerId = new ObjectId();
const creatorId = new ObjectId();

/**
 * A stand-in for `ReactionService.search` with the real contract: newest like
 * first (`createdAt`, then `_id`), cursor strictly after the named reaction,
 * `total` only on an uncursored page, `nextCursor` only when there is more.
 */
function reactionStore(reactions: FakeReaction[]) {
  const ordered = [...reactions].sort((a, b) => (b.createdAt.getTime() - a.createdAt.getTime())
    || (b._id < a._id ? -1 : b._id > a._id ? 1 : 0));

  return jest.fn(async (req: any) => {
    const start = req.cursor ? ordered.findIndex((reaction) => reaction._id === req.cursor) + 1 : 0;
    const limit = Number(req.limit) || 12;
    const slice = ordered.slice(start, start + limit);
    const hasMore = start + limit < ordered.length;
    const last = slice[slice.length - 1];
    return {
      data: slice,
      total: req.cursor ? undefined : ordered.length,
      hasMore,
      nextCursor: hasMore && last ? { id: last._id, createdAt: last.createdAt.getTime() } : null
    };
  });
}

function makePost(index: number, overrides: Partial<FakePost> = {}): FakePost {
  return {
    _id: new ObjectId(),
    text: `post-${index}`,
    status: 'active',
    userId: creatorId,
    // Oldest post first: the reverse of the like order the fixtures build.
    createdAt: new Date(Date.UTC(2020, 0, 1 + index)),
    ...overrides
  };
}

/** Like `posts[0]` most recently, `posts[n-1]` longest ago. */
function likeInOrder(posts: FakePost[]): FakeReaction[] {
  const newest = Date.UTC(2026, 8, 10);
  return posts.map((post, index) => ({
    _id: `r-${String(index).padStart(4, '0')}`,
    objectId: post._id.toString(),
    createdAt: new Date(newest - index * 60_000)
  }));
}

function createSubject(posts: FakePost[], reactions: FakeReaction[]) {
  const byId = new Map(posts.map((post) => [post._id.toString(), post]));
  const postService = {
    findByIds: jest.fn(async (ids: string[]) => ids.map((id) => byId.get(id.toString())).filter(Boolean))
  };
  const reactionService = { search: reactionStore(reactions) };
  const service = new ContentService(
    postService as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    reactionService as any,
    {} as any,
    {} as any,
    {} as any
  );
  jest.spyOn(service, 'populatePostData').mockImplementation(async (items) => items as any);
  return { service, postService, reactionService };
}

const viewer = { _id: viewerId } as any;
const texts = (result: any) => result.data.map((post: FakePost) => post.text);

describe('ContentService liked posts', () => {
  it('returns populated posts in newest-like-first reaction order', async () => {
    const older = makePost(0, { text: 'Older' });
    const newer = makePost(1, { text: 'Newer' });
    const { service } = createSubject([older, newer], likeInOrder([newer, older]));
    const query: any = { limit: 12 };

    const result = await service.getLikedPosts(query, viewer);

    expect(result).toMatchObject({ total: 2, hasMore: false, nextCursor: null });
    expect(texts(result)).toEqual(['Newer', 'Older']);
    expect(query).toMatchObject({ createdBy: viewerId, action: 'like', objectType: 'post' });
  });

  it('orders by when the post was liked, not when it was published', async () => {
    const posts = [0, 1, 2, 3].map((index) => makePost(index));
    // The oldest post was liked most recently.
    const { service } = createSubject(posts, likeInOrder(posts));

    const result = await service.getLikedPosts({ limit: 3 } as any, viewer);

    expect(texts(result)).toEqual(['post-0', 'post-1', 'post-2']);
    expect(result.data).toHaveLength(3);
    expect(result.hasMore).toBe(true);
    expect(result.total).toBe(4);
  });

  it('never returns more than the requested limit and resumes exactly after the last post returned', async () => {
    const posts = [0, 1, 2, 3, 4].map((index) => makePost(index));
    const { service } = createSubject(posts, likeInOrder(posts));

    const first = await service.getLikedPosts({ limit: 3 } as any, viewer);
    const second = await service.getLikedPosts({
      limit: 3,
      cursor: first.nextCursor.id,
      lastCreatedAt: String(first.nextCursor.createdAt)
    } as any, viewer);

    expect(texts(first)).toEqual(['post-0', 'post-1', 'post-2']);
    expect(texts(second)).toEqual(['post-3', 'post-4']);
    expect(second).toMatchObject({ hasMore: false, nextCursor: null });
  });

  it('skips posts the viewer can no longer open and backfills from later likes', async () => {
    const posts = [
      makePost(0),
      makePost(1, { status: 'deleted' }),
      makePost(2, { status: 'inactive' }),
      makePost(3),
      makePost(4),
      makePost(5)
    ];
    const { service, reactionService } = createSubject(posts, likeInOrder(posts));

    const result = await service.getLikedPosts({ limit: 3 } as any, viewer);

    expect(texts(result)).toEqual(['post-0', 'post-3', 'post-4']);
    // The first reaction page held three likes, two of them unusable, so a
    // second page was read to fill the preview.
    expect(reactionService.search).toHaveBeenCalledTimes(2);
    // The cursor is the like of post-4, so post-5 is still reachable.
    const rest = await service.getLikedPosts({
      limit: 3,
      cursor: result.nextCursor.id,
      lastCreatedAt: String(result.nextCursor.createdAt)
    } as any, viewer);
    expect(texts(rest)).toEqual(['post-5']);
    expect(rest.hasMore).toBe(false);
  });

  it('keeps a post the owner deactivated, and a post whose creator was deleted, like post detail does', async () => {
    const ownInactive = makePost(0, { status: 'inactive', userId: viewerId });
    const creatorDeleted = makePost(1, { status: 'inactive', isCreatorDeleted: true });
    const { service } = createSubject([ownInactive, creatorDeleted], likeInOrder([ownInactive, creatorDeleted]));

    const result = await service.getLikedPosts({ limit: 3 } as any, viewer);

    expect(texts(result)).toEqual(['post-0', 'post-1']);
  });

  it('bounds the backfill and hands back a cursor instead of an empty dead end', async () => {
    const posts = Array.from({ length: 20 }, (_, index) => makePost(index, { status: 'deleted' }));
    const { service, reactionService } = createSubject(posts, likeInOrder(posts));

    const result = await service.getLikedPosts({ limit: 3 } as any, viewer);

    expect(result.data).toEqual([]);
    // One page plus three backfill rounds, never a walk of the whole history.
    expect(reactionService.search).toHaveBeenCalledTimes(4);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toEqual({ id: 'r-0011', createdAt: expect.any(Number) });
  });

  it('pages 67 liked posts as 20 + 20 + 20 + 7 distinct posts in like order', async () => {
    const posts = Array.from({ length: 67 }, (_, index) => makePost(index));
    const { service } = createSubject(posts, likeInOrder(posts));
    const pages: number[] = [];
    const seen: string[] = [];
    let cursor: { id: string; createdAt: number } | null = null;

    do {
      // eslint-disable-next-line no-await-in-loop
      const page = await service.getLikedPosts({
        limit: 20,
        ...(cursor ? { cursor: cursor.id, lastCreatedAt: String(cursor.createdAt) } : {})
      } as any, viewer);
      pages.push(page.data.length);
      seen.push(...texts(page));
      cursor = page.hasMore ? page.nextCursor : null;
    } while (cursor && pages.length < 10);

    expect(pages).toEqual([20, 20, 20, 7]);
    expect(new Set(seen).size).toBe(67);
    expect(seen).toEqual(posts.map((post) => post.text));
  });
});

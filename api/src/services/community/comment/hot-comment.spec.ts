import { ObjectId } from 'mongodb';
import { HOT_COMMENT_MIN_LIKES } from 'src/common/constants';

import { CommentService } from './comment.service';

/**
 * Promotion of a single "hot" comment.
 *
 * The rule is deliberately explainable: a top-level comment that clears the
 * like threshold, most likes first, newest breaking a tie.
 */
function createSubject(options: { result?: any; author?: any } = {}) {
  const chain = {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    catch: jest.fn().mockResolvedValue('result' in options ? options.result : null)
  };
  const CommentModel = { findOne: jest.fn().mockReturnValue(chain) };
  const baseUserService = {
    findByIds: jest.fn().mockResolvedValue(options.author ? [options.author] : [])
  };

  const service = new CommentService(
    CommentModel as any,
    { publish: jest.fn() } as any,
    baseUserService as any,
    {} as any
  );

  return { service, CommentModel, chain, baseUserService };
}

const postId = new ObjectId();

describe('hot comment selection', () => {
  it('uses the approved threshold constant, not a literal', () => {
    expect(HOT_COMMENT_MIN_LIKES).toBe(3);
  });

  it('asks only for top-level comments at or above the threshold', async () => {
    const { service, CommentModel } = createSubject();

    await service.findHotComment(postId);

    const filter = CommentModel.findOne.mock.calls[0][0];
    expect(filter.objectType).toBe('post');
    expect(filter.level).toBe(0);
    // A reply is part of a conversation and is never promoted on its own.
    expect(filter.totalLike).toEqual({ $gte: HOT_COMMENT_MIN_LIKES });
  });

  it('ranks by likes, newest breaking a tie', async () => {
    const { service, chain } = createSubject();

    await service.findHotComment(postId);

    expect(chain.sort).toHaveBeenCalledWith({ totalLike: -1, createdAt: -1 });
  });

  it('promotes nothing when no comment clears the bar', async () => {
    // 0, 1 and 2 likes all fail the `$gte` filter, so the query returns nothing.
    const { service } = createSubject({ result: null });

    await expect(service.findHotComment(postId)).resolves.toBeNull();
  });

  it('hydrates the author so the slot renders like any other comment', async () => {
    const authorId = new ObjectId();
    const { service } = createSubject({
      result: {
        _id: new ObjectId(), createdBy: authorId, content: 'hot', totalLike: 5
      },
      author: {
        _id: authorId, username: 'creator', name: 'The Creator', avatar: 'a.jpg'
      }
    });

    const hot = await service.findHotComment(postId);

    expect(hot?.user).toEqual(expect.objectContaining({ username: 'creator' }));
  });

  it('exposes no private author fields', async () => {
    const authorId = new ObjectId();
    const { service } = createSubject({
      result: { _id: new ObjectId(), createdBy: authorId, totalLike: 9 },
      author: {
        _id: authorId, username: 'creator', name: 'C', email: 'secret@example.com', roles: ['user']
      }
    });

    const hot = await service.findHotComment(postId);

    expect(hot?.user).not.toHaveProperty('email');
    expect(hot?.user).not.toHaveProperty('roles');
  });

  it('returns nothing without a post', async () => {
    const { service, CommentModel } = createSubject();

    await expect(service.findHotComment('')).resolves.toBeNull();
    expect(CommentModel.findOne).not.toHaveBeenCalled();
  });
});

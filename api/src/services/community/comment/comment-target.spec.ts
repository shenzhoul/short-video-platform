import { ObjectId } from 'mongodb';

import { CommentService } from './comment.service';

/**
 * Direct resolution of one comment for notification deep-linking.
 *
 * The point of this endpoint is that a target thousands of entries deep is
 * fetched by id rather than by walking pages, and that a deleted target is a
 * reportable outcome rather than an error.
 */
function createSubject(options: { documents?: any[] } = {}) {
  const documents = options.documents || [];
  const CommentModel = {
    findById: jest.fn((id: any) => {
      const found = documents.find((doc) => doc._id.toString() === id?.toString()) || null;
      return { catch: () => Promise.resolve(found), then: (fn: any) => fn(found) };
    })
  };
  const baseUserService = {
    findByIds: jest.fn().mockResolvedValue([])
  };

  const service = new CommentService(
    CommentModel as any,
    { publish: jest.fn() } as any,
    baseUserService as any,
    {} as any
  );

  return { service, CommentModel, baseUserService };
}

function document(overrides: Record<string, any> = {}) {
  return {
    _id: new ObjectId(),
    content: 'a comment',
    objectType: 'post',
    objectId: new ObjectId(),
    createdBy: new ObjectId(),
    createdAt: new Date(),
    ...overrides
  };
}

describe('CommentService.resolveTarget', () => {
  it('resolves a top-level comment as its own thread root', async () => {
    const comment = document();
    const { service } = createSubject({ documents: [comment] });

    const result = await service.resolveTarget(comment._id);

    expect(result.found).toBe(true);
    expect(result.comment._id.toString()).toBe(comment._id.toString());
    // A top-level comment needs no thread expanded, so it is its own root.
    expect(result.root._id.toString()).toBe(comment._id.toString());
  });

  it('resolves a reply together with the root whose thread must be opened', async () => {
    const root = document({ content: 'root comment' });
    const reply = document({
      content: 'the reply', objectType: 'comment', objectId: root._id
    });
    const { service } = createSubject({ documents: [root, reply] });

    const result = await service.resolveTarget(reply._id);

    expect(result.found).toBe(true);
    // The target stays the reply; the root is extra context, not a substitute.
    expect(result.comment._id.toString()).toBe(reply._id.toString());
    expect(result.root._id.toString()).toBe(root._id.toString());
  });

  it('reports a deleted comment as missing instead of throwing', async () => {
    const { service } = createSubject({ documents: [] });

    const result = await service.resolveTarget(new ObjectId());

    // The notification deliberately outlives the comment, so this is a normal
    // outcome the client renders as a removed-comment state.
    expect(result.found).toBe(false);
    expect(result.comment).toBeNull();
    expect(result.root).toBeNull();
  });

  it('resolves in a bounded number of queries, never by paging', async () => {
    const root = document();
    const reply = document({ objectType: 'comment', objectId: root._id });
    const { service, CommentModel, baseUserService } = createSubject({
      documents: [root, reply]
    });

    await service.resolveTarget(reply._id);

    // One lookup for the reply, one for its root — regardless of how many
    // comments the post has.
    expect(CommentModel.findById).toHaveBeenCalledTimes(2);
    expect(baseUserService.findByIds).toHaveBeenCalledTimes(1);
  });

  it('survives a reply whose root has itself been removed', async () => {
    const reply = document({ objectType: 'comment', objectId: new ObjectId() });
    const { service } = createSubject({ documents: [reply] });

    const result = await service.resolveTarget(reply._id);

    // Deleting a comment normally takes its replies with it, so this is a
    // defensive case. The reply still exists and is still a valid target, so it
    // stands in as its own root: the client can render it directly rather than
    // trying to expand a thread that is no longer there.
    expect(result.found).toBe(true);
    expect(result.comment._id.toString()).toBe(reply._id.toString());
    expect(result.root._id.toString()).toBe(reply._id.toString());
  });
});

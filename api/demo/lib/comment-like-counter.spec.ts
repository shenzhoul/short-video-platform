/**
 * `comment.totalLike` must be recomputed, like every other counter here.
 *
 * It was not. The seeder wrote comment-like reactions and the `comment_like`
 * notifications that go with them, but nothing ever moved the counter off the
 * `0` the comment was inserted with. So a notification saying somebody liked
 * your comment opened onto a comment showing no likes at all -- four real
 * reaction rows behind it, and no error anywhere to say so.
 *
 * Nothing in the pipeline could have caught it: the DTO exposed `totalLike`
 * correctly, the client read the right field, and `demo:verify` checked
 * `totalReply` beside it without ever looking at `totalLike`.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { ObjectId } = require('mongodb');

const { reconcileComments } = require('./reconcile');

/** Minimal in-memory stand-ins for the collections reconcile touches. */
function createDb({ comments, reactions }: { comments: any[]; reactions: any[] }) {
  const collection = (rows: any[]) => ({
    rows,
    aggregate(pipeline: any[]) {
      return { toArray: async () => runPipeline(rows, pipeline) };
    },
    find() {
      return { toArray: async () => rows, project: () => ({ toArray: async () => rows }) };
    },
    countDocuments: async () => rows.length,
    async bulkWrite(operations: any[]) {
      for (const op of operations) {
        const { filter, update } = op.updateOne;
        const row = rows.find((r) => String(r._id) === String(filter._id));
        if (row) Object.assign(row, update.$set);
      }
      return { modifiedCount: operations.length };
    },
    updateOne: async () => ({ modifiedCount: 0 })
  });

  return {
    comments: collection(comments),
    reactions: collection(reactions),
    posts: collection([]),
    users: collection([]),
    tagSummaries: collection([]),
    conversations: collection([]),
    conversationParticipants: collection([]),
    messages: collection([])
  };
}

/**
 * Just enough of the aggregation framework for the pipelines reconcile runs.
 *
 * Deliberately small, and deliberately *not* a general Mongo: it supports
 * `$match` with `$in`, and `$group` including a compound `_id` and the dotted
 * `$_id.field` read that the distinct-likers pipeline uses to fold its own
 * grouping key. Anything else throws rather than silently returning nothing,
 * because a stub that quietly answers "no rows" turns a broken counter into a
 * passing test.
 */
const readPath = (row: any, expression: string) => expression
  .slice(1)
  .split('.')
  .reduce((value: any, key: string) => (value == null ? value : value[key]), row);

const matches = (row: any, criteria: Record<string, any>) => Object.entries(criteria)
  .every(([key, value]: [string, any]) => {
    if (value && typeof value === 'object' && '$in' in value) {
      return value.$in.some((candidate: any) => String(candidate) === String(row[key]));
    }
    return String(row[key]) === String(value);
  });

function runPipeline(rows: any[], pipeline: any[]) {
  let current = rows.map((r) => ({ ...r }));

  for (const stage of pipeline) {
    const [name] = Object.keys(stage);
    if (name === '$match') {
      current = current.filter((row) => matches(row, stage.$match));
    } else if (name === '$group') {
      const spec = stage.$group;
      const grouped = new Map<string, any>();
      // Whether the key is a single field or a compound one is decided by the
      // *spec*, never by inspecting the value. An ObjectId is itself an object,
      // so a `typeof id === 'object'` test treated every single-field key as
      // compound and stringified it through `Object.entries` -- which produced
      // the same key for every row and silently folded a whole collection into
      // one bucket. The counter that came out was wrong by exactly the number of
      // rows that should have been separate.
      const compound = typeof spec._id !== 'string';
      for (const row of current) {
        const id = compound
          ? Object.fromEntries(
            Object.entries(spec._id).map(([k, v]: [string, any]) => [k, readPath(row, v)])
          )
          : readPath(row, spec._id);
        const key = compound
          ? JSON.stringify(Object.fromEntries(Object.entries(id).map(([k, v]) => [k, String(v)])))
          : String(id);
        const bucket = grouped.get(key) || { _id: id, n: 0 };
        if (spec.n) bucket.n += 1;
        grouped.set(key, bucket);
      }
      current = [...grouped.values()];
    } else {
      throw new Error(`the aggregation stub does not implement ${name}`);
    }
  }

  return current;
}

describe('comment like counter reconciliation', () => {
  const commentId = new ObjectId();
  const replyId = new ObjectId();
  const liker = () => new ObjectId();

  const run = async (reactions: any[], comments: any[]) => {
    const db = createDb({ comments, reactions });
    await reconcileComments(db, comments.map((c) => c._id));
    return db.comments.rows;
  };

  it('counts the like rows onto the comment, instead of leaving it at zero', async () => {
    const rows = await run(
      [1, 2, 3, 4].map(() => ({
        _id: new ObjectId(), objectType: 'comment', action: 'like', objectId: commentId, createdBy: liker()
      })),
      [{
        _id: commentId, objectType: 'post', totalLike: 0, totalReply: 0
      }]
    );

    // The exact defect: four like rows, a counter reading nought.
    expect(rows[0].totalLike).toBe(4);
  });

  it('counts a reply the same way, without folding it into the parent', async () => {
    const rows = await run(
      [
        {
          _id: new ObjectId(), objectType: 'comment', action: 'like', objectId: commentId, createdBy: liker()
        },
        {
          _id: new ObjectId(), objectType: 'comment', action: 'like', objectId: replyId, createdBy: liker()
        },
        {
          _id: new ObjectId(), objectType: 'comment', action: 'like', objectId: replyId, createdBy: liker()
        }
      ],
      [
        {
          _id: commentId, objectType: 'post', totalLike: 0, totalReply: 0
        },
        {
          _id: replyId, objectType: 'comment', objectId: commentId, totalLike: 0, totalReply: 0
        }
      ]
    );

    const root = rows.find((r: any) => String(r._id) === String(commentId));
    const reply = rows.find((r: any) => String(r._id) === String(replyId));
    expect(root.totalLike).toBe(1);
    expect(reply.totalLike).toBe(2);
  });

  it('counts distinct likers, so a duplicated row cannot inflate the total', async () => {
    const twice = liker();
    const rows = await run(
      [
        {
          _id: new ObjectId(), objectType: 'comment', action: 'like', objectId: commentId, createdBy: twice
        },
        {
          _id: new ObjectId(), objectType: 'comment', action: 'like', objectId: commentId, createdBy: twice
        }
      ],
      [{
        _id: commentId, objectType: 'post', totalLike: 99, totalReply: 0
      }]
    );

    expect(rows[0].totalLike).toBe(1);
  });

  it('ignores reactions that are not comment likes', async () => {
    const rows = await run(
      [
        {
          _id: new ObjectId(), objectType: 'post', action: 'like', objectId: commentId, createdBy: liker()
        },
        {
          _id: new ObjectId(), objectType: 'comment', action: 'share', objectId: commentId, createdBy: liker()
        }
      ],
      [{
        _id: commentId, objectType: 'post', totalLike: 7, totalReply: 0
      }]
    );

    // A post like on a comment id, and a share: neither is a comment like.
    expect(rows[0].totalLike).toBe(0);
  });

  it('recomputes rather than increments, so running twice is the same as once', async () => {
    const reactions = [1, 2].map(() => ({
      _id: new ObjectId(), objectType: 'comment', action: 'like', objectId: commentId, createdBy: liker()
    }));
    const comments = [{
      _id: commentId, objectType: 'post', totalLike: 0, totalReply: 0
    }];
    const db = createDb({ comments, reactions });

    await reconcileComments(db, [commentId]);
    await reconcileComments(db, [commentId]);

    expect(db.comments.rows[0].totalLike).toBe(2);
  });
});

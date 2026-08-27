import { ObjectId } from 'mongodb';

import { REACTION_TARGET_TYPES, REACTION_TYPES } from 'src/common/constants';
import { FollowService } from './follow.service';

/**
 * "Friend" means mutual follow, and this is where that is decided.
 *
 * The definition is not new: `MessagePermissionService` already treats a mutual
 * follow as consent to message without a request, and `areMutuallyFollowing`
 * answers it for a pair. Friends reuses that rather than introducing a second
 * idea of who is connected to whom — so what these tests pin is that the query
 * really is *mutual*, and that it stays server-side.
 */

/** One follow edge, in the shape the reactions collection stores. */
const followEdge = (from: ObjectId, to: ObjectId) => ({
  createdBy: from,
  objectId: to,
  objectType: REACTION_TARGET_TYPES.CREATOR,
  action: REACTION_TYPES.FOLLOW
});

function buildService(edges: Array<{ createdBy: ObjectId; objectId: ObjectId }>) {
  const queries: any[] = [];

  const reactionModel: any = {
    distinct: jest.fn(async (field: string, query: any) => {
      queries.push({ op: 'distinct', field, query });
      return edges
        .filter((edge) => String(edge.createdBy) === String(query.createdBy))
        .map((edge) => edge.objectId);
    }),
    find: jest.fn((query: any) => {
      queries.push({ op: 'find', query });
      const candidateIds = (query.createdBy?.$in || []).map(String);
      const matches = edges.filter((edge) => candidateIds.includes(String(edge.createdBy))
        && String(edge.objectId) === String(query.objectId));
      return {
        select: () => ({ lean: async () => matches.map((edge) => ({ createdBy: edge.createdBy })) })
      };
    })
  };

  const service = new FollowService(
    reactionModel,
    {} as any,
    {} as any
  );

  return { service, reactionModel, queries };
}

describe('who counts as a friend', () => {
  const me = new ObjectId();
  const mutual = new ObjectId();
  const iFollowThemOnly = new ObjectId();
  const theyFollowMeOnly = new ObjectId();

  const edges = [
    followEdge(me, mutual),
    followEdge(mutual, me),
    followEdge(me, iFollowThemOnly),
    followEdge(theyFollowMeOnly, me)
  ];

  it('returns only the creators who follow back', async () => {
    const { service } = buildService(edges);

    const friends = await service.getMutualFollowCreatorIds(me);

    expect(friends.map(String)).toEqual([String(mutual)]);
  });

  it('excludes someone the user follows who does not follow back', async () => {
    const { service } = buildService(edges);

    const friends = (await service.getMutualFollowCreatorIds(me)).map(String);

    expect(friends).not.toContain(String(iFollowThemOnly));
  });

  it('excludes a follower the user does not follow back', async () => {
    const { service } = buildService(edges);

    const friends = (await service.getMutualFollowCreatorIds(me)).map(String);

    // Following is one-way in this product; a follower is not a friend until the
    // relationship points both ways.
    expect(friends).not.toContain(String(theyFollowMeOnly));
  });

  it('returns nothing when the user follows nobody, without a second query', async () => {
    const { service, reactionModel } = buildService([]);

    const friends = await service.getMutualFollowCreatorIds(me);

    expect(friends).toEqual([]);
    // No follow set means there is nothing to intersect; asking anyway would be
    // a query per empty account.
    expect(reactionModel.find).not.toHaveBeenCalled();
  });

  it('does the intersection in the database, not in memory', async () => {
    const { service, queries } = buildService(edges);

    await service.getMutualFollowCreatorIds(me);

    // Two queries total, both scoped: the follow list, then the follow-back
    // check restricted to that list with `$in`. Nothing loads users or posts to
    // filter them afterwards.
    expect(queries).toHaveLength(2);
    expect(queries[1].query.createdBy.$in).toBeDefined();
    expect(String(queries[1].query.objectId)).toBe(String(me));
    expect(queries[1].query.action).toBe(REACTION_TYPES.FOLLOW);
  });

  it('preserves the order of the follow list, so paging is stable', async () => {
    const second = new ObjectId();
    const ordered = [
      followEdge(me, mutual), followEdge(mutual, me),
      followEdge(me, second), followEdge(second, me)
    ];
    const { service } = buildService(ordered);

    const friends = (await service.getMutualFollowCreatorIds(me)).map(String);

    expect(friends).toEqual([String(mutual), String(second)]);
  });
});

describe('the friends list endpoint', () => {
  const me = new ObjectId();

  it('short-circuits to an empty page when there are no friends', async () => {
    const { service } = buildService([]);

    const page: any = await service.getMutualFollowUsers(me, { limit: 10 } as any);

    // An empty page, never an error — having no friends is a legitimate state.
    expect(page.data).toEqual([]);
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
  });

  it('narrows the shared follow-list query rather than reimplementing it', async () => {
    const friend = new ObjectId();
    const { service } = buildService([followEdge(me, friend), followEdge(friend, me)]);

    // `listFollowRelations` is what renders the following and follower lists;
    // reusing it is what keeps the row shape, cursor and active-account filter
    // identical across all three.
    const listSpy = jest.spyOn(service as any, 'listFollowRelations').mockResolvedValue({ data: [] });

    await service.getMutualFollowUsers(me, { limit: 10 } as any);

    expect(listSpy).toHaveBeenCalledTimes(1);
    const [args] = listSpy.mock.calls[0] as any[];
    expect(args.baseQuery.objectId.$in.map(String)).toEqual([String(friend)]);
    expect(args.baseQuery.action).toBe(REACTION_TYPES.FOLLOW);
    expect(args.relatedField).toBe('objectId');
  });
});

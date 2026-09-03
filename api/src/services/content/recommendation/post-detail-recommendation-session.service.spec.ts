import { PostDetailRecommendationSessionService } from './post-detail-recommendation-session.service';
import { createFakeRedis } from './test-fake-redis';

describe('PostDetailRecommendationSessionService', () => {
  it('starts a session at the anchor post with cursor 0', async () => {
    const { client } = createFakeRedis();
    const svc = new PostDetailRecommendationSessionService(client);
    const state = await svc.create('user-1', 'anchor-post');
    expect(state.items).toEqual([{ postId: 'anchor-post', source: 'anchor' }]);
    expect(state.cursorIndex).toBe(0);
  });

  it('previous is null at the anchor, and replays exactly what was appended after stepping forward again', async () => {
    const { client } = createFakeRedis();
    const svc = new PostDetailRecommendationSessionService(client);
    const created = await svc.create('user-1', 'anchor-post');

    expect(await svc.stepBack(created.sessionId, 'user-1')).toBeNull();

    const advanced = await svc.appendAndAdvance(created.sessionId, 'user-1', { postId: 'next-post', source: 'personalized' });
    expect(advanced!.cursorIndex).toBe(1);

    const back = await svc.stepBack(created.sessionId, 'user-1');
    expect(back!.cursorIndex).toBe(0);
    expect(back!.items[back!.cursorIndex].postId).toBe('anchor-post');

    // Stepping forward again must return the exact same post already appended,
    // not recompute a new one.
    const forwardAgain = await svc.stepForwardIfExists(created.sessionId, 'user-1');
    expect(forwardAgain!.items[forwardAgain!.cursorIndex].postId).toBe('next-post');
  });

  it('stepForwardIfExists returns null past the end, signalling the caller to generate a new candidate', async () => {
    const { client } = createFakeRedis();
    const svc = new PostDetailRecommendationSessionService(client);
    const created = await svc.create('user-1', 'anchor-post');
    expect(await svc.stepForwardIfExists(created.sessionId, 'user-1')).toBeNull();
  });

  it('never serves one subject\'s session to another', async () => {
    const { client } = createFakeRedis();
    const svc = new PostDetailRecommendationSessionService(client);
    const created = await svc.create('user-1', 'anchor-post');
    expect(await svc.getState(created.sessionId, 'user-2')).toBeNull();
  });
});

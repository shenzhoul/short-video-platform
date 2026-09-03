import * as fs from 'fs';
import * as path from 'path';

/**
 * The creator listing route, asserted against the controller source.
 *
 * `/posts/home-posts` used to answer "give me this creator's posts": it ran
 * `userSearchPosts`, which honours `userId`, `sortBy` and the pinned-aware
 * cursor. The recommendation work repointed it at the ranked Home feed, whose
 * payload class (`PostRecommendationRequest`, `whitelist: true`) strips
 * `userId` and whose service has no creator filter — so every caller asking for
 * one creator quietly received the whole ranked feed. Measured in a production
 * build: `?userId=<Iris>` came back holding posts from eight creators, rendered
 * under Iris's name both in the Post Detail grid and on her profile page.
 *
 * Read as source rather than exercised through Nest because importing this
 * controller pulls in the whole service barrel (and, through it, an ESM-only
 * dependency Jest will not parse). What is being defended is a *wiring*
 * property — which service each route calls, and in what order the routes are
 * declared — which is exactly what source can answer.
 */
const CONTROLLER = fs.readFileSync(
  path.join(__dirname, 'post.controller.ts'),
  'utf8'
);

/** The body of one `@Get('<route>')` handler, up to the next decorator block. */
function handlerAfterRoute(route: string): string {
  const marker = `@Get('${route}')`;
  const start = CONTROLLER.indexOf(marker);
  if (start < 0) return '';
  const next = CONTROLLER.indexOf('  @Get(', start + marker.length);
  const end = next < 0 ? CONTROLLER.length : next;
  return CONTROLLER.slice(start, end);
}

describe('creator posts route', () => {
  it('exists', () => {
    expect(CONTROLLER).toContain("@Get('/creator-posts')");
  });

  it('is answered by the creator search, not by the ranked recommendation feed', () => {
    const handler = handlerAfterRoute('/creator-posts');
    expect(handler).toContain('userSearchPosts');
    expect(handler).not.toContain('getHomeRecommendedPosts');
    expect(handler).not.toContain('recommendPosts');
  });

  it('takes the search payload, which carries `userId`, not the recommendation payload', () => {
    const handler = handlerAfterRoute('/creator-posts');
    expect(handler).toContain('PostSearchRequest');
    expect(handler).not.toContain('PostRecommendationRequest');
  });

  it('refuses a creator listing with no creator instead of answering with a feed', () => {
    const handler = handlerAfterRoute('/creator-posts');
    expect(handler).toMatch(/if \(!query\.userId\)/);
    expect(handler).toContain('BadRequestException');
  });

  it('is declared before the `/:id` route, or Nest reads it as a post id', () => {
    const creatorRoute = CONTROLLER.indexOf("@Get('/creator-posts')");
    const idRoute = CONTROLLER.indexOf("@Get('/:id')");
    expect(creatorRoute).toBeGreaterThan(-1);
    expect(idRoute).toBeGreaterThan(-1);
    expect(creatorRoute).toBeLessThan(idRoute);
  });

  it('leaves the Home route on the recommendation feed', () => {
    const handler = handlerAfterRoute('/home-posts');
    expect(handler).toContain('getHomeRecommendedPosts');
  });
});

describe('the web client asks the creator route for creator posts', () => {
  const CLIENT = fs.readFileSync(
    path.join(__dirname, '..', '..', '..', '..', '..', 'user', 'src', 'services', 'post.service.ts'),
    'utf8'
  );

  it('points getCreatorPosts at /posts/creator-posts', () => {
    const start = CLIENT.indexOf('getCreatorPosts =');
    expect(start).toBeGreaterThan(-1);
    const body = CLIENT.slice(start, start + 500);
    expect(body).toContain('/posts/creator-posts');
    expect(body).not.toContain('/posts/home-posts');
    expect(body).not.toContain('getHomePosts');
  });
});

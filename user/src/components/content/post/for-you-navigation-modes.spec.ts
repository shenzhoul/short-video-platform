import fs from 'fs';
import path from 'path';

/**
 * The For You stage obeys the same three navigation modes as the detail modal.
 *
 * With the creator grid open on the inline stage, up/down used to keep walking
 * the For You feed — so the grid belonged to one creator while the arrows
 * carried the viewer to another creator's post, and the panel header (which
 * reads the *open post*) then followed the new post while the grid did not.
 * That is the same disagreement the modal had, on a different surface.
 *
 * Asserted against the source because what is being defended is which list owns
 * next/previous — a wiring property. Rendering the whole feed would exercise
 * the video player, the PiP bridge and the recommendation queue to answer a
 * question about one boolean.
 */
const SOURCE = fs.readFileSync(path.join(__dirname, 'for-you-feed.tsx'), 'utf8');

describe('For You navigation modes', () => {
  it('decides once whether the feed owns navigation', () => {
    expect(SOURCE).toMatch(/const feedNavigationEnabled = !detailPanelTab/);
  });

  it('gates both arrows on it, so an open panel cannot move the feed', () => {
    expect(SOURCE).toMatch(/const canPrevious = feedNavigationEnabled && /);
    expect(SOURCE).toMatch(/const canNext = feedNavigationEnabled && /);
  });

  it('gates the navigate handler too — the wheel and the keyboard use it, not the buttons', () => {
    const start = SOURCE.indexOf('const navigate = useCallback');
    expect(start).toBeGreaterThan(-1);
    const body = SOURCE.slice(start, SOURCE.indexOf('}, [', start));
    expect(body).toMatch(/if \(!feedNavigationEnabled\) return;/);
  });

  it('captures the creator when the grid opens and holds it until it closes', () => {
    expect(SOURCE).toMatch(/creatorScopeCreatorId/);
    // The creator list is asked for the captured id, never for whatever post
    // happens to be current.
    expect(SOURCE).toMatch(/userId: inCreatorMode \? creatorScopeCreatorId\.current \|\| undefined : undefined/);
  });

  it('draws photo posts without a video element, and tells the rail which it is', () => {
    expect(SOURCE).toMatch(/mediaVariant=\{activeIsVideo \? 'video' : 'graphic'\}/);
  });

  it('routes watch tracking to video and dwell to photos', () => {
    expect(SOURCE).toMatch(/useRecommendationWatchTracking\(\{\s*enabled: activeIsVideo/);
    expect(SOURCE).toMatch(/useRecommendationPhotoDwell\(\{[\s\S]{0,120}!activeIsVideo/);
  });

  it('skips a post the stage cannot draw rather than rendering a dead slide', () => {
    expect(SOURCE).toMatch(/rawPosts\.filter\(supportsPostDetail\)/);
  });
});

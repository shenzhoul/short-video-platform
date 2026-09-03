import fs from 'fs';
import path from 'path';

/**
 * Every surface that renders the post action rail must wire the whole set of
 * recommendation signals it can produce.
 *
 * This exists because one of them did not. `ForYouFeed` passed `onLikeChange`
 * and `onFollow` but not `onShared`, so sharing a post from For You created a
 * real message and a real share reaction while the recommender learned nothing
 * from it. Nothing failed, nothing logged, and the two `PostDetailModal`
 * layouts — which did wire it — made the omission invisible by comparison.
 *
 * A rendering test would not have caught it either: the rail renders fine
 * without the prop. What is actually wrong is a *wiring* omission, so that is
 * what is asserted, by reading the source the way a reviewer would.
 */
const POST_DIR = path.join(__dirname);

/** Signals the rail can raise, and the prop each arrives on. */
const RAIL_SIGNALS = [
  { prop: 'onLikeChange', signal: 'like' },
  { prop: 'onShared', signal: 'share' },
  { prop: 'onFollow', signal: 'follow_after_view' }
];

function railCallSites(): Array<{ file: string; source: string }> {
  return fs.readdirSync(POST_DIR)
    .filter((name) => name.endsWith('.tsx') && !name.endsWith('.spec.tsx'))
    .map((name) => ({ file: name, source: fs.readFileSync(path.join(POST_DIR, name), 'utf8') }))
    // The rail's own module defines it rather than consuming it.
    .filter(({ file, source }) => file !== 'post-video-stage.tsx' && /<PostVideoActionRail/.test(source));
}

describe('post action rail — recommendation signal wiring', () => {
  it('finds the surfaces that render the rail', () => {
    const sites = railCallSites();
    expect(sites.length).toBeGreaterThan(0);
    // Named so a failure below says which file, not just "a file".
    expect(sites.map((s) => s.file).sort()).toEqual(
      expect.arrayContaining(['for-you-feed.tsx'])
    );
  });

  RAIL_SIGNALS.forEach(({ prop, signal }) => {
    it(`every rail call site passes ${prop}, so the '${signal}' signal is never silently dropped`, () => {
      const missing = railCallSites()
        .filter(({ source }) => !new RegExp(`${prop}=`).test(source))
        .map(({ file }) => file);

      expect(missing).toEqual([]);
    });
  });

  it('For You raises share from a real share, not from opening the popover', () => {
    const source = fs.readFileSync(path.join(POST_DIR, 'for-you-feed.tsx'), 'utf8');
    // The handler must be the rail's `onShared` callback — which the rail only
    // invokes once the server confirmed the share — rather than anything bound
    // to a click on the share control itself.
    expect(source).toMatch(/onShared=\{handleSharedWithTracking\}/);
    expect(source).toMatch(/eventType: 'share'/);
  });

  it('the detail modal wires share on both its layouts', () => {
    const source = fs.readFileSync(path.join(POST_DIR, 'post-detail-modal.tsx'), 'utf8');
    const wired = source.match(/onShared=\{trackShared\(/g) || [];
    // One for the graphic layout, one for the video layout.
    expect(wired.length).toBeGreaterThanOrEqual(2);
  });
});

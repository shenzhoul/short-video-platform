import fs from 'fs';
import path from 'path';

/**
 * Post Detail navigates its own recommendation session — not Home's.
 *
 * ## What this replaced, and why
 *
 * A previous pass coupled the popup to Home: it passed Home's ordered posts,
 * Home's `sessionId` and Home's `hasMore` into `PostDetailModal`, so "next" was
 * the card below the one that had been tapped. That merged two recommendation
 * contexts that are deliberately separate, and it is reverted.
 *
 * There are three independent engines:
 *
 *   Home              ranks a browse
 *   For You           ranks by watch/interest behaviour
 *   Post Detail / PiP an anchor-based session of its own
 *
 * plus the Videos tab, which is that creator's own post list. The popup's
 * "next" must be a *fresh recommendation*, not the next visible card.
 *
 * The real defect behind the fixed A-B-C was in the detail engine's selection
 * (`scored[0]` over the 30 newest, with only 0.03 of seed jitter), and it is
 * fixed server-side — see
 * `api/src/services/content/recommendation/detail-session-selection.spec.ts`.
 */
const HOME = fs.readFileSync(path.join(__dirname, 'home-feed.tsx'), 'utf8');

describe('Home never lends the popup its own sequence', () => {
  it('hands the popup the detail session, not Home’s posts', () => {
    expect(HOME).toMatch(/posts=\{detailFeed\.feedPosts\}/);
    expect(HOME).not.toMatch(/posts=\{usesHomeSession \? posts : detailFeed\.feedPosts\}/);
  });

  it('hands it the detail session id, not Home’s', () => {
    expect(HOME).toMatch(/recommendationSessionId=\{detailFeed\.sessionId\}/);
    expect(HOME).not.toMatch(/sessionForPost\(playback\.detailPost\._id\)/);
  });

  it('hands it the detail session’s hasMore, not Home’s', () => {
    expect(HOME).toMatch(/hasMoreAhead=\{detailFeed\.hasMoreAhead\}/);
  });

  it('mounts the detail session for every modal Home opens', () => {
    // Unconditional: grid clicks and `modal_id` deep links alike.
    expect(HOME).toMatch(/useRecommendationDetailFeed\(\{\s*enabled: Boolean\(playback\.detailPost\),/);
  });

  it('keeps none of the Home-coupling machinery from the previous pass', () => {
    expect(HOME).not.toMatch(/usesHomeSession/);
    expect(HOME).not.toMatch(/openedFromHomeSessionRef/);
    // The popup does not drive Home's pagination either.
    expect(HOME).not.toMatch(/posts\.length - index <= 3\) void loadMore/);
  });
});

/**
 * The scrollbar opt-out, and why it could not be a Tailwind utility.
 */
const GLOBALS = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'app', 'globals.css'), 'utf8');
const CATEGORY_BAR = fs.readFileSync(path.join(__dirname, 'home-feed-category-bar.tsx'), 'utf8');

describe('Home category strip scrollbar', () => {
  it('opts out with an unlayered class, because a layered utility cannot win', () => {
    // `@import "tailwindcss"` puts utilities in `@layer utilities`, and the `*`
    // scrollbar rules in globals.css are unlayered — unlayered author styles
    // beat any layer regardless of specificity, so `[scrollbar-width:none]`
    // never applied and `getComputedStyle` reported `thin`.
    expect(GLOBALS).toMatch(/\.category-scroller \{[\s\S]{0,120}scrollbar-width: none;/);
    expect(GLOBALS).toMatch(/\.category-scroller::-webkit-scrollbar \{/);
  });

  it('applies it to the strip and drops the inert utilities', () => {
    expect(CATEGORY_BAR).toMatch(/category-scroller overflow-x-auto/);
    expect(CATEGORY_BAR).not.toMatch(/\[scrollbar-width:none\]/);
  });

  it('keeps the strip scrollable and its controls intact', () => {
    expect(CATEGORY_BAR).toMatch(/overflow-x-auto/);
    expect(CATEGORY_BAR).toMatch(/aria-label="Previous categories"/);
    expect(CATEGORY_BAR).toMatch(/aria-label="Next categories"/);
  });

  it('does not hide scrollbars globally', () => {
    expect(GLOBALS).toMatch(/\*\s*\{\s*scrollbar-width: thin;/);
  });
});

/**
 * Autoplay and the mobile capsule — the two fixes from the previous pass that
 * are confirmed working and must not regress.
 */
const PLAYER = fs.readFileSync(path.join(__dirname, '..', '..', 'ui', 'video-player.tsx'), 'utf8');
const MODAL = fs.readFileSync(path.join(__dirname, 'post-detail-modal.tsx'), 'utf8');

describe('popup autoplay lifecycle', () => {
  it('claims the attempt latch when the attempt runs, not when it is scheduled', () => {
    const effect = PLAYER.slice(PLAYER.indexOf('const attempt = async ()'));
    expect(effect).toMatch(/if \(!element \|\| !element\.paused\) return;\s*[\s\S]{0,200}autoplayAttemptKeyRef\.current = autoplayKey;/);
  });

  it('waits for readiness on the element instead of a fixed timeout', () => {
    expect(PLAYER).toMatch(/videoElement\.readyState >= 2/);
    expect(PLAYER).toMatch(/addEventListener\('loadeddata', onReady\)/);
    expect(PLAYER).toMatch(/addEventListener\('canplay', onReady\)/);
  });

  it('does not swallow a play() rejection, and releases the latch on one', () => {
    expect(PLAYER).toMatch(/onAutoplayRejected\?\.\(error\?\.name/);
    expect(PLAYER.slice(PLAYER.indexOf('} catch (error: any) {')))
      .toMatch(/autoplayAttemptKeyRef\.current = null;/);
  });

  it('keeps the muted autoplay policy', () => {
    expect(PLAYER).toMatch(/element\.muted = true;\s*setIsMuted\(true\);/);
  });
});

describe('mobile navigation capsule', () => {
  it('is hidden at a compact viewport in the popup', () => {
    expect(MODAL).toMatch(/<div className="max-lg:hidden">\s*<PostNavigationControls/);
  });
});

/**
 * The drag-state leak fix: the measured element can be swapped out from under
 * the observer, because the stage is keyed by post id and remounts on every
 * navigation.
 */
const ELEMENT_HEIGHT = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'hooks', 'use-element-height.ts'), 'utf8'
);

describe('stage height measurement', () => {
  it('re-attaches when the observed element is replaced', () => {
    expect(ELEMENT_HEIGHT).toMatch(/if \(element === observedRef\.current\) return;/);
    expect(ELEMENT_HEIGHT).toMatch(/observerRef\.current\?\.disconnect\(\);/);
  });

  it('never lets a detached node write a zero over a good measurement', () => {
    expect(ELEMENT_HEIGHT).toMatch(/if \(measured > 0\) setHeight\(measured\);/);
  });
});

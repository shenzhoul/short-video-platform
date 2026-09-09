import fs from 'fs';
import path from 'path';

/**
 * Following's compact column allocation, pinned against the Douyin reference.
 *
 * Following is the only feed with a creator rail *in front of* the stage, so it
 * divides four columns where every other surface divides three:
 *
 *   [primary rail] [expanded creator rail] [remaining media strip] [detail panel]
 *
 * Measured off `douyin-following-comments-reference.png`: of its ~467px of app
 * width the primary rail takes ~37px, the creator rail ~93px, the media strip
 * ~111px and the comments panel ~226px — the panel is 52% of everything after
 * the primary rail. Ours gave the panel 100.3px (26%), which is why the shared
 * five-tab strip was driven down to 6px and *still* ran the labels together
 * with a 0px gap.
 *
 * Asserted against the source because these are wiring and token facts —
 * a real browser measures the result (`browser-verify/24-following-columns.js`),
 * and this is what fails fast when someone edits the numbers.
 */
const GLOBALS = fs.readFileSync(
  path.join(__dirname, '..', '..', 'app', 'globals.css'), 'utf8'
);
const RAIL = fs.readFileSync(path.join(__dirname, 'following-creators-rail.tsx'), 'utf8');
const FEED = fs.readFileSync(path.join(__dirname, 'following-feed.tsx'), 'utf8');
const STAGE = fs.readFileSync(
  path.join(__dirname, '..', 'content', 'post', 'post-video-stage.tsx'), 'utf8'
);

describe('Following column allocation', () => {
  describe('the expanded creator rail', () => {
    it('is 88px compact, the reference width — not the 128px that clipped its own header', () => {
      expect(RAIL).toMatch(/expanded \? 'w-52 max-lg:w-22'/);
      expect(RAIL).not.toMatch(/max-lg:w-32/);
    });

    it('keeps 28px collapsed, which the accepted shell already pinned', () => {
      expect(RAIL).toMatch(/: 'w-18 max-lg:w-7'/);
    });

    it('gives every expanded-state element a compact size', () => {
      // The header row, the search field, the section heading and the creator
      // name all carried desktop type into an 88px column before this.
      expect(RAIL).toMatch(/text-sm max-lg:text-\[9px\] font-semibold/);      // "List"
      expect(RAIL).toMatch(/text-\[13px\] max-lg:text-\[9px\] text-\(--text-strong\)/); // search input
      expect(RAIL).toMatch(/max-lg:text-\[9px\] max-lg:leading-4 font-semibold/); // "My following (n)"
      expect(RAIL).toMatch(/text-\[13px\] max-lg:text-\[10px\] font-normal/);  // creator name
    });

    it('floats the hover-only More button instead of reserving 32px of an 88px rail', () => {
      expect(RAIL).toMatch(/max-lg:h-5 max-lg:w-5 shrink-0[^"]*max-lg:absolute max-lg:right-0/);
    });

    it('drops the sort caption but keeps the control and its accessible name', () => {
      expect(RAIL).toMatch(/max-w-25 truncate max-lg:hidden/);
      expect(RAIL).toMatch(/aria-label=\{`Sort following list: \$\{selectedSortLabel\}`\}/);
    });
  });

  describe('who owns the rail state', () => {
    it('lives in the feed, because it decides the whole row’s allocation', () => {
      expect(FEED).toMatch(/const \[creatorRailExpanded, setCreatorRailExpanded\] = useState\(false\)/);
      expect(FEED).toMatch(/expanded=\{creatorRailExpanded\}/);
      expect(FEED).toMatch(/onExpandedChange=\{setCreatorRailExpanded\}/);
      // Not a second copy inside the rail.
      expect(RAIL).not.toMatch(/useState\(false\)/);
    });

    it('names the surface and the rail state on the stage the tokens are read from', () => {
      expect(FEED).toMatch(/data-feed-surface="following"/);
      expect(FEED).toMatch(/data-creator-rail=\{creatorRailExpanded \? 'expanded' : 'collapsed'\}/);
    });
  });

  describe('the panel share', () => {
    it('applies only in the narrow band the references were captured in', () => {
      // At 768px the same ratio gave the panel 428px — over half a tablet
      // viewport for a reading column — while the accepted 0.38 is already
      // right there.
      const band = GLOBALS.slice(GLOBALS.indexOf("[data-feed-surface='following']") - 400);
      expect(band).toMatch(/@media \(max-width: 599px\) \{\s*\[data-feed-surface='following'\]/);
    });

    it('is scoped to Following and differs by rail state, so the panel keeps one width', () => {
      expect(GLOBALS).toMatch(
        /\[data-feed-surface='following'\]\[data-creator-rail='expanded'\] \{ --post-detail-panel-ratio: 0\.678; \}/
      );
      expect(GLOBALS).toMatch(
        /\[data-feed-surface='following'\]\[data-creator-rail='collapsed'\] \{ --post-detail-panel-ratio: 0\.566; \}/
      );
    });

    it('resolves to ~206px at a 440px viewport either way', () => {
      const viewport = 440;
      const primaryRail = 48;
      const expandedSection = viewport - primaryRail - 88;
      const collapsedSection = viewport - primaryRail - 28;
      expect(Math.round(expandedSection * 0.678)).toBeGreaterThanOrEqual(202);
      expect(Math.round(expandedSection * 0.678)).toBeLessThanOrEqual(210);
      expect(Math.round(collapsedSection * 0.566)).toBeGreaterThanOrEqual(202);
      expect(Math.round(collapsedSection * 0.566)).toBeLessThanOrEqual(210);
    });

    it('leaves every other surface on the accepted compact share', () => {
      // 0.38 is the accepted For You / popup value and must not move.
      expect(GLOBALS).toMatch(/--post-detail-panel-ratio: 0\.38/);
      // Two rules — expanded and collapsed — and no third surface opted in.
      const followingRules = GLOBALS.match(/\[data-feed-surface='following'\]\[data-creator-rail=/g) || [];
      expect(followingRules).toHaveLength(2);
    });
  });

  describe('the stage on a narrow player', () => {
    it('is a query container, so it responds to the width it got, not the viewport', () => {
      expect(STAGE).toMatch(/@container\/playerstage/);
    });

    it('drops the caption below 9rem rather than drawing it through the action rail', () => {
      // At 98px the caption's `max-w-[calc(100%-58px)]` left 40px, and
      // "@Tomas Berg · Sep 3" wrapped over four lines across the like and
      // comment icons.
      // `bottom-20` (80px), not `bottom-16` (64px): the desktop transport row is
      // 68px tall, so at 64px the caption's last line sat *on* the controls —
      // measured at 1440x900 as caption bottom 836 against bar top 832.
      expect(STAGE).toMatch(/@max-\[9rem\]\/playerstage:hidden[^"]*absolute bottom-20/);
    });
  });

  describe('the shared components', () => {
    it('reuses the one detail panel rather than a Following copy', () => {
      expect(FEED).not.toMatch(/PostVideoDetailPanel/);
      expect(STAGE).toMatch(/<PostVideoDetailPanel/);
      const panels = fs.readdirSync(path.join(__dirname, '..', 'content', 'post'))
        .filter((file) => /detail-panel\.tsx$/.test(file));
      expect(panels).toEqual(['post-video-detail-panel.tsx']);
    });
  });
});

/**
 * The responsive application shell.
 *
 * jsdom has no layout engine, so nothing here measures a pixel — the widths are
 * measured for real in `browser-verify/21-responsive-shell.js`, at four
 * viewports. What these tests pin is the *contract* that made the measurements
 * come out right, and that a later edit could silently break:
 *
 * - the rail, its spacer, the header and the content column all size themselves
 *   from one token, `--app-shell-nav-width`, rather than from repeated literals.
 *   Before this the content column subtracted 160px only from `xl` up while the
 *   fixed rail appeared from `lg`, so for 256px of viewport range the navigation
 *   was drawn on top of the page;
 * - the rail is rendered at every width. It used to be `max-lg:hidden`, which
 *   left a phone with no navigation at all;
 * - every destination stays in it, including "Topick", which used to be
 *   filtered out below 1024px;
 * - the compact arrangement is chosen by CSS variants, not by a JavaScript
 *   breakpoint, so the server render is already correct.
 */

import fs from 'fs';
import path from 'path';

import { NavigationMenuItem } from '@components/ui/navigation-menu-item';
import { render, screen } from '@testing-library/react';

const push = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  usePathname: () => '/'
}));

const SRC = path.resolve(__dirname, '..', '..');
const read = (...segments: string[]) => fs.readFileSync(path.join(SRC, ...segments), 'utf8');

const NAV_TOKEN = 'var(--app-shell-nav-width)';

describe('responsive app shell', () => {
  const globals = fs.readFileSync(path.join(SRC, 'app', 'globals.css'), 'utf8');

  /**
   * The measured targets.
   *
   * Every compact number here was read off the supplied Douyin screenshots at a
   * 440px viewport: the captures are 423px wide for that viewport, so the scale
   * is 440/423 = 1.040 and an image pixel is 1.04 CSS px. The first responsive
   * pass used round numbers chosen to fit content comfortably (56px rail, 56px
   * header, a 50/50 detail split) and every one of them was visibly larger than
   * the reference — which is exactly what a suite that only asserts "no
   * overflow, element present" cannot catch.
   */
  it('declares the measured compact geometry, and one reflow point', () => {
    // Rail: 45-47 image px in the references, i.e. 47-49 CSS px.
    expect(globals).toMatch(/--app-shell-nav-width:\s*48px/);
    // Header: 27-30 image px, i.e. 28-31 CSS px.
    expect(globals).toMatch(/--app-header-height:\s*2rem/);
    // Detail split: the media side is the wider one, ~62/38.
    expect(globals).toMatch(/--post-detail-panel-ratio:\s*0\.38/);
    // The reference reserves no column for the up/down control.
    expect(globals).toMatch(/--feed-nav-gutter:\s*0px/);
    expect(globals).toMatch(/--app-viewport-height:\s*100dvh/);

    // Desktop keeps every value it had.
    const desktop = globals.slice(globals.indexOf('@media (min-width: 1024px)'));
    expect(desktop).toMatch(/--app-shell-nav-width:\s*160px/);
    expect(desktop).toMatch(/--app-header-height:\s*3\.5rem/);
    expect(desktop).toMatch(/--post-detail-panel-ratio:\s*0\.285714/);
    expect(desktop).toMatch(/--feed-nav-gutter:\s*68px/);
  });

  it('contains the media on a full playback stage, and only there', () => {
    const stage = read('components', 'content', 'post', 'post-video-stage.tsx');
    const feedCard = read('components', 'content', 'post', 'home-feed-card.tsx');
    const tile = read('components', 'creator', 'creator-profile-work-item.tsx');

    // `auto` resolved to `object-cover` for a landscape video, which is what
    // scaled a 1280x720 clip 3.25x inside a 276x900 stage and cut its sides off.
    expect(stage).toContain('objectFit="contain"');
    expect(stage).not.toContain('objectFit="auto"');

    // Thumbnails are a different contract: cropping to a fixed tile is intended.
    expect(feedCard).toContain("objectFit={isProfileVariant ? 'portrait-cover' : 'auto'}");
    expect(tile).toContain('objectFit="portrait-cover"');
  });

  it('does not span the first Topic card across both compact columns', () => {
    const feed = read('components', 'content', 'post', 'home-feed.tsx');
    // The hero spans from 42rem up; below that the reference is a uniform grid.
    expect(feed).toContain('@min-[42rem]:col-span-2');
    expect(feed).not.toContain('@min-[20rem]:col-span-2');
    // And it is not rendered as a hero card at all on a compact viewport: that
    // decides the transport bar, the badges and whether the caption sits under
    // the thumbnail or on top of it, none of which a class can undo.
    expect(feed).toContain('featured={!compactFeed}');
  });

  it('sizes the rail, its spacer, the header and the content column from that one token', () => {
    const nav = read('components', 'layout', 'left-navigation.tsx');
    const header = read('components', 'layout', 'app-header.tsx');
    const content = read('components', 'layout', 'main-page.tsx');

    // The spacer and the fixed rail.
    expect(nav.match(/w-\(--app-shell-nav-width\)/g) || []).toHaveLength(2);
    // Both the header and the content column subtract it, at every width —
    // never behind an `xl:` prefix, which is what left the 1024–1279px band
    // with the navigation overlapping the page.
    expect(header).toContain(`w-[calc(100%-${NAV_TOKEN})]`);
    expect(header).not.toMatch(/xl:w-\[calc\(100%-160px\)\]/);
    expect(content).toContain(`w-[calc(100%-${NAV_TOKEN}-var(--message-workspace-width,0px))]`);
  });

  it('renders the navigation at every width', () => {
    const shell = read('components', 'layout', 'main.tsx');
    // The wrapper around <LeftNavigation> must not hide it on small screens.
    const wrapper = shell.match(/<div className="([^"]*)">\s*\n\s*<LeftNavigation/);
    expect(wrapper).not.toBeNull();
    expect(wrapper?.[1]).not.toContain('hidden');
    // And the vestigial bottom-bar padding — reserved for a bar this app does
    // not have — is gone, so the rail's own column is the only chrome.
    expect(shell).not.toContain('max-xl:pb-[calc(84px');
  });

  it('keeps every destination in the rail, including the home feed', () => {
    const menu = read('components', 'layout', 'navigation', 'user-menu.tsx');
    ['Topick', 'For You', 'Following', 'Friends', 'Profile', 'Games'].forEach((label) => {
      expect(menu).toContain(`label: '${label}'`);
    });
    // "Topick" was dropped below 1024px while there was no rail to put it in.
    expect(menu).not.toMatch(/isHydratedMobile && \(item\.href === '\/'/);
  });

  it('lays the compact rail out with CSS variants, not a JavaScript breakpoint', () => {
    render(
      <NavigationMenuItem
        variant="rail"
        item={{ key: 'for-you', href: '/for-you', label: 'For You', icon: <i /> }}
      />
    );

    const button = screen.getByRole('button', { name: 'For You' });
    // Column on a compact viewport, row from `lg` — both expressed as classes,
    // so the first server-rendered paint is already the right shape.
    expect(button.className).toContain('max-lg:flex-col');
    expect(button.className).toContain('lg:flex-row');
    expect(button.className).not.toContain('undefined');
  });

  it('leaves the default row variant alone for the creator shell', () => {
    render(
      <NavigationMenuItem item={{ key: 'posts', href: '/creator/posts', label: 'Posts', icon: <i /> }} />
    );

    const button = screen.getByRole('button', { name: 'Posts' });
    expect(button.className).toContain('pl-4');
    expect(button.className).not.toContain('max-lg:flex-col');
  });

  it('reads the post-detail split from the token rather than a literal ratio', () => {
    const stage = read('components', 'content', 'post', 'post-video-stage.tsx');
    const modal = read('components', 'content', 'post', 'post-detail-modal.tsx');

    expect(stage).toContain("var(--post-detail-panel-ratio, 0.285714)");
    // The player takes exactly what the panel does not, so the two cannot be
    // tuned apart into a gap or an overlap.
    expect(stage).toContain('const POST_VIDEO_PLAYER_RATIO = `(1 - ${POST_VIDEO_PANEL_RATIO})`');
    // The photo layout uses the same split as the video one.
    expect(modal).toContain('var(--post-detail-panel-ratio, 0.285714)');
    expect(modal).not.toContain("'--post-video-detail-panel-width': '28.5714%'");
  });

  it('sizes the vertical feed surfaces from the shared nav gutter', () => {
    const forYou = read('components', 'content', 'post', 'for-you-feed.tsx');
    const following = read('components', 'following', 'following-feed.tsx');

    expect(forYou).toContain('rightGutter="var(--feed-nav-gutter, 68px)"');
    expect(following).toContain('rightGutter="var(--feed-nav-gutter, 68px)"');
    expect(following).toContain("calc(100% - var(--feed-nav-gutter, 68px))");
    // No route may reintroduce the literal.
    expect(forYou).not.toContain('rightGutter="68px"');
    expect(following).not.toContain('rightGutter="68px"');
  });

  it('makes the profile grid a real grid, so its column count can respond', () => {
    const page = read('components', 'creator', 'creator-profile-page.tsx');
    const item = read('components', 'creator', 'creator-profile-work-item.tsx');

    // Three columns compact, six from `lg` — the same six the tile used to
    // hardcode as a percentage of its own width.
    expect(page).toMatch(/<ul className="grid w-full grid-cols-3[^"]*lg:grid-cols-6/);
    // Read the tile's own class attribute; the file also *describes* the
    // arrangement it replaced, and a plain substring search would match that.
    const tileClasses = item.match(/className="([^"]*list-none[^"]*)"/)?.[1] || '';
    expect(tileClasses).toContain('min-w-0');
    expect(tileClasses).not.toContain('16.66%');
    expect(tileClasses).not.toContain('nth-[6n]');
  });

  it('does not force the profile wider than a phone viewport', () => {
    const page = read('components', 'creator', 'creator-profile-page.tsx');
    // `min-w-170.5` is 682px. Unconditional, it was the page's only source of
    // document-level horizontal scrolling.
    expect(page).toContain('lg:min-w-170.5');
    expect(page).not.toMatch(/(?<!lg:)min-w-170\.5/);
  });
});

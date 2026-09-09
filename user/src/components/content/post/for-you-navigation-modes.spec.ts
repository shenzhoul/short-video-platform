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
  it('resolves the context with the one shared resolver rather than its own booleans', () => {
    // `feedNavigationEnabled = !detailPanelTab` is what this replaced. It made
    // the Videos tab disable navigation here while the popup stepped through
    // the same grid — two surfaces, one grid, two answers to "next".
    expect(SOURCE).not.toMatch(/feedNavigationEnabled/);
    expect(SOURCE).toMatch(/usePostDetailMode\(\{/);
    expect(SOURCE).toMatch(/panelTab: detailPanelTab/);
    expect(SOURCE).toMatch(/source: 'for-you'/);
  });

  it('feeds the resolver the two conditions that outrank everything else', () => {
    expect(SOURCE).toMatch(/const inputActive = useNavigationInputActive\(stageContainerRef\)/);
    expect(SOURCE).toMatch(/inputActive,/);
    expect(SOURCE).toMatch(/messagesOpen/);
  });

  it('drives every input from the shared sequence controller, not a local index step', () => {
    expect(SOURCE).toMatch(/const sequence = usePostDetailSequence\(\{/);
    expect(SOURCE).toMatch(/const navigate = sequence\.navigate/);
    expect(SOURCE).toMatch(/const canPrevious = Boolean\(sequence\.previousPost\)/);
    expect(SOURCE).toMatch(/const canNext = sequence\.canNext/);
    // wheel, drag and the up/down capsule all read those same two flags.
    expect(SOURCE).toMatch(/usePostNavigationWheel\(\{\s*canPrevious,\s*canNext,/);
    expect(SOURCE).toMatch(/usePostDragNavigation\(\{\s*canPrevious,\s*canNext,/);
    expect(SOURCE).toMatch(/canPrevious=\{canPrevious\}/);
    expect(SOURCE).toMatch(/canNext=\{canNext\}/);
  });

  it('takes the creator grid from the sequence, so the grid and the arrows read one list', () => {
    expect(SOURCE).toMatch(/const creatorVideos = sequence\.creatorPosts/);
    // The capture lives in `usePostDetailMode`; nothing here re-derives it.
    expect(SOURCE).not.toMatch(/creatorScopeCreatorId/);
    expect(SOURCE).toMatch(/creatorId,/);
  });

  it('keeps the feed position while creator mode shows a post the feed does not hold', () => {
    expect(SOURCE).toMatch(/const \[creatorStagePost, setCreatorStagePost\]/);
    expect(SOURCE).toMatch(/const activePost = creatorStagePost \|\| posts\[currentIndex\]/);
    // A neighbour that *is* in the feed moves the index, so impressions, watch
    // tracking and prefetch keep following it.
    expect(SOURCE).toMatch(/if \(feedIndex >= 0\) \{\s*setCreatorStagePost\(null\);\s*setCurrentIndex\(feedIndex\);/);
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

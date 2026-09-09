'use client';

import { IPost } from '@interfaces/post';
import Image from 'next/image';
import { ReactNode } from 'react';

import { getPostBlurPlaceholder, getPostMedia } from './home-feed-media';

interface PostFeedDragViewportProps {
  /** Height of one slide, in CSS pixels. The unit every transform below uses. */
  itemHeight: number;
  /** Signed finger travel; negative while dragging up towards the next post. */
  dragDeltaY: number;
  /** `0` while the finger is down, so the stage tracks it exactly. */
  transitionMs: number;
  /** The neighbour currently uncovered, or null when the stage is at rest. */
  previewDirection: 'next' | 'previous' | null;
  previousPost?: IPost | null;
  nextPost?: IPost | null;
  /** The live post: a real stage, with its player, its rail and its tracking. */
  children: ReactNode;
  /**
   * Extra classes for the current slide.
   *
   * The feeds' stages fill their box; the popup's graphic layout centres its
   * media with flex, and the slide is what has to carry that or the framing
   * shifts the moment the viewport is introduced.
   */
  currentClassName?: string;
}

/**
 * A still frame of a post: its cover over its own blurred placeholder.
 *
 * `contain` matches what the live stage does with the same media, so the moment
 * the commit swaps the still for the player the framing does not jump.
 */
function PostPreviewSlide({ post }: { post: IPost }) {
  const cover = getPostMedia(post);
  const placeholder = getPostBlurPlaceholder(post);

  return (
    /*
      The same card the live stage draws: `--post-video-player-width` is
      published by `PostVideoStage`, so the preview is the same width, the same
      radius and the same ground. Without it the incoming post was full-bleed
      and square-cornered while the one leaving was an inset rounded card, and
      the two never looked like the same stack.
    */
    <div
      className="relative h-full overflow-hidden rounded-2xl bg-black shadow-[0_24px_70px_rgba(0,0,0,.32)]"
      style={{ width: 'var(--post-video-player-width, 100%)' }}
    >
      {placeholder ? (
        <Image
          src={placeholder}
          alt=""
          fill
          sizes="100vw"
          unoptimized
          loading="eager"
          className="scale-110 object-cover blur-2xl"
        />
      ) : null}
      <Image
        src={cover}
        alt=""
        fill
        sizes="100vw"
        // The preview is decorative and short-lived; going through the
        // optimizer would add a round trip in the middle of a gesture.
        unoptimized
        /*
          Eager, deliberately. These slides sit a full stage outside a clipping
          box, so the browser correctly considers them out of view and would
          defer them — and a preview that starts loading when the finger goes
          down shows a blank card for the first third of the gesture, which is
          the defect this whole slide exists to avoid. Measured: with lazy
          loading `image.complete` was false at `pointerdown`.
        */
        loading="eager"
        className="relative object-contain"
      />
    </div>
  );
}

/**
 * One adjacent slide, parked exactly one stage away.
 *
 * Both neighbours stay mounted while they exist, which is what makes the
 * gesture instant: a slide mounted at `pointerdown` has not fetched its cover
 * yet, so the first third of every drag showed a bare blur placeholder where
 * the next post should have been. Clipping — not unmounting — is what keeps
 * them out of sight, and the cost is one decoded still per neighbour.
 */
function PreviewSlot({
  direction, post, offset, itemHeight, transition, uncovered
}: {
  direction: 'next' | 'previous';
  post: IPost;
  offset: number;
  itemHeight: number;
  transition: string;
  uncovered: boolean;
}) {
  return (
    <div
      className="absolute inset-x-0 top-0 will-change-transform"
      data-testid={`post-drag-preview-${direction}`}
      data-uncovered={uncovered ? 'true' : 'false'}
      aria-hidden="true"
      style={{ height: itemHeight, transform: `translate3d(0, ${offset}px, 0)`, transition }}
    >
      <PostPreviewSlide post={post} />
    </div>
  );
}

/**
 * The clipped stage that makes a drag look like a stack of cards.
 *
 * ## The three transforms
 *
 * Every slide is one `itemHeight` tall and absolutely placed at the same origin,
 * so a single signed number positions all three:
 *
 * | slide    | `translate3d(0, …, 0)`      | at rest      |
 * |----------|-----------------------------|--------------|
 * | current  | `dragDeltaY`                | `0`          |
 * | next     | `itemHeight + dragDeltaY`   | one below    |
 * | previous | `-itemHeight + dragDeltaY`  | one above    |
 *
 * They move together, which is the whole effect: dragging up by 200px lifts the
 * current post 200px off the top *and* brings the next one 200px into view, with
 * no gap and no overlap at any point in between.
 *
 * `translate3d` rather than `top` or `translateY`: it is composited, so the
 * whole gesture runs off the main thread and never re-lays-out the stage.
 *
 * ## Why the neighbour is a still, not a stage
 *
 * A preview is something the viewer has not chosen yet. Mounting a real stage
 * for it would start a second video decoding, fire an impression for a post that
 * was never watched, and double the cost of every frame of the drag. So it draws
 * the post's cover — the same image the feed grid uses, usually already in cache
 * — and nothing else. The real stage is mounted when the commit lands, which is
 * also when the impression honestly belongs.
 */
export default function PostFeedDragViewport({
  itemHeight,
  dragDeltaY,
  transitionMs,
  previewDirection,
  previousPost,
  nextPost,
  children,
  currentClassName = ''
}: PostFeedDragViewportProps) {
  const measured = itemHeight > 0;
  const easing = 'cubic-bezier(0.22, 0.61, 0.36, 1)';
  const transition = transitionMs > 0 ? `transform ${transitionMs}ms ${easing}` : 'none';

  return (
    // `overflow-hidden` is what makes the neighbour a preview rather than a
    // second post on the page: it exists, offset by exactly one stage, and is
    // clipped away until the drag uncovers it.
    <div className="absolute inset-0 overflow-hidden" data-testid="post-drag-viewport">
      <div
        className={`absolute inset-0 will-change-transform ${currentClassName}`}
        data-testid="post-drag-current"
        style={{
          transform: measured ? `translate3d(0, ${dragDeltaY}px, 0)` : undefined,
          transition
        }}
      >
        {children}
      </div>

      {measured && previousPost ? (
        <PreviewSlot
          direction="previous"
          post={previousPost}
          offset={-itemHeight + dragDeltaY}
          itemHeight={itemHeight}
          transition={transition}
          uncovered={previewDirection === 'previous'}
        />
      ) : null}

      {measured && nextPost ? (
        <PreviewSlot
          direction="next"
          post={nextPost}
          offset={itemHeight + dragDeltaY}
          itemHeight={itemHeight}
          transition={transition}
          uncovered={previewDirection === 'next'}
        />
      ) : null}
    </div>
  );
}

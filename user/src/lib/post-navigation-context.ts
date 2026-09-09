import type { PostDetailSource } from '@hooks/use-post-detail-sequence';

/**
 * Which list — if any — owns "next" and "previous" right now.
 *
 * | context          | sequence owner             | may change creator | a gesture moves the post |
 * |------------------|----------------------------|--------------------|--------------------------|
 * | `recommendation` | the recommendation session | yes                | yes                      |
 * | `creator`        | one creator's posts        | no                 | yes                      |
 * | `disabled`       | nothing                    | n/a                | no                       |
 *
 * There is exactly **one** definition of this, and every input reads it: the
 * wheel, the trackpad, touch swipe, the arrow keys, the up/down capsule, and the
 * detail popup's next/previous. A surface that decides for itself is how the
 * photo layout and the video layout came to disagree about what the creator grid
 * meant, and how the For You stage kept walking the recommendation feed while a
 * creator's grid was on screen beside it.
 */
export type PostNavigationContext = 'recommendation' | 'creator' | 'disabled';

/** Sources whose sequence is one creator's posts however the panel is set. */
const CREATOR_SCOPED_SOURCES: PostDetailSource[] = ['profile-videos', 'creator-videos-tab'];

/** The one panel tab that navigates. Every other open tab disables navigation. */
export const CREATOR_PANEL_TAB = 'videos';

export interface NavigationContextInput {
  /**
   * The detail panel tab currently showing, or `null` when the panel is closed.
   *
   * `'videos'` is the creator grid — the only tab whose content is itself a
   * sequence, so it is the only one that keeps navigation alive.
   */
  panelTab: string | null;
  /** Where the surface's list came from. Named, never inferred from the post. */
  source?: PostDetailSource;
  /**
   * A text field has focus, or a pointer is held on a seek bar or a scroller.
   *
   * Outranks every other rule: scrubbing a video is a vertical-ish drag on top
   * of the media, and typing a comment uses the arrow keys. Either one changing
   * the post loses what the viewer was doing, so this wins even in creator mode.
   */
  inputActive?: boolean;
  /**
   * The Messages workspace is open beside the stage. It is a conversation, not a
   * sequence, and it owns the keyboard while it is up.
   */
  messagesOpen?: boolean;
}

/**
 * The single resolver. Pure, so it can be asserted over the whole matrix.
 */
export function resolveNavigationContext({
  panelTab,
  source,
  inputActive = false,
  messagesOpen = false
}: NavigationContextInput): PostNavigationContext {
  if (inputActive) return 'disabled';
  if (messagesOpen) return 'disabled';

  const sourceIsCreatorScoped = source ? CREATOR_SCOPED_SOURCES.includes(source) : false;
  if (sourceIsCreatorScoped || panelTab === CREATOR_PANEL_TAB) return 'creator';

  if (panelTab) return 'disabled';
  return 'recommendation';
}

/** Whether a gesture or key press may move the post at all in this context. */
export function navigationContextMoves(context: PostNavigationContext): boolean {
  return context !== 'disabled';
}

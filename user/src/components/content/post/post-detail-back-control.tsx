'use client';

import type { PostDetailMode } from '@hooks/use-post-detail-mode';
import { IPost } from '@interfaces/post';
import { useCallback, useEffect, useRef } from 'react';
import { FaChevronLeft, FaTimes } from 'react-icons/fa';

/**
 * The popup's top-left control: Close, or Back out of the Videos tab.
 *
 * ## Why this is shared rather than written per layout
 *
 * It was written once, inside the *video* layout. `GraphicPostDetail` drew its
 * own button — always an X, wired straight to `onClose` — so opening the Videos
 * tab on an **image** post left the control saying "close the popup" while the
 * creator grid was on screen, and pressing it threw the viewer out of the modal
 * instead of back to the post they came from.
 *
 * That is the same class of defect the mode itself was introduced to end: two
 * components deciding the same thing from different inputs. The decision here
 * is the shared navigation mode — never `post.type`, never "is a video element
 * mounted", never a callback that only the video stage can fire — so a photo
 * and a video behave identically, and stepping between them mid-sequence
 * cannot change what the button means.
 */
/**
 * The post creator mode was entered on — remembered *above* the layout swap.
 *
 * This must be called from `PostDetailModal`, never from either layout. A photo
 * and a video are drawn by different components, so stepping from one to the
 * other unmounts the layout and destroys anything it held. Held inside a
 * layout, this ref was re-seeded with whichever creator post had just been
 * opened, and — because creator mode was already active, so the guard below
 * never fired — it stayed wrong. Back then "returned" to the post the viewer
 * was already on.
 *
 * Measured in a real browser before the lift: video base -> video creator post
 * restored the base correctly, while video base -> *photo* creator post and
 * graphic base -> *video* creator post both left the viewer on the creator
 * post. The passing case was the one where no swap happened, which is exactly
 * why the media type must never be what decides this.
 */
export function usePostDetailBackOrigin(mode: PostDetailMode, post: IPost): IPost {
  const originRef = useRef(post);
  useEffect(() => {
    if (mode !== 'creator') originRef.current = post;
  }, [mode, post]);
  return originRef.current;
}

interface PostDetailBackControlOptions {
  /** The one owner of "which list is navigating" — see `usePostDetailMode`. */
  mode: PostDetailMode;
  /** The open panel tab, so leaving creator mode is a tab change. */
  detailPanelTab: string | null;
  onDetailPanelTabChange: (tab: any) => void;
  /** The post currently open. */
  post: IPost;
  /** Where Back returns to — from `usePostDetailBackOrigin`, above the swap. */
  originPost: IPost;
  onNavigate: (post: IPost) => void;
  /** Fully close the popup — the layout supplies this so it can flush playback. */
  onClose: () => void;
  /**
   * Some surfaces open the popup *directly into* the creator grid (For You's
   * avatar tap). There, Back has nowhere to return to inside the popup, so it
   * closes — which is what the viewer expects from the control they pressed.
   */
  closeOnVideoModeBack?: boolean;
}

export interface PostDetailBackControl {
  /** True while the Videos tab owns navigation: the control means "Back". */
  isBack: boolean;
  label: string;
  activate: () => void;
}

export function usePostDetailBackControl({
  mode,
  detailPanelTab,
  onDetailPanelTabChange,
  post,
  originPost,
  onNavigate,
  onClose,
  closeOnVideoModeBack = false
}: PostDetailBackControlOptions): PostDetailBackControl {
  const isBack = mode === 'creator';

  const activate = useCallback(() => {
    if (!isBack) {
      onClose();
      return;
    }
    if (closeOnVideoModeBack) {
      onClose();
      return;
    }
    // Closing the panel *is* leaving creator mode — the mode is derived from
    // the open tab — so there is nothing else to reset.
    if (detailPanelTab === 'videos') onDetailPanelTabChange(null);
    // Back returns to where creator mode began, not to whichever of the
    // creator's posts happens to be open.
    if (originPost && originPost._id !== post._id) onNavigate(originPost);
  }, [
    closeOnVideoModeBack, detailPanelTab, isBack, onClose,
    onDetailPanelTabChange, onNavigate, originPost, post._id
  ]);

  return {
    isBack,
    label: isBack ? 'Exit creator videos' : 'Close post details',
    activate
  };
}

interface PostDetailBackButtonProps {
  control: PostDetailBackControl;
  className: string;
  buttonRef?: React.Ref<HTMLButtonElement>;
}

/** One button, one icon rule, one accessible name — for both layouts. */
export default function PostDetailBackButton({
  control, className, buttonRef
}: PostDetailBackButtonProps) {
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={control.activate}
      className={className}
      aria-label={control.label}
      data-detail-back={control.isBack ? 'true' : 'false'}
    >
      {control.isBack ? <FaChevronLeft /> : <FaTimes />}
    </button>
  );
}

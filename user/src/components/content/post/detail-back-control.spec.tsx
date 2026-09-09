import fs from 'fs';
import path from 'path';

import { IPost } from '@interfaces/post';
import { act, renderHook } from '@testing-library/react';

import { usePostDetailBackControl, usePostDetailBackOrigin } from './post-detail-back-control';

/**
 * The popup's top-left control is decided by navigation mode, never by media
 * type.
 *
 * ## The defect
 *
 * The Back behaviour lived inside `VideoPostDetail`. `GraphicPostDetail` drew
 * its own button — always `<FaTimes />`, wired straight to `onClose` — so an
 * **image** post with the Videos tab open showed X while the creator's grid was
 * on screen, and pressing it closed the whole popup instead of returning to the
 * post the viewer came from.
 *
 * Both layouts now call this one hook, so a photo and a video cannot disagree,
 * and stepping between them mid-sequence cannot change what the button means.
 */
const post = (id: string, type: 'video' | 'photo'): IPost => ({
  _id: id, title: id, type, files: [], user: { _id: 'creator-1' }
} as unknown as IPost);

const VIDEO_BASE = post('V0', 'video');
const IMAGE_BASE = post('I0', 'photo');
const CREATOR_VIDEO = post('CV', 'video');
const CREATOR_IMAGE = post('CI', 'photo');

function setup(initial: {
  mode: 'recommendation' | 'creator' | 'disabled';
  tab: string | null;
  post: IPost;
  closeOnVideoModeBack?: boolean;
}) {
  const onClose = jest.fn();
  const onNavigate = jest.fn();
  const onDetailPanelTabChange = jest.fn();
  /*
    Composed exactly as `PostDetailModal` composes them: the origin is
    remembered above the layout swap, the control is used inside it. Calling
    `usePostDetailBackControl` alone would test an arrangement the app does not
    have — and would not have caught the swap defect below.
  */
  const view = renderHook(
    (props: { mode: any; tab: string | null; post: IPost }) => {
      const originPost = usePostDetailBackOrigin(props.mode, props.post);
      return usePostDetailBackControl({
        mode: props.mode,
        detailPanelTab: props.tab,
        onDetailPanelTabChange,
        post: props.post,
        originPost,
        onNavigate,
        onClose,
        closeOnVideoModeBack: initial.closeOnVideoModeBack
      });
    },
    { initialProps: { mode: initial.mode, tab: initial.tab, post: initial.post } }
  );
  return {
    ...view, onClose, onNavigate, onDetailPanelTabChange
  };
}

describe('popup top-left control', () => {
  describe('base mode closes', () => {
    it.each([['video', VIDEO_BASE], ['image', IMAGE_BASE]])('%s post: X that closes', (_kind, base) => {
      const { result, onClose, onDetailPanelTabChange } = setup({
        mode: 'recommendation', tab: null, post: base
      });
      expect(result.current.isBack).toBe(false);
      expect(result.current.label).toBe('Close post details');
      act(() => result.current.activate());
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onDetailPanelTabChange).not.toHaveBeenCalled();
    });
  });

  /**
   * The four transitions the brief names. Each opens Videos from a base post,
   * steps to a creator post of some media type, and presses Back.
   */
  describe.each([
    ['video base -> video creator post', VIDEO_BASE, CREATOR_VIDEO],
    ['video base -> image creator post', VIDEO_BASE, CREATOR_IMAGE],
    ['image base -> image creator post', IMAGE_BASE, CREATOR_IMAGE],
    ['image base -> video creator post', IMAGE_BASE, CREATOR_VIDEO]
  ])('%s', (_label, base, creatorPost) => {
    it('shows Back, exits the tab, restores the base post, and never closes', () => {
      const {
        result, rerender, onClose, onNavigate, onDetailPanelTabChange
      } = setup({ mode: 'recommendation', tab: null, post: base });

      // Open Videos — mode becomes creator.
      rerender({ mode: 'creator', tab: 'videos', post: base });
      expect(result.current.isBack).toBe(true);
      expect(result.current.label).toBe('Exit creator videos');

      // Step onto a creator post; the media type must change nothing.
      rerender({ mode: 'creator', tab: 'videos', post: creatorPost });
      expect(result.current.isBack).toBe(true);
      expect(result.current.label).toBe('Exit creator videos');

      act(() => result.current.activate());
      expect(onDetailPanelTabChange).toHaveBeenCalledWith(null);
      expect(onNavigate).toHaveBeenCalledWith(base);   // back to where we came from
      expect(onClose).not.toHaveBeenCalled();          // the popup stays mounted
    });
  });

  it('media type alone never changes the control', () => {
    const { result, rerender } = setup({ mode: 'recommendation', tab: null, post: VIDEO_BASE });
    rerender({ mode: 'recommendation', tab: null, post: IMAGE_BASE });
    expect(result.current.isBack).toBe(false);
    rerender({ mode: 'creator', tab: 'videos', post: IMAGE_BASE });
    expect(result.current.isBack).toBe(true);
    rerender({ mode: 'creator', tab: 'videos', post: CREATOR_VIDEO });
    expect(result.current.isBack).toBe(true);
  });

  it('remembers the post creator mode was entered on, not the one left open', () => {
    const { result, rerender, onNavigate } = setup({
      mode: 'recommendation', tab: null, post: IMAGE_BASE
    });
    rerender({ mode: 'creator', tab: 'videos', post: IMAGE_BASE });
    rerender({ mode: 'creator', tab: 'videos', post: CREATOR_VIDEO });
    rerender({ mode: 'creator', tab: 'videos', post: CREATOR_IMAGE });
    act(() => result.current.activate());
    expect(onNavigate).toHaveBeenCalledWith(IMAGE_BASE);
  });

  it('does not navigate when Back lands on the post already open', () => {
    const { result, rerender, onNavigate } = setup({
      mode: 'recommendation', tab: null, post: IMAGE_BASE
    });
    rerender({ mode: 'creator', tab: 'videos', post: IMAGE_BASE });
    act(() => result.current.activate());
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('closes instead, when the popup was opened straight into the grid', () => {
    const { result, rerender, onClose } = setup({
      mode: 'recommendation', tab: null, post: IMAGE_BASE, closeOnVideoModeBack: true
    });
    rerender({ mode: 'creator', tab: 'videos', post: CREATOR_IMAGE });
    act(() => result.current.activate());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a non-navigating tab is not creator mode, so the control still closes', () => {
    const { result, rerender, onClose } = setup({
      mode: 'recommendation', tab: null, post: IMAGE_BASE
    });
    rerender({ mode: 'disabled', tab: 'comments', post: IMAGE_BASE });
    expect(result.current.isBack).toBe(false);
    act(() => result.current.activate());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

/** Both layouts must render the one control, and neither may keep its own. */
const MODAL = fs.readFileSync(path.join(__dirname, 'post-detail-modal.tsx'), 'utf8');

describe('both layouts use the shared control', () => {
  it('renders PostDetailBackButton twice — once per layout', () => {
    expect(MODAL.match(/<PostDetailBackButton/g)).toHaveLength(2);
  });

  it('neither layout hard-codes a close-only button any more', () => {
    expect(MODAL).not.toMatch(/aria-label="Close graphic details"/);
    expect(MODAL).not.toMatch(/aria-label=\{videoModeActive \? 'Exit creator videos' : 'Close video'\}/);
  });

  /*
    The defect a real browser found after the first version shipped.

    `usePostDetailBackOrigin` MUST be called above the photo/video swap. Called
    inside a layout, crossing a media-type boundary unmounts it, the ref is
    re-seeded with the creator post just opened, and Back "returns" to the post
    the viewer is already on. It passed on video->video, which is the case with
    no swap — so the wiring, not just the logic, has to be pinned.
  */
  it('the modal owns the origin, above the layout swap', () => {
    expect(MODAL).toMatch(/const originPost = usePostDetailBackOrigin\(mode, props\.post\);/);
    // Imported once and called once, in `PostDetailModal` — never in a layout.
    expect(MODAL.match(/usePostDetailBackOrigin/g)).toHaveLength(2);
    // Handed to both layouts.
    expect(MODAL.match(/originPost=\{originPost\}/g)).toHaveLength(2);
  });

  it('the control takes the origin as an input and keeps no ref of its own', () => {
    const control = fs.readFileSync(path.join(__dirname, 'post-detail-back-control.tsx'), 'utf8');
    const hook = control.slice(control.indexOf('export function usePostDetailBackControl'));
    expect(hook).not.toMatch(/useRef/);
    expect(hook).toMatch(/originPost/);
  });

  it('the control is never derived from media type', () => {
    const control = fs.readFileSync(path.join(__dirname, 'post-detail-back-control.tsx'), 'utf8');
    // Strip comments first: the doc block deliberately *names* the inputs this
    // must not use, and matching prose would pass or fail for the wrong reason.
    const code = control
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(code).not.toMatch(/post\.type|mediaTypes|isGraphicPost|isVideoPost/);
    expect(code).toMatch(/const isBack = mode === 'creator';/);
  });

  it('Escape in the graphic layout exits the tab before closing', () => {
    expect(MODAL).toMatch(/if \(event\.key === 'Escape'\) backControl\.activate\(\);/);
  });
});

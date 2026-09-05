'use client';

export interface PopupPipVideo {
  videoId: string;
  /**
   * The post this video belongs to.
   *
   * The picture-in-picture window asks the server for its own next video, so it
   * needs a post id it can send — `videoId` is a prefixed display key, and
   * parsing an id back out of it is exactly the kind of inference that breaks
   * the first time the prefix changes.
   */
  postId: string;
  src: string;
  poster?: string;
  description?: string;
  author?: string;
  date?: string;
  duration?: string;
  currentTime?: number;
  isPlaying?: boolean;
}

/**
 * Everything the picture-in-picture window needs to keep navigating on its own.
 *
 * It used to carry a `playlist`: the Home grid's video posts, in rendered
 * order. "Next" was therefore whichever card happened to sit below the one
 * playing, which is not a recommendation — it is the DOM. The window now walks
 * a **Post Detail recommendation session**, the same anchor-based sequence the
 * detail viewer uses (`useRecommendationDetailFeed`), so both surfaces share
 * one selection pipeline rather than two unrelated ones.
 */
export interface PopupPipState {
  active: boolean;
  video: PopupPipVideo;
  /**
   * What this PiP session has actually played, oldest first. "Previous" walks
   * back through it and never recomputes — the viewer must be able to return
   * to what they just saw, not to a fresh guess.
   */
  history: PopupPipVideo[];
  /** Index of `video` within `history`. */
  historyIndex: number;
  /**
   * The Post Detail recommendation session backing "next". Null until the first
   * "next" opens one, and reset whenever the anchor changes from outside (the
   * main feed pushing a different post in).
   */
  sessionId?: string | null;
  /** Set once the server reports no unseen eligible video left for this session. */
  exhausted?: boolean;
}

/**
 * Ceiling on the remembered history.
 *
 * The server's detail session caps itself at `DETAIL_SESSION_POLICY.maxItems`,
 * so this is not the thing that bounds navigation — it bounds what is written
 * into `localStorage`, which every write serialises in full.
 */
export const MAX_PIP_HISTORY = 60;

export interface PopupPipDetailRequest {
  videoId: string;
  currentTime: number;
  requestedAt: number;
}

interface OpenPopupPipOptions {
  videoElement?: HTMLVideoElement | null;
}

interface DocumentPictureInPictureController {
  window?: Window | null;
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
}

type WindowWithDocumentPictureInPicture = Window & {
  documentPictureInPicture?: DocumentPictureInPictureController;
};

const STORAGE_KEY = 'douyin-clone-popup-pip-state';
const CHANNEL_NAME = 'douyin-clone-popup-pip';
const DETAIL_CHANNEL_NAME = 'douyin-clone-popup-pip-open-detail';
const WINDOW_NAME = 'douyin-clone-popup-pip-window';
let popupWindow: Window | null = null;
let documentPipWindow: Window | null = null;

function getChannel() {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(CHANNEL_NAME);
}

export function getPostIdFromPopupVideoId(videoId: string) {
  const prefix = 'home-feed-';
  return videoId.startsWith(prefix) ? videoId.slice(prefix.length) : videoId;
}

/**
 * Fill in anything a stored state is missing.
 *
 * A PiP window can be open across a deploy, so the shape read back may predate
 * the fields below — an older one carries `playlist` and no history at all.
 * Rebuilding from the current video is right rather than merely safe: whatever
 * that older list held, the viewer has only actually watched what is playing.
 */
function normalizePopupPipState(raw: any): PopupPipState | null {
  if (!raw || typeof raw !== 'object' || !raw.video) return null;

  const video: PopupPipVideo = {
    ...raw.video,
    postId: raw.video.postId || getPostIdFromPopupVideoId(raw.video.videoId || '')
  };
  const history: PopupPipVideo[] = Array.isArray(raw.history) && raw.history.length
    ? raw.history.map((item: any) => ({
      ...item,
      postId: item.postId || getPostIdFromPopupVideoId(item.videoId || '')
    }))
    : [video];
  const foundIndex = history.findIndex((item) => item.videoId === video.videoId);

  return {
    active: Boolean(raw.active),
    video,
    history,
    historyIndex: foundIndex >= 0 ? foundIndex : history.length - 1,
    sessionId: raw.sessionId ?? null,
    exhausted: Boolean(raw.exhausted)
  };
}

export function readPopupPipState(): PopupPipState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? normalizePopupPipState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writePopupPipState(state: PopupPipState | null) {
  if (typeof window === 'undefined') return;
  if (state) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    window.localStorage.removeItem(STORAGE_KEY);
  }

  window.dispatchEvent(new CustomEvent(CHANNEL_NAME, { detail: state }));
  const channel = getChannel();
  channel?.postMessage(state);
  channel?.close();
}

export function subscribePopupPipState(callback: (state: PopupPipState | null) => void) {
  if (typeof window === 'undefined') return () => { };

  // A single write reaches same-document subscribers up to three times (the CustomEvent, the
  // BroadcastChannel echo — two different channel objects in one document do notify each other —
  // and the storage event), and the channel/storage paths deliver structured clones, so every
  // delivery carries a fresh object identity. Forwarding those verbatim makes the state look
  // "changed" on every render for consumers that depend on it, which spirals into an update loop.
  // Only forward deliveries whose serialized content actually differs from the last one seen.
  let lastSerialized = JSON.stringify(readPopupPipState() ?? null);
  const emit = (state: PopupPipState | null) => {
    const serialized = JSON.stringify(state ?? null);
    if (serialized === lastSerialized) return;
    lastSerialized = serialized;
    callback(state);
  };

  const handleWindowEvent = (event: Event) => {
    emit((event as CustomEvent<PopupPipState | null>).detail);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    emit(readPopupPipState());
  };
  const channel = getChannel();
  const handleChannel = (event: MessageEvent<PopupPipState | null>) => {
    emit(event.data);
  };

  window.addEventListener(CHANNEL_NAME, handleWindowEvent);
  window.addEventListener('storage', handleStorage);
  channel?.addEventListener('message', handleChannel);

  return () => {
    window.removeEventListener(CHANNEL_NAME, handleWindowEvent);
    window.removeEventListener('storage', handleStorage);
    channel?.removeEventListener('message', handleChannel);
    channel?.close();
  };
}

/**
 * Move to a video already in this session's history — the "previous" direction,
 * and "next" when the viewer has stepped back and is coming forward again.
 * Replays exactly what was shown; never recomputes.
 */
export function playPopupPipHistoryIndex(state: PopupPipState, index: number) {
  const clamped = Math.min(Math.max(0, index), state.history.length - 1);
  writePopupPipState({ ...state, active: true, video: state.history[clamped], historyIndex: clamped });
}

/**
 * Append a freshly recommended video and play it.
 *
 * `sessionId` travels with it because the first "next" is what opens the detail
 * session — storing it separately would let a reload lose the session while
 * keeping the video it produced, and the replacement session would then start
 * recommending posts already in this history.
 */
export function appendPopupPipVideo(state: PopupPipState, video: PopupPipVideo, sessionId: string | null) {
  const history = [...state.history.slice(0, state.historyIndex + 1), video].slice(-MAX_PIP_HISTORY);
  writePopupPipState({
    ...state,
    active: true,
    video,
    history,
    historyIndex: history.length - 1,
    sessionId,
    exhausted: false
  });
}

/**
 * Push a video in from outside the PiP window — the main feed moving to a
 * different post while PiP is open.
 *
 * The recommendation session is dropped, because the anchor it was built around
 * is no longer what is playing; the next "next" opens a new one anchored here.
 */
export function pushPopupPipVideo(state: PopupPipState, video: PopupPipVideo) {
  const history = [...state.history, video].slice(-MAX_PIP_HISTORY);
  writePopupPipState({
    ...state,
    active: true,
    video,
    history,
    historyIndex: history.length - 1,
    sessionId: null,
    exhausted: false
  });
}

export function requestPopupPipDetail(videoId: string, currentTime = 0) {
  if (typeof window === 'undefined') return;
  const request: PopupPipDetailRequest = {
    videoId,
    currentTime: Number.isFinite(currentTime) ? currentTime : 0,
    requestedAt: Date.now()
  };

  window.dispatchEvent(new CustomEvent(DETAIL_CHANNEL_NAME, { detail: request }));
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(DETAIL_CHANNEL_NAME);
  channel?.postMessage(request);
  channel?.close();
}

export function subscribePopupPipDetailRequest(callback: (request: PopupPipDetailRequest) => void) {
  if (typeof window === 'undefined') return () => { };
  const handleWindowEvent = (event: Event) => {
    callback((event as CustomEvent<PopupPipDetailRequest>).detail);
  };
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(DETAIL_CHANNEL_NAME);
  const handleChannel = (event: MessageEvent<PopupPipDetailRequest>) => callback(event.data);

  window.addEventListener(DETAIL_CHANNEL_NAME, handleWindowEvent);
  channel?.addEventListener('message', handleChannel);
  return () => {
    window.removeEventListener(DETAIL_CHANNEL_NAME, handleWindowEvent);
    channel?.removeEventListener('message', handleChannel);
    channel?.close();
  };
}

function openFallbackPopup(width: number, height: number) {
  const left = Math.max(0, window.screenX + window.outerWidth - width - 48);
  const top = Math.max(0, window.screenY + window.outerHeight - height - 86);
  const features = [
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
    'popup=yes',
    'resizable=yes',
    'scrollbars=no',
    'toolbar=no',
    'menubar=no',
    'location=no',
    'status=no'
  ].join(',');

  if (popupWindow && !popupWindow.closed) {
    popupWindow.focus();
    return;
  }

  popupWindow = window.open('/pip?pip=1', WINDOW_NAME, features);
  popupWindow?.focus();
}

async function openDocumentPip(controller: DocumentPictureInPictureController, width: number, height: number) {
  const existingWindow = controller.window || documentPipWindow;
  if (existingWindow && !existingWindow.closed) {
    documentPipWindow = existingWindow;
    existingWindow.focus();
    return;
  }

  const pipWindow = await controller.requestWindow({ width, height });
  documentPipWindow = pipWindow;
  const pipDocument = pipWindow.document;
  pipDocument.documentElement.style.width = '100%';
  pipDocument.documentElement.style.height = '100%';
  pipDocument.documentElement.style.background = '#000';
  pipDocument.body.replaceChildren();
  pipDocument.body.style.width = '100%';
  pipDocument.body.style.height = '100%';
  pipDocument.body.style.margin = '0';
  pipDocument.body.style.overflow = 'hidden';
  pipDocument.body.style.background = '#000';

  const frame = pipDocument.createElement('iframe');
  frame.src = `${window.location.origin}/pip?pip=1&documentPip=1`;
  frame.title = 'Picture in picture player';
  frame.allow = 'autoplay; fullscreen; picture-in-picture';
  frame.allowFullscreen = true;
  frame.style.width = '100%';
  frame.style.height = '100%';
  frame.style.border = '0';
  frame.style.display = 'block';
  pipDocument.body.appendChild(frame);

  pipWindow.addEventListener('pagehide', () => {
    documentPipWindow = null;
  }, { once: true });
}

function writeClosedPipState(currentTime?: number, isPlaying = true) {
  const state = readPopupPipState();
  if (!state) {
    writePopupPipState(null);
    return;
  }
  writePopupPipState({
    ...state,
    active: false,
    video: {
      ...state.video,
      currentTime: Number.isFinite(currentTime) ? currentTime : state.video.currentTime,
      isPlaying
    }
  });
}

/**
 * Open (or re-focus) the picture-in-picture window on one video.
 *
 * It takes no playlist. The window asks the server for its own next video, so
 * handing it the surrounding grid would only give it a second, contradictory
 * idea of what "next" means — which is the behaviour this replaced.
 */
export function openPopupPip(
  video: PopupPipVideo,
  options: OpenPopupPipOptions = {}
) {
  if (typeof window === 'undefined') return;

  const sourceCurrentTime = options.videoElement?.currentTime;
  const nextVideo: PopupPipVideo = {
    ...video,
    currentTime: Number.isFinite(sourceCurrentTime) ? sourceCurrentTime : video.currentTime || 0,
    isPlaying: options.videoElement ? !options.videoElement.paused : true
  };

  const existing = readPopupPipState();
  // Re-opening on the video already playing keeps the session and the history:
  // clicking the PiP button again is not a new browsing session.
  const isSameVideo = existing?.video.videoId === nextVideo.videoId;

  writePopupPipState({
    active: true,
    video: nextVideo,
    history: isSameVideo && existing ? existing.history : [nextVideo],
    historyIndex: isSameVideo && existing ? existing.historyIndex : 0,
    sessionId: isSameVideo && existing ? existing.sessionId ?? null : null,
    exhausted: false
  });

  const width = 476;
  const height = 364;

  options.videoElement?.pause();

  const documentPipController = (window as WindowWithDocumentPictureInPicture).documentPictureInPicture;
  if (documentPipController) {
    void openDocumentPip(documentPipController, width, height).catch(() => {
      openFallbackPopup(width, height);
    });
    return;
  }

  openFallbackPopup(width, height);
}

export function closePopupPip(currentTime?: number, isPlaying = true) {
  writeClosedPipState(currentTime, isPlaying);
  if (document.pictureInPictureElement) {
    void document.exitPictureInPicture().catch(() => { });
  }
}

/** Closes the floating PiP window/frame from the page that opened it, so playback can resume inline. */
export function closePopupPipWindow() {
  if (documentPipWindow && !documentPipWindow.closed) {
    documentPipWindow.close();
  }
  if (popupWindow && !popupWindow.closed) {
    popupWindow.close();
  }
}

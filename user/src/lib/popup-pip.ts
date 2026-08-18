'use client';

export interface PopupPipVideo {
  videoId: string;
  src: string;
  poster?: string;
  description?: string;
  author?: string;
  date?: string;
  duration?: string;
  currentTime?: number;
  isPlaying?: boolean;
}

export interface PopupPipState {
  active: boolean;
  video: PopupPipVideo;
  playlist: PopupPipVideo[];
}

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

export function readPopupPipState(): PopupPipState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as PopupPipState : null;
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

export function openPopupPip(
  video: PopupPipVideo,
  playlist: PopupPipVideo[] = [video],
  options: OpenPopupPipOptions = {}
) {
  if (typeof window === 'undefined') return;

  const sourceCurrentTime = options.videoElement?.currentTime;
  const nextVideo: PopupPipVideo = {
    ...video,
    currentTime: Number.isFinite(sourceCurrentTime) ? sourceCurrentTime : video.currentTime || 0,
    isPlaying: options.videoElement ? !options.videoElement.paused : true
  };

  writePopupPipState({
    active: true,
    video: nextVideo,
    playlist: playlist.length ? playlist : [video]
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

import { IPost } from '@interfaces/post';
import { PopupPipVideo } from '@lib/popup-pip';

export function formatCompactCount(value?: number) {
  const count = value || 0;
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
  return `${count}`;
}

function getFirstFile(post: IPost) {
  return Array.isArray(post.files) ? post.files[0] : null;
}

function getFirstVideo(post: IPost) {
  return Array.isArray(post.files)
    ? post.files.find((file: any) => file?.type?.includes?.('video'))
    : null;
}

export function getPostImages(post: IPost) {
  return Array.isArray(post.files)
    ? post.files.filter(file => file?.type?.includes?.('photo') && file.url)
    : [];
}

export function getPostMedia(post: IPost) {
  const firstFile = getFirstFile(post);
  const selectedCover = post.coverDisplayRatio === '3:4'
    ? post.cover3x4Url
    : post.cover4x3Url;
  return selectedCover
    || post.cover4x3Url
    || post.thumbnailUrl
    || firstFile?.thumbnails?.[0]
    || firstFile?.url
    || post.teaser?.thumbnailUrl
    || '/no-image.png';
}

export function getPostVideo(post: IPost) {
  return getFirstVideo(post)?.url || post.teaser?.url || '';
}

export function isVideoPost(post: IPost) {
  const hasVideoFile = Array.isArray(post.files)
    ? post.files.some((file: any) => file?.type?.includes?.('video'))
    : false;
  return hasVideoFile || post.type?.includes?.('video');
}

export function isGraphicPost(post: IPost) {
  return !isVideoPost(post) && getPostImages(post).length > 0;
}

export function supportsPostDetail(post: IPost) {
  return isGraphicPost(post) || (isVideoPost(post) && Boolean(getPostVideo(post)));
}

export function getPostDuration(post: IPost) {
  const duration = getFirstVideo(post)?.duration || getFirstFile(post)?.duration || post.teaser?.duration;
  if (!duration) return '';
  const totalSeconds = Math.floor(duration);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function getPopupVideo(post: IPost): PopupPipVideo | null {
  const src = getPostVideo(post);
  if (!src || !isVideoPost(post)) return null;
  const creator = post.user;
  const metaName = creator?.name || creator?.username || 'Unknown';
  const timeText = post.createdAt
    ? new Date(post.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '';

  return {
    videoId: `home-feed-${post._id}`,
    src,
    poster: getPostMedia(post),
    description: post.text || post.tagline,
    author: `@${metaName}`,
    date: timeText,
    duration: getPostDuration(post)
  };
}

export function getPostIdFromPopupVideoId(videoId: string) {
  const prefix = 'home-feed-';
  return videoId.startsWith(prefix) ? videoId.slice(prefix.length) : videoId;
}

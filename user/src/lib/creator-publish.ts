export type CreatorPublishTabKey =
  | 'uploadVideo'
  | 'uploadGraphic'
  | 'uploadVR'
  | 'publishArticle';

export const CREATOR_PUBLISH_TABS: Array<{ key: CreatorPublishTabKey; text: string }> = [
  { key: 'uploadVideo', text: 'Upload videos' },
  { key: 'uploadGraphic', text: 'Upload graphics' },
  { key: 'uploadVR', text: 'Upload VR' },
  { key: 'publishArticle', text: 'Publish an article' }
];

export const CREATOR_VIDEO_ACCEPT = 'video/x-flv,video/mp4,video/x-m4v,video/*,.flv,.avi,.wmv,.webm,.ts,.mp4,.mpeg4,.mov,.m4v,.mpg,.mkv,.m4';
export const CREATOR_PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.bmp,.tif,.tiff,.raw';

export function getCreatorPublishUrl(tab: CreatorPublishTabKey) {
  const params = new URLSearchParams({ tab });
  return `/creator/publish?${params.toString()}`;
}

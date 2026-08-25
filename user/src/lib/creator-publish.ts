import {
  acceptAttributeFor,
  POST_PHOTO_UPLOAD_TYPE,
  POST_VIDEO_UPLOAD_TYPE
} from '@lib/upload-policy';

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

/**
 * What the creator publish pickers advertise, from the policies themselves.
 *
 * The hand-written strings these replace offered FLV, AVI, WMV, MKV and MPG on
 * the video side and BMP, TIFF and RAW on the photo side — none of which the
 * pipeline accepts. A picker that invites a file the server will always refuse
 * is worse than one that says nothing: it costs the whole upload before anyone
 * finds out.
 *
 * A hint either way. `accept` is bypassed by choosing "All files" and ignored
 * outright on some platforms, so the file server decides from the bytes.
 */
export const CREATOR_VIDEO_ACCEPT = acceptAttributeFor(POST_VIDEO_UPLOAD_TYPE);
export const CREATOR_PHOTO_ACCEPT = acceptAttributeFor(POST_PHOTO_UPLOAD_TYPE);

export function getCreatorPublishUrl(tab: CreatorPublishTabKey) {
  const params = new URLSearchParams({ tab });
  return `/creator/publish?${params.toString()}`;
}

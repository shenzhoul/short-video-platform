---
name: media-response-standardization
description: Media response and frontend consumption conventions for Douyin Clone posts, profile images, and file-server metadata. Use when changing file DTOs, post media payloads, thumbnails, posters, blur data, dimensions, or media URL handling.
---

# Media Response Standardization

Treat API DTOs as the media contract. Do not expose raw file-server records or make UI components reconstruct internal paths.

## Current References

- `api/src/dtos/shared/file-server/file-server.dto.ts`
- `api/src/dtos/content/post.dto.ts`
- `api/src/dtos/content/post-video-draft.dto.ts`
- `user/src/interfaces/post.ts`
- `user/src/components/content/post/home-feed-media.ts`
- `user/src/components/content/post/home-feed-cover-image.tsx`
- `user/src/components/content/post/home-feed-graphic-carousel.tsx`
- `user/src/components/content/post/post-detail-modal.tsx`
- `user/src/hooks/use-post-detail-navigation.ts`
- `user/src/components/content/post/post-media-display.tsx`
- `user/src/components/shared/file-thumb.tsx`

## Rules

- Map only public media fields needed by the consumer.
- Keep file ID, public URL, media type, dimensions, thumbnail/poster, and processing status consistent where applicable.
- Prefer nested media data for new contracts; preserve a legacy flat field only when a current consumer still depends on it.
- Render using API-returned URLs and metadata.
- Keep image and video fallback behavior explicit.
- Update API DTO, frontend interface, mapper, and rendering consumer in the same change.
- Post DTOs expose independent `cover4x3Url` and `cover3x4Url` values plus `coverDisplayRatio`. Home uses the ratio to select the matching URL, with `4:3` as the legacy/default fallback, but preserves the established card/grid aspect. Portrait sources are contained over a blurred copy of the same source instead of stretching the card.
- A graphics post cover is one of its main images. Keep the selected cover first in the ordered `fileIds` rather than uploading a duplicate accessory thumbnail.
- Profile graphic cards and graphic details consume the ordered public `files` array: the first photo is the card cover and the full array is the detail carousel. Use one public post-detail modal with explicit internal video and graphics renderers so image posts never enter video playback/PiP logic. Build popup previous/next navigation from one ordered mixed-media post list so crossing a type boundary switches renderers without omitting posts.
- Home graphic cards also consume the complete ordered public `files` array. Use the first photo initially and let in-card previous/next controls change only the visible photo; do not route image posts through video hover playback or rebuild file-server paths in the card.
- Graphic detail autoplay uses the shared React Slick carousel with a four-second timeline-driven transition. Use `GRAPHIC_SLIDE_DURATION_MS` as the single duration source for publishing previews and public details. The full-width timeline is the playback clock so pause/resume cannot drift from image changes; do not add an independent interval beside Slick.
- Video and graphic detail surfaces share `usePostDetailNavigation`, `PostNavigationControls`, and the action rail. Graphics must pass explicit interaction state and panel callbacks when rendered outside `PostVideoStage`; otherwise the action rail falls back to an empty video context and comment/avatar actions silently do nothing. Use `usePostInteractionState` for active-post button values and stable callbacks, and `usePostInteractionUpdater` for collection ownership; do not recreate independent like/comment state in each modal or page. Successful interaction mutations must patch the owning post collection, not only modal-local state, so the open detail and its Home/Profile/For You card cannot diverge after like/unlike or comment create/delete. Feed patch helpers should preserve the existing post object and collection when values are unchanged. Keep comment-total callbacks stable, pass the current total back into `CommentWrapper`, and make state updates idempotent because `CommentWrapper` publishes totals from an effect. Media-specific action differences must be explicit variants: graphics omit video-only AI entry points and label the related-content action **Related**. Horizontal carousel arrows remain scoped to images within the active graphic post.
- `blurImage` is a visual fallback only. Creator cover selectors use normal generated thumbnails and may apply blur solely through CSS in the editing preview.
- Normalize file-server thumbnail variants at the API DTO boundary. Current internal responses return URL strings; legacy metadata objects may be accepted there for compatibility, but public post/draft consumers receive URL strings.
- Treat the Cover/Title Horizontal/Vertical selection as the source of `coverDisplayRatio`; avoid a second control that can disagree with the preview.

## Verification

- Check image, video, missing thumbnail/poster, processing, failed processing, and legacy response cases.
- Run verification for every touched app.

---
title: Post Publishing
description: Creator-owned text, photo, and video post lifecycle.
audience: [creator, developer-agent]
domain: content
status: active
updated: 2026-08-13
tags: [post, publish, photo, video, cover]
---

# Post Publishing

## Supported content

`PostCreatePayload` accepts `text`, `photo`, and `video`. Posts may contain sanitized text, title, tagline, owned attachment IDs, optional thumbnail/teaser IDs, and separate `4:3` and `3:4` video covers.

## Video covers

- Video processing generates three normal WebP thumbnail recommendations at different timestamps. The Set cover previews apply a 4px CSS blur only as an editing treatment; `blurImage` is not used as a cover source.
- Creators can select one generated recommendation for both cover ratios, or upload independent custom images for `4:3` and `3:4`.
- Hovering or keyboard-focusing a generated recommendation shows a non-interactive enlarged preview both before and after it is applied. Applying it requires confirmation; only confirmed recommendations display the selected/check state and switch the main cover cards from `Select cover` to an on-hover `Edit cover` action.
- Uploading a custom cover or confirming an AI recommendation automatically expands Send assistant and shows the successful cover-inspection result.
- Each post stores `cover4x3Url`/`cover4x3Id`, `cover3x4Url`/`cover3x4Id`, and `coverDisplayRatio`.
- The Horizontal/Vertical switch in the Cover/Title phone preview controls `coverDisplayRatio`; there is no separate Home-cover radio. The preview shows the signed-in creator's avatar and the matching selected cover.
- Home uses `coverDisplayRatio` only to choose the horizontal or vertical cover URL. New and migrated posts default to the horizontal `4:3` source, while the established Home card/grid aspect ratios remain unchanged.
- Home preserves its existing card/grid sizing after selecting a cover. If the selected cover image itself is portrait, the poster is contained at its natural ratio over a blurred copy of the same image; landscape covers continue using the original cover fill behavior.
- Publishing waits for generated recommendations unless both custom covers have been supplied.
- The API normalizes both current URL-string thumbnails and legacy thumbnail metadata objects at the file-server boundary.

## Graphics publishing

- Creators select up to 12 supported images from the Upload graphics tab on `/creator/publish`; each image must be no larger than 50MB and GIF is not supported.
- `/creator/publish/image` reuses the established photo upload endpoint and uploads draft images immediately with a concurrency limit of three. It submits a normal `photo` post through `POST /creator/posts`, so API ownership and media validation remain unchanged.
- The first image is the default cover. The gallery order is persisted unchanged in `fileIds`, while the selected gallery image is also referenced by `thumbnailId`; selecting a cover does not upload a duplicate file or move it to the front of the slideshow.
- Creators can add or remove images, drag thumbnails to change gallery order, replace one thumbnail with exactly one new image, replace the full selection, and open a keyboard-accessible gallery viewer with previous/next navigation. Thumbnail actions appear on hover or keyboard focus.
- The graphic composer exposes the same optional Topic picker as video creation. The selected topic is restored with the graphic draft and is sent as `topicKey` only when the creator chooses one.
- Graphic drafts follow the video-draft lifecycle. Images upload to the file server before publishing, while creator-scoped localStorage stores only ordered file IDs, upload states, title, description, and selected-cover metadata. Reloading `/creator/publish/image` asks the authenticated API to restore safe URLs for owned, unreferenced `post-photo` files. A successful publish clears local metadata after those same file IDs become post references.
- The Upload graphics tab displays Continue and Discard actions for an existing draft. Discard performs an ownership-checked batch deletion of file records and physical media before clearing local metadata. Removing, replacing, or clearing images also discards superseded draft files; interrupted items remain replaceable and cannot be published.
- Continue keeps the Upload graphics context. A draft whose browser metadata was saved before its server file IDs were prepared opens the editor with replaceable interrupted placeholders instead of redirecting to the Video tab; fallback navigation uses `/creator/publish?tab=uploadGraphic`.
- The phone graphic preview starts paused. Pressing Play advances the shared UI carousel every four seconds, uses Slick's infinite cloning for a seamless loop after the final image, and rotates the Douyin sound-disc indicator while playback is active. A thin full-width segmented bottom control leaves a small gap between image indicators and advances immediately when clicked; manual changes restart the autoplay interval. Pressing Play again pauses on the current image. The preview caption is visually limited to four lines with an ellipsis without truncating the draft or submitted text. The phone action area exposes only the full-width Clear and re-upload control; music selection remains in Extended information.
- The reusable carousel lives at `user/src/components/ui/carousel.tsx` and wraps `react-slick`. Slick owns autoplay, infinite cloning, swipe/touch handling, and slide transitions; the Douyin progress control uses the exposed `slickNext()`/`slickGoTo()` actions.

## Workflow

1. An authenticated active, email-verified user selects a video on `/creator/publish`. Direct guest access to `/creator/publish/video` redirects to `/auth/login`.
2. `/creator/publish/video` accepts navigation only when the browser has a newly selected video handoff or a persisted draft `fileId`; otherwise it redirects back to `/creator/publish`.
   Restored title and description values populate both the editable form fields and the phone preview.
3. Media is uploaded through the API/file-server flow. The create page polls the owned draft metadata until the three generated cover recommendations are ready. An interrupted draft with a prepared `fileId` may reopen the create page so the user can re-upload the video.
   Videos that are not browser-compatible are transcoded to H.264 with a source-derived bitrate capped by the configured maximum. Once the processed record safely points to a distinct output, the superseded source is removed with retries for transient Windows locks, so one logical upload does not retain both source and converted videos.
4. `POST /creator/posts` validates account eligibility and ownership of all file IDs.
5. The post service persists the post and publishes follow-up file/stat events.
6. Published posts appear on the home feed and creator profile. Owners can delete a single work or enter **Batch management** on their profile to select and delete multiple loaded works. Every deletion uses `DELETE /creator/posts/:id`; the retired `/content/posts` management and standalone post-detail pages are no longer part of the user app.
   Physical media cleanup normalizes duplicate absolute/public paths and retries transient Windows file locks before completing the deletion job.
   Discarding media that is still queued or processing first tombstones its file record and returns success. The owning media worker then removes generated assets and hard-deletes the tombstone after releasing FFmpeg/Sharp handles, preventing transient Windows `EBUSY` locks from failing the discard or post-deletion queue.
   The file server disables Sharp/libvips file-descriptor caching while retaining its memory and operation caches. This prevents thumbnail metadata reads from holding permanent Windows handles that would otherwise make both delete and discard retries fail indefinitely.

### Creator management experience

- Creator routes use a dedicated 200px management rail with 24px horizontal padding, a compact 40px Publish control, 14px navigation labels, and a constrained creator-brand lockup. The Publish and Posts screens therefore keep the same navigation proportions, typography, and content boundary.
- Hovering the Publish control opens the shared dropdown overlay with Video, Graphics, VR, and Article choices without moving the navigation items below it. Clicking the main Publish control navigates to `/creator/publish`. Video and Graphics menu choices open the native file picker directly and pass the selected files through the same handoff handlers as the matching `/creator/publish` dropzones. VR opens its accepted-video picker and returns to the VR tab; Article opens the article tab.
- `/creator/posts` distinguishes video and graphic works in the thumbnail: videos show duration, while graphics show a gallery marker and image count. Each borderless row uses the compact creator-center hierarchy for title, publish metadata, status, metrics, edit actions, and destructive actions; hovering the row adds the creator-center surface highlight and pointer cursor without changing action behavior.
- The management heading and filters stay fixed inside the content card. Only the work list owns vertical scrolling, so the creator shell and browser page do not move while reviewing a long list.
- Deleting a work opens an application modal instead of a browser confirmation. Confirmation calls the existing `DELETE /creator/posts/:id` flow, keeps the modal locked while the request is running, removes the deleted row from the current result set, and preserves it when deletion fails.
- Signed-in creators can pin or unpin any owned video or graphic through `PUT`/`DELETE /creator/posts/:id/pin`. Both routes explicitly require `AuthGuard` and the user role, while the service independently requires an exact match between the authenticated user ID and `Post.userId`; even a non-owner admin cannot pin another creator's post. The action is idempotent and owner-checked. Newly pinned works move to the front immediately; multiple pinned works are ordered by the most recent `pinnedAt`, followed by unpinned works in normal newest-first order.
- Creator profiles and the post-detail **Videos** tab preserve that API order and show the shared yellow **Pinned on top** marker on pinned thumbnails. Pin priority applies only to a single creator's lists; Home, Following, and recommendation feeds retain their existing ranking.
- Video and graphic post-detail overlays keep descriptions in a compact three-line caption at the lower-left of the media, with yellow hashtags. A single ellipsis and adjacent gray **more** marker appear only when the measured text overflows. Clicking anywhere in the caption opens the Details tab, which hides the media caption while the full description is visible in the panel.

### Media edit workflow

- An owner opens `/creator/posts/[id]/edit` to update an editable video or photo post. Existing media, topic, and collection membership are fixed in this workflow. Both media types expose title/description, incentive activity, and self-declaration; video exposes horizontal/vertical cover controls, while photo exposes a picker over its existing gallery images.
- Edit mode does not show create-only Topic controls, AI cover recommendations, Add collection, Add music, re-upload, Send assistant, or quick-fill controls. Photo cover changes reuse an existing owned gallery `fileId` as `thumbnailId`, so editing never uploads or duplicates media.
- **Save changes** starts disabled and is enabled only when normalized title/description or the media-specific cover selection/display ratio differs from the values loaded when the editor opens. Submitting keeps the existing topic and ordered media identifiers unchanged.

### Graphics workflow

1. An authenticated creator opens Upload graphics on `/creator/publish` and selects or drops one or more images.
2. The browser hands selected `File` objects to `/creator/publish/image`, uploads at most three concurrently, and records prepared file IDs in creator-scoped localStorage. Reloading validates those IDs through `GET /content/files/post/photo/drafts`; direct navigation without a live selection or stored draft returns to `/creator/publish`.
3. The creator selects a cover, optionally replaces or reorders gallery images, and reviews the four-second phone slideshow. The cover choice remains independent from slideshow order.
4. Post is enabled only after every image draft finishes uploading. `POST /creator/posts` then attaches the already-uploaded ordered `fileIds` and selected `thumbnailId` without uploading duplicate media.
5. The creator is redirected to the home feed after the API accepts the post.

## Main implementation

- API controller: `api/src/controllers/content/post/creator-post.controller.ts`
- Services: `api/src/services/content/post/`
- Payload/schema/DTO: `api/src/payloads/content/post/`, `api/src/schemas/content/post.schema.ts`, `api/src/dtos/content/post.dto.ts`
- UI:
  - `/creator/publish`: authenticated publishing entry in `user/src/app/(private)/creator/publish/page.tsx`, with four explicit sections under `user/src/components/post/publish-entry/`: video upload, graphics/photo upload, VR upload, and article publishing. Shared guideline and dropzone primitives keep the section implementations consistent.
  - Creator shell and Publish menu: `user/src/components/layout/creator/creator-theme-layout.tsx`, `user/src/components/layout/creator/creator-navigation.tsx`, and `user/src/lib/creator-publish.ts`
  - `/creator/posts`: content management composition under `user/src/components/creator/manage/`, with search/delete state in `user/src/hooks/use-creator-post-search.ts`
  - `/creator/publish/video`: server authentication boundary in `user/src/app/(private)/creator/publish/video/page.tsx`, client composition in `user/src/components/post/post-create-client.tsx`, orchestration hooks in `user/src/hooks/use-post-create.ts` and `user/src/hooks/use-post-video-upload.ts`, and focused publishing components under `user/src/components/post/post-create-*.tsx`
  - `/creator/publish/image`: authenticated graphics publisher in `user/src/app/(private)/creator/publish/image/page.tsx`, orchestration in `user/src/hooks/use-post-graphic-create.ts`, and graphic editor/phone-preview components under `user/src/components/post/post-graphic-*.tsx`
  - `/creator/posts/[id]/edit`: owner-only video/photo editor in `user/src/components/creator/manage/post-edit-client.tsx`, with media-specific form composition under `user/src/components/creator/manage/` and shared edit/dirty tracking in `user/src/hooks/use-post-edit.ts`

Audio, scheduled streams, paid access, and subscription-only posts are not accepted post types.

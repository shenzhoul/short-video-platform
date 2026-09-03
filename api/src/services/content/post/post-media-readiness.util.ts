import { HttpException } from '@nestjs/common';
import { FileServerInfoDto } from 'src/dtos/shared/file-server/file-server.dto';
import { __t } from 'src/utils/translation';

/**
 * Processing states a post's media may be published with.
 *
 * `completed` is the normal end state. `skipped` means the pipeline had
 * nothing to do for that file (already in a served format) — a real, finished
 * state, not a pending one. Anything else (`pending`, `processing`, `failed`,
 * or an unknown value a newer file-server introduces) is not publishable.
 *
 * An **absent** `processingStatus` is treated as ready: files predating the
 * field, and file types the pipeline never touches, legitimately have none.
 * This mirrors `CommentService.resolveCommentImage` and
 * `BaseUserService.attachProfileImageReference`, which gate on the same
 * values — the vocabulary is deliberately identical so the three cannot drift.
 */
const PUBLISHABLE_PROCESSING_STATES = ['completed', 'skipped'];

/**
 * Refuses to publish a post whose media is not actually there and finished.
 *
 * This is the domain invariant behind recommendation eligibility's "media
 * chưa ready không xuất hiện" (rules/instructions §4) — and it is enforced
 * *here*, at the one moment a post's media set is decided, rather than in
 * each feed's read path. That matters twice over:
 *
 * - **Every feed gets it, not just the recommender.** Home, For You,
 *   Following and creator profiles all read `status: 'active'`; had this been
 *   a recommendation-only filter, the same broken post would simply have
 *   appeared everywhere else instead.
 * - **Eligibility stays a single source of truth.** `buildEligibilityMatch`
 *   needs no readiness clause at all (and the five candidate sources need no
 *   copies of one), because a post that reaches `status: 'active'` has
 *   already been proven to have complete media.
 *
 * Readiness is read from `FileServerInfoDto` — the file-server's own record,
 * fetched server-side — never from anything the publishing client reports
 * about its own upload.
 *
 * @param files The resolved file records for this post's media.
 * @param requestedFileIds The ids that were asked for. A count mismatch means
 *   at least one id resolved to nothing: the reference is dangling and the
 *   post would publish pointing at media that does not exist.
 */
export function assertPostMediaReady(
  files: FileServerInfoDto[],
  requestedFileIds: Array<string | { toString(): string }> = []
): void {
  if (requestedFileIds.length && files.length !== requestedFileIds.length) {
    throw new HttpException(__t('errors.post_media_missing'), 400);
  }

  // A failed file gets its own message: "wait a moment" is useless advice for
  // something that will never finish, and re-uploading is useless advice for
  // something that is still working.
  if (files.some((file) => (file as any)?.processingStatus === 'failed')) {
    throw new HttpException(__t('errors.post_media_processing_failed'), 400);
  }

  const notReady = files.some((file) => {
    const status = (file as any)?.processingStatus;
    return status && !PUBLISHABLE_PROCESSING_STATES.includes(status);
  });
  if (notReady) {
    throw new HttpException(__t('errors.post_media_not_ready'), 400);
  }
}

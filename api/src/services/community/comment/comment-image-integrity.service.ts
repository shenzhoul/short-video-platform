import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Comment, CommentDocument } from 'src/schemas/community/comment';
import { FileServerService } from 'src/services/shared/file-server';

/** The durable upload target a comment image is created with. */
const COMMENT_IMAGE_UPLOAD_TYPE = 'comment-photo';

export interface CommentImageIntegrityReport {
  commentsExamined: number;
  /** References that were missing and have been restored. */
  referencesRepaired: number;
  /** Comments whose image no longer exists, so the reference was dropped. */
  danglingImageIdsCleared: number;
  /** Comments already consistent. */
  healthy: number;
  failures: number;
}

/**
 * Repairs the one crash window that is genuinely destructive.
 *
 * ## The invariant
 *
 * A published comment carrying an `imageId` must have a file record that exists,
 * processed successfully, and holds a reference back to that comment. The
 * reference is what tells the unused-file sweeper the image is in use.
 *
 * ## The window
 *
 * A comment is written first and its image referenced second, so that a failed
 * insert cannot leave a file nothing points at. `CommentService` compensates
 * when the reference *fails* — it rolls the comment back and reports an error —
 * but nothing in a process can compensate for that process dying. A crash
 * between the two writes leaves:
 *
 *   comment.imageId = X   and   file X with no references
 *
 * which the sweeper reads as an abandoned draft and deletes, four hours later,
 * leaving a published comment pointing at a file that no longer exists.
 *
 * ## The repair
 *
 * The comment is authoritative: it exists, somebody posted it, and it names the
 * image. So the reference is **restored** rather than the file collected. Only
 * when the file is genuinely gone is the comment's `imageId` cleared, which
 * leaves the comment and its text intact and simply stops it claiming a picture
 * that is not there.
 *
 * Run before every sweep, which is what closes the race: anything repairable is
 * repaired while the sweeper is still looking at the set from before.
 *
 * Idempotent — a second pass finds nothing to do.
 */
@Injectable()
export class CommentImageIntegrityService {
  private readonly logger = new Logger(CommentImageIntegrityService.name);

  constructor(
    @InjectModel(Comment.name) private readonly CommentModel: Model<CommentDocument>,
    private readonly fileServerService: FileServerService
  ) { }

  /**
   * Bring every published comment image back to the invariant.
   *
   * @param apply false reports what would change without writing anything
   */
  public async repairPublishedReferences(apply = true): Promise<CommentImageIntegrityReport> {
    const report: CommentImageIntegrityReport = {
      commentsExamined: 0,
      referencesRepaired: 0,
      danglingImageIdsCleared: 0,
      healthy: 0,
      failures: 0
    };

    const comments = await this.CommentModel
      .find({ imageId: { $exists: true, $ne: null } })
      .select({ _id: 1, imageId: 1 })
      .lean();
    report.commentsExamined = comments.length;
    if (!comments.length) return report;

    // One lookup for the whole set rather than one per comment: this runs on a
    // schedule beside a sweep, and a query per comment would make it scale with
    // the number of pictures ever posted.
    const imageIds = [...new Set(comments.map((row: any) => row.imageId.toString()))];
    const files = await this.fileServerService.findByIds(imageIds);
    const fileById = new Map(files.map((file: any) => [file._id.toString(), file]));

    for (const comment of comments as any[]) {
      const imageId = comment.imageId.toString();
      const file = fileById.get(imageId);

      // The file is genuinely gone — swept, deleted with another resource, or
      // never finished. The comment keeps its text and stops claiming a picture.
      if (!file) {
        if (apply) {
          // eslint-disable-next-line no-await-in-loop
          await this.CommentModel.updateOne({ _id: comment._id }, { $unset: { imageId: '' } });
        }
        report.danglingImageIdsCleared += 1;
        continue;
      }

      const referencesThisComment = (file.refItems || []).some(
        (ref: any) => ref?.itemId?.toString() === comment._id.toString()
      );
      if (referencesThisComment) {
        report.healthy += 1;
        continue;
      }

      // The destructive case: a live comment's image looks abandoned. Restore
      // the reference so the sweeper leaves it alone.
      try {
        if (apply) {
          // eslint-disable-next-line no-await-in-loop
          await this.fileServerService.addRefToMultipleFiles([imageId], {
            itemId: comment._id,
            itemType: 'comment'
          });
        }
        report.referencesRepaired += 1;
      } catch (error: any) {
        report.failures += 1;
        this.logger.error(
          `Failed to repair the image reference for comment ${comment._id}: ${error.message}`,
          error.stack
        );
      }
    }

    if (report.referencesRepaired || report.danglingImageIdsCleared || report.failures) {
      this.logger.log(
        `Comment image integrity: repaired ${report.referencesRepaired}, `
        + `cleared ${report.danglingImageIdsCleared}, failed ${report.failures}, `
        + `healthy ${report.healthy}`
      );
    }

    return report;
  }
}

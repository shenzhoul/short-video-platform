import { APIRequest } from './api-request';
import { uploadFile, UploadProgress } from './file-upload.service';

export class CommentService extends APIRequest {
  /**
   * Create a comment on specific content
   * POST /api/social/{contentType}/{contentId}/comments
   */
  create(contentType: string, contentId: string, payload: any) {
    return this.post(`/social/${contentType}/${contentId}/comments`, payload);
  }

  /**
   * Get comments for specific content
   * GET /api/social/{contentType}/{contentId}/comments
   */
  search(contentType: string, contentId: string, query: { [key: string]: any } = {}) {
    return this.get(this.buildUrl(`/social/${contentType}/${contentId}/comments`, query));
  }

  /**
   * Upload the one image a comment may carry, resolving to its file id.
   *
   * Goes through the shared upload pipeline rather than posting the bytes with
   * the comment, so a large picture transfers with progress and the comment
   * itself stays a small JSON request.
   */
  async uploadImage(file: File, onProgress?: (progress: UploadProgress) => void) {
    const result = await uploadFile('/content/files/comment/photo/upload', file, {}, onProgress);
    if (!result.success) {
      // The server's stable code travels with the error. Without it the
      // composer cannot tell "that is not an image" — which is the author's
      // problem and has a specific message — from a dropped connection, which
      // is not and does not.
      const failure: Error & { code?: string } = new Error(result.error || 'Image upload failed');
      failure.code = result.errorCode;
      throw failure;
    }
    return result;
  }

  /**
   * Discard an uploaded image the author decided not to send.
   *
   * Best effort by design: the server refuses to touch a file that has since
   * become part of a comment, and an abandoned upload this never reaches is
   * collected by the unused-file sweeper instead.
   */
  discardImage(fileId: string) {
    return this.del(`/content/files/comment/photo/draft/${fileId}`);
  }

  /**
   * Update a comment
   * PUT /api/social/comments/{commentId}
   */
  update(commentId: string, payload: any) {
    return this.put(`/social/comments/${commentId}`, payload);
  }

  /**
   * Delete a comment
   * DELETE /api/social/comments/{commentId}
   */
  delete(commentId: string) {
    return this.del(`/social/comments/${commentId}`);
  }

  /**
   * Resolve one comment by id, with the root of its thread
   * GET /api/social/comments/{commentId}/target
   *
   * Used for notification deep-linking: the target is fetched directly rather
   * than by paging through the comment list until it appears.
   */
  resolveTarget(commentId: string) {
    return this.get(`/social/comments/${commentId}/target`);
  }

  /**
   * GET /api/social/post/{postId}/hot-comment
   *
   * Owner-scoped on the server; a non-owner receives null.
   */
  hotComment(postId: string) {
    return this.get(`/social/post/${postId}/hot-comment`);
  }
}

export const commentService = new CommentService();

// Individual function exports for tree shaking
export const createComment = (contentType: string, contentId: string, payload: any) => commentService.create(contentType, contentId, payload);
export const searchComments = (contentType: string, contentId: string, query: { [key: string]: any } = {}) => commentService.search(contentType, contentId, query);
export const updateComment = (commentId: string, payload: any) => commentService.update(commentId, payload);
export const deleteComment = (commentId: string) => commentService.delete(commentId);
export const resolveCommentTarget = (commentId: string) => commentService.resolveTarget(commentId);
export const fetchHotComment = (postId: string) => commentService.hotComment(postId);
export const uploadCommentImage = (file: File, onProgress?: (progress: UploadProgress) => void) => commentService.uploadImage(file, onProgress);
export const discardCommentImage = (fileId: string) => commentService.discardImage(fileId);

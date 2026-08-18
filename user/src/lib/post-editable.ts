import { IPost } from '@interfaces/post';

type EditableCheck = Pick<IPost, 'type' | 'status'> | null | undefined;

/**
 * Whether a post can be opened in the edit form.
 *
 * Two independent reasons a post cannot be:
 *
 * - **Type.** The editor supports the two media composers that already have a stable preview and
 *   cover model: video and photo. Text-only posts still do not have an edit form.
 * - **Deleted.** `PostCrudService.updatePost` matches on `{ status: { $ne: 'deleted' } }` and throws
 *   `EntityNotFoundException` when nothing matches, so the API refuses these outright. Without this
 *   check a creator would fill in the form and get a bare "not found" on save.
 *
 * Deliberately one exported rule rather than a condition repeated in the list and the route: those
 * are the two ways into the editor, and they must not be able to disagree.
 */
export function isPostEditable(post: EditableCheck): boolean {
  if (!post) return false;
  return ['video', 'photo'].includes(post.type) && post.status !== 'deleted';
}

/** Why editing is unavailable, for a tooltip or an unsupported-state message. */
export function getPostNotEditableReason(post: EditableCheck): string {
  if (!post) return 'This post could not be loaded.';
  if (post.status === 'deleted') return 'Deleted posts cannot be edited.';
  if (!['video', 'photo'].includes(post.type)) return `Editing is not available for ${post.type} posts yet.`;
  return '';
}

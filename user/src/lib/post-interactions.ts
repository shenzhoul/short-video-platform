import { IPost, PostInteractionPatch } from '@interfaces/post';

export function applyPostInteractionPatch(post: IPost, patch: PostInteractionPatch): IPost {
  const unchanged = (patch.isLiked === undefined || patch.isLiked === post.isLiked)
    && (patch.totalLike === undefined || patch.totalLike === post.totalLike)
    && (patch.totalComment === undefined || patch.totalComment === post.totalComment)
    && (patch.totalShare === undefined || patch.totalShare === post.totalShare)
    && (patch.totalView === undefined || patch.totalView === post.totalView);

  return unchanged ? post : { ...post, ...patch };
}

export function applyPostInteractionPatchToPosts(
  posts: IPost[],
  postId: string,
  patch: PostInteractionPatch
): IPost[] {
  let changed = false;
  const nextPosts = posts.map((post) => {
    if (post._id !== postId) return post;
    const nextPost = applyPostInteractionPatch(post, patch);
    if (nextPost !== post) changed = true;
    return nextPost;
  });

  return changed ? nextPosts : posts;
}

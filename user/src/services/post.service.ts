import { describeUploadFailure } from '@lib/upload-policy';
import { APIRequest } from '@services/api-request';

import { uploadFile, UploadPrepared, UploadProgress } from './file-upload.service';

type HeadersMap = Record<string, string>;
type PostQuery = { [key: string]: any };

export interface PostVideoDraftInfo {
  fileId: string;
  name: string;
  size: number;
  status: string;
  processingStatus?: string;
  url?: string;
  thumbnails?: string[];
  blurImage?: string;
  updatedAt: string;
}

export interface PostPhotoDraftInfo {
  fileId: string;
  name: string;
  size: number;
  status: string;
  processingStatus?: string;
  url?: string;
  updatedAt: string;
}

export class PostService extends APIRequest {
  /**
   * Get personalized home posts
   *
   * Retrieves posts from creators the user is subscribed to for the home post.
   * Provides personalized content based on user's subscription preferences.
   *
   * @param query Search parameters and filters
   * @param headers Optional request headers
   * @returns Promise resolving to personalized home post content
   */
  getPersonalizedHomePosts = (query?: PostQuery, headers?: HeadersMap) => this.getHomePosts(query, headers);

  getRecommendedPosts = (query?: PostQuery, headers?: HeadersMap) => this.get(
    this.buildUrl('/posts/recommended', query),
    headers
  );

  /**
   * Send a batch of recommendation telemetry events (impression, watch,
   * quick-skip, photo-dwell, detail-open, like/comment/share/follow_after_view
   * correlated with a recommendation session).
   *
   * Never awaited by anything the user is waiting on — this is fire-and-forget
   * feedback for the recommender, not a user-facing action.
   */
  recordRecommendationEvents = (events: Array<Record<string, any>>, anonymousId?: string) => this.post('/posts/recommendation-events', {
    events,
    ...(anonymousId ? { anonymousId } : {})
  });

  /** Opens a Post Detail recommendation session anchored on one post (Home/notification/message/direct-link sources). */
  openPostDetailRecommendationSession = (postId: string, anonymousId?: string) => this.post(
    this.buildUrl(`/posts/${postId}/detail-session`, anonymousId ? { anonymousId } : undefined),
    {}
  ) as Promise<{ data: { sessionId: string; postId: string } }>;

  /**
   * Advances a Post Detail recommendation session to the next post.
   *
   * `videoOnly` is set by the picture-in-picture window, which can only draw a
   * post that carries a video. Filtering server-side keeps "next" one round
   * trip: discarding a photo post here would mean asking again, and each ask
   * appends the rejected post to the session permanently.
   */
  stepPostDetailRecommendationNext = (sessionId: string, anonymousId?: string, videoOnly?: boolean) => this.get(
    this.buildUrl(`/posts/detail-session/${sessionId}/next`, {
      ...(anonymousId ? { anonymousId } : {}),
      ...(videoOnly ? { videoOnly: 'true' } : {})
    })
  ) as Promise<{ data: { postId: string } | null }>;

  /** Steps a Post Detail recommendation session back to the previous post. */
  stepPostDetailRecommendationPrevious = (sessionId: string, anonymousId?: string) => this.get(
    this.buildUrl(`/posts/detail-session/${sessionId}/previous`, anonymousId ? { anonymousId } : undefined)
  ) as Promise<{ data: { postId: string } | null }>;

  getFollowingPosts = (query?: PostQuery, headers?: HeadersMap) => this.get(
    this.buildUrl('/posts/following', query),
    headers
  );

  /**
   * Posts from the viewer's friends — creators they follow who follow back.
   *
   * Same shape as `getFollowingPosts`; the server narrows the creator set to
   * mutual follows, which is the relationship this product already treats as a
   * peer connection (it is what lets two people message without a request).
   */
  getFriendPosts = (query?: PostQuery, headers?: HeadersMap) => this.get(
    this.buildUrl('/posts/friends', query),
    headers
  );

  /**
   * One creator's posts, pinned first, in the creator's own order.
   *
   * Deliberately *not* `/posts/home-posts` any more. That route now serves the
   * ranked Home recommendation feed, which has no creator filter and whose
   * payload class strips `userId`, so asking it for a creator's posts returned
   * the whole feed — the creator profile grid and the Post Detail Videos tab
   * both filled with other people's posts under this creator's name.
   */
  getCreatorPosts = (userId: string, query?: PostQuery, headers?: HeadersMap) => this.get(
    this.buildUrl('/posts/creator-posts', { ...query, userId }),
    headers
  );

  findById = (id: string, headers?: { [key: string]: string }) => this.get(`/creator/posts/${id}`, headers);

  findOne = (id: string, headers?: { [key: string]: string }) => this.get(`/posts/${id}`, headers);

  recordView = (id: string) => this.post(`/posts/${id}/view`, {}) as Promise<{
    status: number;
    data: { totalView: number };
  }>;

  create = (data) => this.post('/creator/posts', data);

  delete = (id: string) => this.del(`/creator/posts/${id}`);

  update = (id: string, payload: any) => this.put(`/creator/posts/${id}`, payload);

  pin = (id: string) => this.put(`/creator/posts/${id}/pin`);

  unpin = (id: string) => this.del(`/creator/posts/${id}/pin`);

  myPosts = (query?: PostQuery, headers?: HeadersMap) => this.get(
    this.buildUrl('/creator/posts', query),
    headers
  );

  likedPosts = (query?: PostQuery, headers?: HeadersMap) => this.get(
    this.buildUrl('/posts/liked', query),
    headers
  );

  unlikePosts = (postIds: string[]) => this.del('/posts/liked', { postIds });

  /**
   * Upload photo for post using file server with TUS protocol
   * @param file Photo file
   * @param onProgress Progress callback function
   * @throws Error if upload fails
   */
  async uploadPhoto(
    file: File,
    onProgress?: (progress: UploadProgress) => void,
    onPrepared?: (prepared: UploadPrepared) => void
  ) {
    const result = await uploadFile(
      '/content/files/post/photo/upload',
      file,
      {},
      onProgress,
      onPrepared
    );

    if (!result.success) {
      throw new Error(describeUploadFailure(result, 'Photo upload failed'));
    }

    return result;
  }

  /**
   * Upload video for post using file server with TUS protocol
   * @param file Video file
   * @param payload Additional data (unused, kept for compatibility)
   * @param onProgress Progress callback function
   * @throws Error if upload fails
   */
  async uploadVideo(
    file: File,
    payload?: any,
    onProgress?: (progress: UploadProgress) => void,
    onPrepared?: (prepared: UploadPrepared) => void
  ) {
    const result = await uploadFile(
      '/content/files/post/video/upload',
      file,
      {},
      onProgress,
      onPrepared
    );

    if (!result.success) {
      throw new Error(describeUploadFailure(result, 'Video upload failed'));
    }

    return result;
  }

  /**
   * Upload thumbnail for post using file server with TUS protocol
   * @param file Thumbnail image file
   * @param payload Additional data (unused, kept for compatibility)
   * @param onProgress Progress callback function
   * @throws Error if upload fails
   */
  async uploadThumbnail(file: File, payload?: any, onProgress?: (progress: UploadProgress) => void) {
    const result = await uploadFile(
      '/content/files/post/thumbnail/upload',
      file,
      {},
      onProgress
    );

    if (!result.success) {
      throw new Error(describeUploadFailure(result, 'Thumbnail upload failed'));
    }

    return result;
  }

  /**
   * Upload teaser video for post using file server with TUS protocol
   * @param file Teaser video file
   * @param payload Additional data (unused, kept for compatibility)
   * @param onProgress Progress callback function
   * @throws Error if upload fails
   */
  async uploadTeaser(file: File, payload?: any, onProgress?: (progress: UploadProgress) => void) {
    const result = await uploadFile(
      '/content/files/post/teaser/upload',
      file,
      {},
      onProgress
    );

    if (!result.success) {
      throw new Error(describeUploadFailure(result, 'Teaser upload failed'));
    }

    return result;
  }

  getVideoDraft = (fileId: string) => this.get(`/content/files/post/video/draft/${fileId}`) as Promise<{
    status: number;
    data: PostVideoDraftInfo;
  }>;

  discardVideoDraft = (fileId: string) => this.del(`/content/files/post/video/draft/${fileId}`);

  getPhotoDrafts = (fileIds: string[]) => this.get(this.buildUrl('/content/files/post/photo/drafts', { fileIds })) as Promise<{
    status: number;
    data: PostPhotoDraftInfo[];
  }>;

  discardPhotoDrafts = (fileIds: string[]) => this.del('/content/files/post/photo/drafts', { fileIds });

  private getHomePosts(query?: PostQuery, headers?: HeadersMap) {
    return this.get(
      this.buildUrl('/posts/home-posts', query),
      headers
    );
  }
}

// Create individual function exports for better tree shaking
const postServiceInstance = new PostService();

export const getPersonalizedHomePosts = postServiceInstance.getPersonalizedHomePosts.bind(postServiceInstance);
export const getRecommendedPosts = postServiceInstance.getRecommendedPosts.bind(postServiceInstance);
export const recordRecommendationEvents = postServiceInstance.recordRecommendationEvents.bind(postServiceInstance);
export const openPostDetailRecommendationSession = postServiceInstance.openPostDetailRecommendationSession.bind(postServiceInstance);
export const stepPostDetailRecommendationNext = postServiceInstance.stepPostDetailRecommendationNext.bind(postServiceInstance);
export const stepPostDetailRecommendationPrevious = postServiceInstance.stepPostDetailRecommendationPrevious.bind(postServiceInstance);
export const getFollowingPosts = postServiceInstance.getFollowingPosts.bind(postServiceInstance);
export const getFriendPosts = postServiceInstance.getFriendPosts.bind(postServiceInstance);
export const getCreatorPosts = postServiceInstance.getCreatorPosts.bind(postServiceInstance);
export const myPosts = postServiceInstance.myPosts.bind(postServiceInstance);
export const likedPosts = postServiceInstance.likedPosts.bind(postServiceInstance);
export const unlikePosts = postServiceInstance.unlikePosts.bind(postServiceInstance);
export const findOne = postServiceInstance.findOne.bind(postServiceInstance);
export const recordPostView = postServiceInstance.recordView.bind(postServiceInstance);
export const findById = postServiceInstance.findById.bind(postServiceInstance);
export const create = postServiceInstance.create.bind(postServiceInstance);
export const update = postServiceInstance.update.bind(postServiceInstance);
export const pinPost = postServiceInstance.pin.bind(postServiceInstance);
export const unpinPost = postServiceInstance.unpin.bind(postServiceInstance);
export const deletePost = postServiceInstance.delete.bind(postServiceInstance);
export const uploadPhoto = postServiceInstance.uploadPhoto.bind(postServiceInstance);
export const uploadVideo = postServiceInstance.uploadVideo.bind(postServiceInstance);
export const getVideoDraft = postServiceInstance.getVideoDraft.bind(postServiceInstance);
export const discardVideoDraft = postServiceInstance.discardVideoDraft.bind(postServiceInstance);
export const getPhotoDrafts = postServiceInstance.getPhotoDrafts.bind(postServiceInstance);
export const discardPhotoDrafts = postServiceInstance.discardPhotoDrafts.bind(postServiceInstance);
export const uploadThumbnail = postServiceInstance.uploadThumbnail.bind(postServiceInstance);
export const uploadTeaser = postServiceInstance.uploadTeaser.bind(postServiceInstance);

import { APIRequest } from '@services/api-request';
import { getUserFriendlyUploadErrorMessage } from '@utils/file-validation';

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

  getFollowingPosts = (query?: PostQuery, headers?: HeadersMap) => this.get(
    this.buildUrl('/posts/following', query),
    headers
  );

  getCreatorPosts = (userId: string, query?: PostQuery, headers?: HeadersMap) => this.getHomePosts(
    { ...query, userId },
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
      throw new Error(getUserFriendlyUploadErrorMessage(result.error, 'Photo upload failed'));
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
      throw new Error(getUserFriendlyUploadErrorMessage(result.error, 'Video upload failed'));
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
      throw new Error(getUserFriendlyUploadErrorMessage(result.error, 'Thumbnail upload failed'));
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
      throw new Error(getUserFriendlyUploadErrorMessage(result.error, 'Teaser upload failed'));
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
export const getFollowingPosts = postServiceInstance.getFollowingPosts.bind(postServiceInstance);
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

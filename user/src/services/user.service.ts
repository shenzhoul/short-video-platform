import { APIRequest } from './api-request';

export class UserService extends APIRequest {
  me = (headers?: { [key: string]: string }) => this.get('/users/me', headers);

  updateAvatar = (avatarId: string) => this.put('/users/me/avatar', { avatarId });

  follow = (creatorId: string) => this.post(`/users/${creatorId}/follow`, {});

  unfollow = (creatorId: string) => this.del(`/users/${creatorId}/follow`);

  following = (query?: Record<string, any>, headers?: Record<string, string>) => this.get(
    this.buildUrl('/users/following', query),
    headers
  );

  followings = (userId: string, query?: Record<string, any>, headers?: Record<string, string>) => this.get(
    this.buildUrl(`/users/${userId}/followings`, query),
    headers
  );

  followers = (userId: string, query?: Record<string, any>, headers?: Record<string, string>) => this.get(
    this.buildUrl(`/users/${userId}/followers`, query),
    headers
  );

  removeFollower = (followerId: string) => this.del(`/users/me/followers/${followerId}`);
}

export const userService = new UserService();

// Individual function exports for tree shaking
export const getUserMe = (headers?: { [key: string]: string }) => userService.me(headers);
export const updateUserAvatar = (avatarId: string) => userService.updateAvatar(avatarId);
export const followCreator = (creatorId: string) => userService.follow(creatorId);
export const unfollowCreator = (creatorId: string) => userService.unfollow(creatorId);
export const getFollowingUsers = (query?: Record<string, any>, headers?: Record<string, string>) => userService.following(query, headers);
export const getCreatorFollowings = (userId: string, query?: Record<string, any>, headers?: Record<string, string>) => userService.followings(userId, query, headers);
export const getCreatorFollowers = (userId: string, query?: Record<string, any>, headers?: Record<string, string>) => userService.followers(userId, query, headers);
export const removeFollower = (followerId: string) => userService.removeFollower(followerId);

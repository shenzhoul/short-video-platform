export interface IUser {
  firstName: string;
  lastName: string;
  gender: string;
  _id: string;
  avatar: string;
  cover: string;
  coverBgColor?: string;
  name: string;
  bio: string;
  country: string;
  age: number;
  isFollowed: boolean;
  username: string;
  isOnline: boolean;
  stats: {
    totalLikes: number;
    followers?: number;
    followings?: number;
    totalPosts?: number;
  };
}

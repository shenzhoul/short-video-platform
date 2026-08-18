export interface ICreator {
  _id: string;
  name: string;
  firstName: string;
  lastName: string;
  username: string;
  avatar: string;
  cover: string;
  coverBgColor?: string;
  gender: string;
  country: string;
  age?: number;
  dateOfBirth?: Date;
  bio: string;
  stats: {
    /** Total likes received across the creator's posts. */
    totalLikes?: number;
    followers?: number;
    followings?: number;
    totalPosts?: number;
  };
  createdBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
  isOnline?: boolean;
  status: string;
  isFollowed: boolean;
}

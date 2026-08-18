import { ISearch } from './utils';

export interface IUser {
  _id: string;
  avatar: string;
  firstName: string;
  lastName: string;
  name: string;
  username: string;
  balance: number;
  email: string;
  country: string;
  status: string;
  verifiedEmail?: boolean;
  isAdmin: boolean;
}

export interface IUserSearch extends ISearch {
  isAdmin?: boolean;
}

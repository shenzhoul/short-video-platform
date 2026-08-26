/**
 * A post category as the admin API returns it.
 *
 * `key` is the stable identifier posts store in `topicKey`. It is chosen once at creation and is
 * read-only afterwards — renaming a category changes `name`, never `key`.
 */
export interface ICategory {
  _id: string;
  key: string;
  name: string;
  description: string;
  status: 'active' | 'inactive';
  ordering: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ICategoryPayload {
  key?: string;
  name: string;
  description?: string;
  status?: string;
  ordering?: number;
}

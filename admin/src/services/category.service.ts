import { APIRequest } from './api-request';

export class CategoryService extends APIRequest {
  search = (query?: { [key: string]: any }) => this.get(this.buildUrl('/admin/categories/search', query));

  findById = (id: string, headers?: { [key: string]: string }) => this.get(`/admin/categories/${id}`, headers);

  create = (payload: any) => this.post('/admin/categories', payload);

  update = (id: string, payload: any) => this.put(`/admin/categories/${id}`, payload);

  /**
   * Disables the category. There is no physical delete: posts store the category key, so the
   * record has to stay for those posts to keep resolving.
   */
  disable = (id: string) => this.del(`/admin/categories/${id}`);
}

export const categoryService = new CategoryService();

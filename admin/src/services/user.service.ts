import { IUser } from 'src/interfaces';
import { APIRequest, IResponse } from './api-request';
import { fileUploadService } from '@services/file-upload.service';

export class UserService extends APIRequest {
  me = (headers?: { [key: string]: string }): Promise<IResponse<IUser>> => this.get('/users/me', headers);

  create = (payload: any) => this.post('/admin/users', payload);

  update = (id: string, payload: any) => this.put(`/admin/users/${id}`, payload);

  delete = (id: string) => this.del(`/admin/users/${id}`);

  search = (query?: { [key: string]: any }) => this.get(this.buildUrl('/admin/users/search', query));

  searchAllUser = (query?: { [key: string]: any }) => this.get(this.buildUrl('/admin/users/search-all', query));

  findById = (id: string, headers: { [key: string]: string } = {}) => this.get(`/admin/users/${id}/view`, headers);

  // Admin permission management methods
  getAdminUsers = () => this.get('/admin/permissions/admins');

  toggleAdminPermission = (userId: string) => this.post('/admin/permissions/toggle-admin', { userId });

  getUserForAdminManagement = (id: string) => this.get(`/admin/permissions/user/${id}`);

  /**
   * Upload user avatar using the new file server workflow
   *
   * @param file - Avatar image file to upload
   * @param onProgress - Progress callback function
   * @returns Promise resolving to upload result
   * @throws Error if upload fails
   */
  async uploadAvatarUser(file: File, onProgress?: (progress: number) => void) {
    try {
      const result = await fileUploadService.uploadFile(
        '/identity/files/user/avatar/upload',
        file,
        {},
        onProgress ? (progress) => onProgress(progress.percentage) : undefined
      );

      // Check if upload was successful
      if (!result.success) {
        throw new Error(result.error || 'Avatar upload failed');
      }

      return { data: result };
    } catch (error) {
      console.error('Avatar upload error:', error);
      throw error;
    }
  }

  updateAvatar = (userId: string, avatarId: string) => this.put(`/admin/users/${userId}/avatar`, { avatarId });
}

export const userService = new UserService();

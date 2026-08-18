import { IPublicSetting, ISetting } from 'src/interfaces';
import { APIRequest, IResponse } from './api-request';
import { fileUploadService } from '@services/file-upload.service';

export class SettingService extends APIRequest {
  getPublicSettings = (): Promise<IResponse<IPublicSetting>> => this.get('/settings/public');

  all = (group = ''): Promise<IResponse<ISetting[]>> => this.get(this.buildUrl('/admin/settings', { group }));

  update = (key: string, value: any) => this.put(`/admin/settings/${key}`, { value });

  valueByKeys = (keys: string[]): Promise<Record<string, any>> => {
    return this.post('/settings/keys', { keys }).then((resp) => resp.data);
  }

  /**
   * Upload setting file using the new file server workflow
   *
   * @param file - File to upload (logo, favicon, etc.)
   * @param onProgress - Progress callback function
   * @returns Promise resolving to upload result
   */
  async uploadFile(
    file: File,
    onProgress?: (progress: number) => void
  ) {
    try {
      const result = await fileUploadService.uploadFile(
        '/admin/settings/files/image/upload',
        file,
        {},
        onProgress ? (progress) => onProgress(progress.percentage) : undefined
      );

      if (!result.success) {
        throw new Error(result.error || 'Setting file upload failed');
      }

      return result;
    } catch (error) {
      console.error('Setting file upload error:', error);
      throw error;
    }
  }
}

export const settingService = new SettingService();

export const getSettingsByKeys = (keys: string[]) => settingService.valueByKeys(keys);

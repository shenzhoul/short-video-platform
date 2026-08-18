import { APIRequest } from './api-request';

export class SettingService extends APIRequest {
  valueByKeys = (keys: string[]): Promise<Record<string, any>> => {
    return this.post('/settings/keys', { keys }).then((resp) => resp.data);
  };
}

export const settingService = new SettingService();

// === TREE SHAKING EXPORTS ===
const settingServiceInstance = new SettingService();

export const getSettingsByKeys = (keys: string[]) =>
  settingServiceInstance.valueByKeys(keys);

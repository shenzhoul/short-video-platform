import { APIRequest } from './api-request';

export class SettingService extends APIRequest {
  valueByKeys = (keys: string[]): Promise<Record<string, any>> => {
    return this.post('/settings/keys', { keys }).then((resp) => resp.data);
  };

  /**
   * The upload limits currently in force, per durable upload type.
   *
   * Already resolved by the API — defaults, plus any admin override, clamped —
   * and already in the units the checks use. The alternative is fetching
   * fifty-seven raw settings and re-implementing that arithmetic here, which is
   * how the client and the server come to disagree.
   */
  uploadPolicies = (): Promise<Record<string, any>> => {
    return this.get('/settings/upload-policies').then((resp) => resp.data);
  };
}

export const settingService = new SettingService();

// === TREE SHAKING EXPORTS ===
const settingServiceInstance = new SettingService();

export const getSettingsByKeys = (keys: string[]) =>
  settingServiceInstance.valueByKeys(keys);

export const getUploadPolicies = () => settingServiceInstance.uploadPolicies();

import cookie from 'js-cookie';
import { ILogin } from 'src/interfaces';

import { APIRequest, TOKEN } from './api-request';

export class AuthService extends APIRequest {
  public login = async (data: ILogin) => this.post('/auth/login', data);

  setToken = (token: string): void => {
    cookie.set(TOKEN, token);
  };

  getToken = (): string => {
    const token = cookie.get(TOKEN);
    return token;
  };

  removeToken = (): void => {
    cookie.remove(TOKEN);
  };

  logout = async (): Promise<void> => {
    try {
      await this.post('/auth/logout', {});
    } catch (error) {
      console.warn('API logout failed, clearing local token anyway:', error);
    } finally {
      this.removeToken();
    }
  };

  updatePassword = (password: string, userId?: string) => this.put('/admin/auth/user/password', { userId, password });

  resetPassword = (data: { email: string }) => this.post('/auth/forgot', data);
}

export const authService = new AuthService();

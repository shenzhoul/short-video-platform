import { APIRequest, TOKEN } from '@services/api-request';
import cookie from 'js-cookie';

export class AuthService extends APIRequest {
  clearToken = () => {
    cookie.remove('token');
  };

  getToken = (): string => {
    return cookie.get(TOKEN) || '';
  };

  /**
   * Public self-registration.
   *
   * Posts to `/auth/register`, which is the open counterpart of the admin
   * `POST /admin/users` route — same service underneath, but it accepts no role,
   * status or internal flag. The password must already be SHA256-hashed by the
   * caller, exactly as login sends it.
   *
   * No session comes back. The caller signs in through the normal credentials
   * flow afterwards, so there is one place that issues a session.
   */
  register = (payload: {
    email: string;
    username: string;
    name?: string;
    firstName?: string;
    lastName?: string;
    gender?: string;
    password: string;
  }) => this.post('/auth/register', payload);

  logout = async (): Promise<void> => {
    try {
      await this.post('/auth/logout', {});
    } catch (error) {
      console.warn('API logout failed, clearing local token anyway:', error);
    } finally {
      this.clearToken();
    }
  };

  /**
   * Handle OAuth callback - exchanges authorization code for JWT token
   * Stores token in cookie and returns user data and OAuth session hash for registration
   * @param provider OAuth provider (google, facebook, twitter)
   * @param code Authorization code from provider
   * @param state CSRF state token
   * @returns User data and authentication token
   */
  handleOAuthCallback = async (
    provider: string,
    code: string,
    state?: string
  ): Promise<any> => {
    const response = await this.post('/auth/social/callback', {
      provider,
      code,
      state
    });

    // Store token in cookie using the same pattern as login
    if (response.data?.token) {
      cookie.set('token', response.data.token, {
        expires: 7,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict'
      });
    }

    return response.data;
  };

  /**
  * Initialize OAuth flow - get authorization URL for provider
  * @param provider OAuth provider (google, facebook, twitter)
  * @param userRole User role for registration (user or creator)
  * @returns Authorization URL and OAuth session data
  */
  initOAuth = async (
    provider: string,
    userRole: 'user' | 'creator' = 'user'
  ): Promise<any> => {
    const response = await this.post(`/auth/social/${provider}/init`, {
      userRole
    });
    return response.data;
  };
}

export const authService = new AuthService();

// Create individual function exports for better tree shaking
const authServiceInstance = new AuthService();

export const clearToken = authServiceInstance.clearToken.bind(authServiceInstance);
export const register = authServiceInstance.register.bind(authServiceInstance);
export const getToken = authServiceInstance.getToken.bind(authServiceInstance);
export const logout = authServiceInstance.logout.bind(authServiceInstance);
export const handleOAuthCallback = authServiceInstance.handleOAuthCallback.bind(authServiceInstance);
export const initOAuth = authServiceInstance.initOAuth.bind(authServiceInstance);

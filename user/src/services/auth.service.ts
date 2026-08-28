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

  /**
   * Confirm an email address from a mailed link.
   *
   * The link in the email is a GET to `/auth/verify-email`; the page then posts
   * the token here. That split is not incidental — mail clients and security
   * appliances pre-fetch the URLs in a message, so a GET that consumed the token
   * would be consumed by Gmail's own scanner before the recipient ever clicked.
   */
  verifyEmail = (token: string) => this.post('/auth/verify-email', { token });

  /**
   * Ask for the confirmation link again.
   *
   * `identifier` is an email address *or* a username, because somebody who
   * signed in with a username has no address to hand. Always answers 200 with
   * the same body, whatever the input.
   */
  resendVerification = (identifier: string) => this.post('/auth/verification/resend', { identifier });

  /**
   * Start a password reset.
   *
   * Answers identically for a registered address and an unregistered one, so
   * the caller cannot use it to find out who has an account. The UI must not
   * try to be more helpful than the API here.
   */
  forgotPassword = (email: string) => this.post('/auth/forgot-password', { email });

  /**
   * Finish a password reset.
   *
   * `password` must already be SHA256-hashed with `hashPassword()`, exactly as
   * login and registration send it — the API stores a salted scrypt hash of
   * *that* value, so sending the plaintext would store the wrong thing and the
   * new password simply would not work.
   */
  resetPassword = (token: string, password: string) => this.post('/auth/reset-password', { token, password });

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
export const verifyEmail = authServiceInstance.verifyEmail.bind(authServiceInstance);
export const resendVerification = authServiceInstance.resendVerification.bind(authServiceInstance);
export const forgotPassword = authServiceInstance.forgotPassword.bind(authServiceInstance);
export const resetPassword = authServiceInstance.resetPassword.bind(authServiceInstance);

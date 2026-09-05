import { PermissionError } from '@lib/error';
import { endExpiredSession } from '@lib/session-expired';
import { isUrl } from '@lib/string';
import axios from 'axios';
import cookie from 'js-cookie';

export interface IResponse<T> {
  status: number;
  data: T;
}

export const TOKEN = 'token';

/**
 * The API token, held in memory as well as in the cookie.
 *
 * Auth lives in two stores that update at different times: next-auth's session
 * (which drives `status === 'authenticated'`) and the `token` cookie (which
 * fills the Authorization header). The bridge between them used to be a
 * `useEffect` in `session.provider.tsx`, and React runs a child subtree's
 * effects BEFORE a later sibling's — so every consumer's effect fired while the
 * cookie was still unwritten.
 *
 * Measured in production: immediately after login, `GET /notifications/unread-count`
 * went out with `Authorization:` empty and came back 403. It was invisible in the
 * UI because the badge refresher swallows its errors by design.
 *
 * `setApiAuthToken` is therefore called during RENDER, not from an effect. The
 * render phase completes for the whole tree before any effect in that commit
 * runs, so the token is in place for every consumer regardless of where the
 * bridge sits in the tree. The cookie is still written — it is what survives a
 * reload and what other tabs see — but it is no longer what the first request
 * of a session depends on.
 */
let inMemoryToken: string | null = null;

/** Set (or clear, with `null`) the token used for the Authorization header. */
export const setApiAuthToken = (token: string | null): void => {
  inMemoryToken = token || null;
};

/**
 * The token to authenticate with: memory first, cookie as the fallback.
 *
 * The cookie is authoritative across reloads, the memory copy is authoritative
 * within a session that has just started. Neither alone is enough.
 */
export const getApiAuthToken = (): string => inMemoryToken || cookie.get(TOKEN) || '';

/** Whether an authenticated request can currently be made at all. */
export const hasApiAuthToken = (): boolean => Boolean(getApiAuthToken());

export abstract class APIRequest {
  static API_ENDPOINT: any = null;

  /**
   * Get the base API endpoint for making requests
   *
   * Priority order:
   * 1. Static API_ENDPOINT if set via APIRequest.API_SERVER_ENDPOINT
   * 2. Environment variable NEXT_PUBLIC_API_ENDPOINT (if provided) - for client-side
   * 3. Environment variable API_ENDPOINT (if server-side)
   * 4. Proxy endpoint '/api/v1' (default - uses proxy setup for client-side)
   *
   * When using the proxy setup, requests to '/api/v1/*' are automatically
   * proxied to the backend API server via Next.js rewrites configuration
   */
  getBaseApiEndpoint = () => {
    const { API_ENDPOINT } = APIRequest;
    if (API_ENDPOINT) return API_ENDPOINT;

    // Check if we have an explicit client-side API endpoint configured
    const envEndpoint = process.env.NEXT_PUBLIC_API_ENDPOINT;
    if (envEndpoint && envEndpoint.trim() !== '') return envEndpoint;

    // Check if we're running on the server side and have a server endpoint
    if (typeof window === 'undefined') {
      const serverEndpoint = process.env.API_SERVER_ENDPOINT;
      if (serverEndpoint && serverEndpoint.trim() !== '') {
        return serverEndpoint;
      }
    }

    // Default to proxy endpoint for seamless development experience
    // This will be proxied to the actual API server via Next.js rewrites
    return '/api/v1';
  };

  request = (
    url: string,
    method?: string,
    body?: any,
    headers?: { [key: string]: string }
  ): Promise<IResponse<any>> => {
    const verb = (method || 'get').toUpperCase();
    const updatedHeader = {
      'Content-Type': 'application/json',
      // TODO - check me
      Authorization: getApiAuthToken(),
      ...headers || {}
    };
    const baseApiEndpoint = this.getBaseApiEndpoint();

    return axios({
      method: verb,
      url: isUrl(url) ? url : `${baseApiEndpoint}${url}`,
      data: body ? JSON.stringify(body) : undefined,
      headers: updatedHeader
    })
      .then((resp) => resp.data)
      .catch((e) => {
        const { response } = e;
        if (response?.status === 401) {
          const token = getApiAuthToken();
          if (token && typeof window !== 'undefined') {
            // The session is dead. `endExpiredSession` revokes it and lands on
            // `/`; it used to navigate to `/auth/logout`, a page that did the
            // revoke and then showed a confirmation screen. That page is gone.
            void endExpiredSession();
          }

          // throw to stop further processing
          // important do not change it, since error page will check this message
          throw new PermissionError('unauthorized', {
            code: 401,
            message: response?.data?.message || 'Unauthorized'
          });
        } else if (response?.status === 403) {
          throw new PermissionError('forbidden', {
            code: 403,
            message: response?.data?.message || 'Forbidden',
            // The API's machine-readable code, when it sent one. Carried through
            // so callers can branch on *why* they were refused; without it every
            // 403 looks the same and the only thing left to match on is display
            // text, which is translated and meant to change.
            error: response?.data?.error
          });
        }
        // other errors
        throw response?.data || e;
      });
  };

  buildUrl = (baseUrl: string, params?: { [key: string]: any }) => {
    if (!params) {
      return baseUrl;
    }

    const queryString = Object.keys(params)
      .map((k) => {
        if (Array.isArray(params[k])) {
          return params[k].map((param) => `${encodeURIComponent(k)}=${encodeURIComponent(param)}`)
            .join('&');
        }
        return `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`;
      })
      .join('&');
    return `${baseUrl}?${queryString}`;
  };

  get = (url: string, headers?: { [key: string]: string }) => {
    return this.request(url, 'get', null, headers);
  };

  post = (url: string, data?: any, headers?: { [key: string]: string }) => {
    return this.request(url, 'post', data, headers);
  };

  put = (url: string, data?: any, headers?: { [key: string]: string }) => {
    return this.request(url, 'put', data, headers);
  };

  del = (url: string, data?: any, headers?: { [key: string]: string }) => {
    return this.request(url, 'delete', data, headers);
  };
}

// Create a concrete implementation for standalone usage
class APIRequestImpl extends APIRequest { }

// Create individual function exports for better tree shaking
const apiRequestInstance = new APIRequestImpl();

export const buildUrl = apiRequestInstance.buildUrl.bind(apiRequestInstance);
export const apiGet = apiRequestInstance.get.bind(apiRequestInstance);
/**
 * Exposed for the recommendation-event `fetch(..., { keepalive: true })`
 * flush path, which cannot go through `axios`/`this.request` — `keepalive`
 * needs the raw `fetch` API — but must resolve the same base URL every other
 * call in this app uses.
 */
export const getBaseApiEndpoint = apiRequestInstance.getBaseApiEndpoint.bind(apiRequestInstance);
export const apiPost = apiRequestInstance.post.bind(apiRequestInstance);
export const apiPut = apiRequestInstance.put.bind(apiRequestInstance);
export const apiDelete = apiRequestInstance.del.bind(apiRequestInstance);

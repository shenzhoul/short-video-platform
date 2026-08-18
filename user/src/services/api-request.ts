import { PermissionError } from '@lib/error';
import { isUrl } from '@lib/string';
import axios from 'axios';
import cookie from 'js-cookie';

export interface IResponse<T> {
  status: number;
  data: T;
}

export const TOKEN = 'token';

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
      Authorization: cookie.get(TOKEN) || '',
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
          const token = cookie.get(TOKEN);
          if (token && typeof window !== 'undefined') {
            // logout page will handle all
            window.location.href = '/auth/logout';
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
            message: response?.data?.message || 'Forbidden'
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
export const apiPost = apiRequestInstance.post.bind(apiRequestInstance);
export const apiPut = apiRequestInstance.put.bind(apiRequestInstance);
export const apiDelete = apiRequestInstance.del.bind(apiRequestInstance);

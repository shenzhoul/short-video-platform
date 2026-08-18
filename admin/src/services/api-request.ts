import { isUrl } from '@lib/string';
import { appMessage as message } from '@lib/antd-message';
import axios from 'axios';
import cookie from 'js-cookie';
// import getConfig from 'next/config';

export interface IResponse<T> {
  status: number;
  data: T;
}

export const TOKEN = 'token';

export abstract class APIRequest {
  /**
   * Get the base API endpoint for making requests
   *
   * Priority order:
   * 1. Environment variable NEXT_PUBLIC_API_ENDPOINT (if provided) - for client-side
   * 2. Environment variable API_SERVER_ENDPOINT (if server-side)
   * 3. Local API endpoint (default)
   */
  getBaseApiEndpoint = (): string => {
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

    return process.env.API_ENDPOINT || 'http://localhost:8080';
  };

  request(
    url: string,
    method?: string,
    body?: any,
    headers?: { [key: string]: string }
  ): Promise<IResponse<any>> {
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
      headers: updatedHeader,
      proxy: typeof window === 'undefined' ? false : undefined
    })
      .then((resp) => resp.data)
      .catch((e) => {
        if (e.code === 'ECONNREFUSED') {
          throw new Error('ECONNREFUSED!');
        }
        const { response } = e;
        // allow 403 as well, because if user try to access resource that he is not allowed to access, we need to logout as well
        if (response && [401, 403].includes(response.status)) {
          const token = cookie.get(TOKEN);
          if (token) {
            // Clear token cookie when 401 occurs (token might be blacklisted)
            cookie.remove(TOKEN);
            message.error('Your session has expired. Please login again.');
            // Redirect to login
            if (typeof window !== 'undefined') {
              window.location.href = '/auth/logout';
            }
          } else {
            window.location.href = '/auth/logout';
          }

          throw new Error('Session expired or unauthorized');
        }

        throw response?.data || e.message || 'An error occurred';
      });
  }

  buildUrl(baseUrl: string, params?: { [key: string]: any }) {
    if (!params || Object.keys(params).length === 0) {
      return baseUrl;
    }

    const queryString = Object.keys(params)
      .filter((k) => params[k] !== null && params[k] !== undefined && params[k] !== '')
      .map((k) => {
        if (Array.isArray(params[k])) {
          return params[k]
            .filter((param) => param !== null && param !== undefined && param !== '')
            .map((param) => `${encodeURIComponent(k)}=${encodeURIComponent(param)}`)
            .join('&');
        }
        return `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`;
      })
      .filter(Boolean)
      .join('&');

    return queryString ? `${baseUrl}?${queryString}` : baseUrl;
  }

  get(url: string, headers?: { [key: string]: string }) {
    return this.request(url, 'get', null, headers);
  }

  post(url: string, data?: any, headers?: { [key: string]: string }) {
    return this.request(url, 'post', data, headers);
  }

  put(url: string, data?: any, headers?: { [key: string]: string }) {
    return this.request(url, 'put', data, headers);
  }

  del(url: string, data?: any, headers?: { [key: string]: string }) {
    return this.request(url, 'delete', data, headers);
  }

  upload(
    url: string,
    files: {
      file: File;
      fieldname: string;
    }[],
    options: {
      onProgress: Function;
      customData?: Record<any, any>;
      method?: string;
    } = {
        onProgress() { },
        method: 'POST'
      }
  ) {
    const baseApiEndpoint = this.getBaseApiEndpoint();
    const uploadUrl = isUrl(url) ? url : `${baseApiEndpoint}${url}`;
    return new Promise((resolve, reject) => {
      const req = new XMLHttpRequest();

      req.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          options.onProgress({
            percentage: (event.loaded / event.total) * 100
          });
        }
      });

      req.addEventListener('load', () => {
        const success = req.status >= 200 && req.status < 300;
        const { response } = req;
        if (!success) {
          return reject(response);
        }
        return resolve(response);
      });

      req.upload.addEventListener('error', () => {
        reject(req.response);
      });

      const formData = new FormData();
      files.forEach((f) => formData.append(f.fieldname, f.file, f.file.name));
      if (options.customData) {
        const customData = options.customData;
        Object.keys(customData).forEach(
          (fieldname) => {
            if (typeof customData[fieldname] !== 'undefined' && !Array.isArray(customData[fieldname])) formData.append(fieldname, customData[fieldname]);
            if (typeof customData[fieldname] !== 'undefined' && Array.isArray(customData[fieldname])) {
              if (customData[fieldname].length) {
                for (let i = 0; i < customData[fieldname].length; i += 1) {
                  formData.append(fieldname, customData[fieldname][i]);
                }
              }
            }
          }
        );
      }

      req.responseType = 'json';
      req.open(options.method || 'POST', uploadUrl);

      const token = cookie.get(TOKEN) || '';
      if (token) {
        req.setRequestHeader('Authorization', token);
      }
      req.send(formData);
    });
  }
}

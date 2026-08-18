import { toast as reactToast } from 'react-toastify';

import { TOAST_CONTAINER_ID, TOAST_DEFAULT_AUTO_CLOSE_MS } from './constants';
import type {
  SharedToastApi,
  ToastMessage,
  ToastOptionsInput,
  ToastPromiseOptions
} from './types';

const isObject = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null;

const getErrorFromFetchResponse = (value: unknown): string | null => {
  if (!isObject(value)) return null;
  if (!('status' in value) || !('statusText' in value)) return null;

  const status = typeof value.status === 'number' ? value.status : undefined;
  const statusText = typeof value.statusText === 'string' ? value.statusText : '';
  if (status && statusText) return `${status} ${statusText}`;
  if (status) return `Request failed with status ${status}`;
  return null;
};

const getErrorFromAxiosLike = (value: Record<string, any>): string | null => {
  const responseData = value.response?.data;
  const detailsMessage = value.details?.message;
  const messageList = responseData?.message ?? value.message;

  if (typeof detailsMessage === 'string' && detailsMessage.trim()) return detailsMessage;
  if (typeof responseData?.error === 'string' && responseData.error.trim()) return responseData.error;
  if (Array.isArray(messageList) && messageList.length > 0) {
    const first = messageList[0];
    if (typeof first === 'string' && first.trim()) return first;
    if (isObject(first) && isObject(first.constraints)) {
      const constraint = Object.values(first.constraints)[0];
      if (typeof constraint === 'string' && constraint.trim()) return constraint;
    }
  }
  if (typeof messageList === 'string' && messageList.trim()) return messageList;
  if (typeof value.message === 'string' && value.message.trim()) return value.message;
  return null;
};

export const normalizeErrorMessage = (
  error: unknown,
  fallback = 'Something went wrong, please try again later'
): string => {
  if (!error) return fallback;
  if (typeof error === 'string') return error;
  if (error instanceof Error && error.message) return error.message;
  if (Array.isArray(error)) {
    const first = error.find((entry) => typeof entry === 'string' && entry.trim());
    return typeof first === 'string' ? first : fallback;
  }
  const fetchError = getErrorFromFetchResponse(error);
  if (fetchError) return fetchError;
  if (isObject(error)) {
    const axiosLikeMessage = getErrorFromAxiosLike(error);
    if (axiosLikeMessage) return axiosLikeMessage;
  }
  return fallback;
};

const normalizeOptions = (options?: ToastOptionsInput) => {
  if (typeof options === 'number') return { autoClose: options * 1000 };
  return options ?? {};
};

const withContainer = (options?: ToastOptionsInput) => ({
  containerId: TOAST_CONTAINER_ID,
  autoClose: TOAST_DEFAULT_AUTO_CLOSE_MS,
  ...normalizeOptions(options)
});

const resolvePromise = <TData>(promise: Promise<TData> | (() => Promise<TData>)): Promise<TData> =>
  typeof promise === 'function' ? promise() : promise;

export const toast: SharedToastApi = {
  success(message: ToastMessage, options?: ToastOptionsInput) {
    return reactToast.success(message, withContainer(options));
  },
  error(message: ToastMessage, options?: ToastOptionsInput) {
    return reactToast.error(message, withContainer(options));
  },
  warning(message: ToastMessage, options?: ToastOptionsInput) {
    return reactToast.warning(message, withContainer(options));
  },
  info(message: ToastMessage, options?: ToastOptionsInput) {
    return reactToast.info(message, withContainer(options));
  },
  loading(message: ToastMessage, options?: ToastOptionsInput) {
    return reactToast.loading(message, withContainer(options));
  },
  dismiss(id) {
    reactToast.dismiss(id);
  },
  update(id, options) {
    reactToast.update(id, {
      ...options,
      containerId: TOAST_CONTAINER_ID
    });
  },
  async promise<TData = unknown>(
    promise: Promise<TData> | (() => Promise<TData>),
    config?: ToastPromiseOptions<TData>
  ): Promise<TData> {
    const messages = config?.messages;
    const pendingMessage = typeof messages?.pending === 'string'
      ? messages.pending
      : 'Loading...';
    const successMessage = messages?.success ?? 'Done';
    const errorMessage = messages?.error;

    const promiseOptions = {
      ...withContainer(config?.options),
      ...config?.options
    } as any;

    return reactToast.promise<TData>(
      resolvePromise(promise),
      {
        pending: pendingMessage,
        success: {
          render({ data }: { data: TData }) {
            if (typeof successMessage === 'function') return successMessage(data as TData);
            return successMessage;
          }
        },
        error: {
          // The promise's rejection reason is not `TData` — react-toastify types
          // it as `unknown`, which matches `ToastPromiseMessages.error`.
          render({ data }: { data: unknown }) {
            if (typeof errorMessage === 'function') return errorMessage(data);
            if (errorMessage) return errorMessage;
            return normalizeErrorMessage(data);
          }
        }
      },
      promiseOptions
    );
  }
};

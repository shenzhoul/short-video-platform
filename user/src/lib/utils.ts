import { clearToken } from '@services/auth.service';
import { signOut } from 'next-auth/react';
import { toast } from 'react-toastify';

export const defaultSettings = {
  siteName: 'Douyin-Clone',
  logoUrl: '',
  logoWhite: ''
};

export type PublicSettings = typeof defaultSettings;

export function getResponseError(data: any) {
  if (!data) {
    return '';
  }

  if (typeof data === 'string') {
    return data;
  }

  if (Array.isArray(data.message)) {
    const item = data.message[0];
    if (!item.constraints) {
      return item || data.error || 'Bad request!';
    }
    return Object.values(item.constraints)[0];
  }

  // TODO - parse for language or others
  return typeof data.message === 'string' ? data.message : 'Bad request!';
}

/**
 * Perform logout by signing out and clearing token
 */
export async function performLogout() {
  await signOut({ redirect: false });
  clearToken();
}

interface ShowErrorMessageOptions {
  toastId?: string;
}

export async function showErrorMessage(
  e,
  defaultMessage = 'An error occurred, please try again.',
  options: ShowErrorMessageOptions = {}
) {
  const error = await e;
  let errorMessage = defaultMessage;
  if (!error) {
    toast.error(errorMessage, {
      toastId: options.toastId || `error:${errorMessage}`
    });
    return;
  }
  // PermissionError (401/403) stores the real server message in details.message
  if (error.details?.message && typeof error.details.message === 'string') {
    errorMessage = error.details.message;
  } else if (error.message && Array.isArray(error.message)) {
    errorMessage = error.message[0];
  } else if (error.message && typeof error.message === 'string') {
    errorMessage = error.message;
  } else if (error.response?.data?.message) {
    errorMessage = error.response.data.message;
  } else if (Array.isArray(error) && error.length > 0 && typeof error[0] === 'string') {
    errorMessage = error[0];
  } else if (typeof error === 'string') {
    errorMessage = error;
  }
  const resolvedErrorMessage = Array.isArray(errorMessage) ? errorMessage[0] : errorMessage;
  toast.error(resolvedErrorMessage, {
    toastId: options.toastId || `error:${resolvedErrorMessage}`
  });
}

/**
 * Convert a file to base64 data URL (Promise-based)
 *
 * @param file - The file to convert
 * @returns Promise that resolves to base64 data URL string
 *
 * @example
 * ```typescript
 * const base64 = await getBase64(file);
 * setPreview(base64);
 * ```
 */
export function getBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (error) => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * get default thumbnail for a post, products...
 * @param post
 * @returns
 */
export function getThumbnail(post: Record<string, any>): string {
  const defaultThumbnail = '/placeholder-image.jpg';
  if (!post) return defaultThumbnail;
  if (post.thumbnailUrl) return post.thumbnailUrl;
  if (post.thumbnails?.length) return post.thumbnails[0];
  if (post.teaser?.thumbnails?.length) return post.teaser.thumbnails[0];
  if (post.files?.length && post.files[0].thumbnails?.length) return post.files[0].thumbnails[0];
  if (post?.type === 'audio') return '/placeholder-audio.png';

  if (post.teaser?.url) return post.teaser.url;
  if (post.files?.length && post.files[0].url && post.type === 'photo') return post.files[0].url;
  return defaultThumbnail;
}
